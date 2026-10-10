import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAPABILITY } from '../src/capabilities.js';
import { availableToolNames, TOOLS, toolFor, toolSchemas } from '../src/tools/registry.js';
import { createToolRouter } from '../src/tools/router.js';
import { defineSandbox } from '../src/sandbox/interface.js';

const readGrant = { name: CAPABILITY.WORKSPACE_READ, scope: 'src' };
const writeGrant = { name: CAPABILITY.WORKSPACE_WRITE, scope: 'src' };

/** A sandbox that answers instead of touching a disk, so a test sees the routing. */
function fakeSandbox({ executable = ['read', 'list'], answer } = {}) {
  const seen = [];
  const respond = async (verb, request) => {
    seen.push({ verb, ...request });
    return answer ?? { ok: true, relPath: request.path, content: 'bytes\n', bytes: 6, totalBytes: 6, truncated: false, entries: [] };
  };
  const methods = {};
  for (const verb of executable) methods[verb] = (request) => respond(verb, request);
  return { seen, sandbox: defineSandbox({ id: 'fake', ...methods }) };
}

describe('the tool table', () => {
  test('every tool names a capability and a sandbox verb that exist', () => {
    for (const tool of TOOLS) {
      assert.ok(Object.values(CAPABILITY).includes(tool.capability), `${tool.name} grants against a real capability`);
      assert.equal(typeof tool.name, 'string');
      assert.equal(typeof tool.verb, 'string');
      assert.equal(tool.parameters.additionalProperties, false, 'the model gets no room to add arguments we ignore');
    }
  });

  test('a grant chooses the tools, and no grant chooses none', () => {
    assert.deepEqual(availableToolNames([readGrant]), ['read_file', 'list_dir']);
    assert.deepEqual(availableToolNames([writeGrant]), ['write_file'], 'a write grant hands out its own verb and never a read');
    assert.deepEqual(availableToolNames([{ name: CAPABILITY.PROCESS_RUN, scope: 'git status' }]), ['run_command']);
    assert.deepEqual(availableToolNames([]), []);
    assert.deepEqual(availableToolNames([null]), []);
  });

  test('the schemas are the shape an OpenAI-compatible gateway documents', () => {
    const schemas = toolSchemas(['read_file']);
    assert.equal(schemas.length, 1);
    assert.deepEqual(Object.keys(schemas[0]), ['type', 'function']);
    assert.deepEqual(Object.keys(schemas[0].function), ['name', 'description', 'parameters']);
    assert.equal(schemas[0].function.parameters.required[0], 'path');
    assert.deepEqual(toolSchemas(['not_a_tool']), [], 'a name with no schema is dropped, not sent as undefined');
    assert.equal(toolFor('list_dir').verb, 'list');
    assert.equal(toolFor('nope'), null);
  });
});

describe('createToolRouter', () => {
  test('a granted read reaches the sandbox and comes back tagged finished', async () => {
    const { sandbox, seen } = fakeSandbox();
    const router = createToolRouter({ sandbox, grants: [readGrant] });

    const outcome = await router.execute({ name: 'read_file', arguments: { path: 'src/a.js' }, source: 'native' });

    assert.equal(outcome.status, 'finished');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.tool, 'read_file');
    assert.deepEqual(seen, [{ verb: 'read', path: 'src/a.js' }]);
    assert.deepEqual(router.names, ['read_file', 'list_dir']);
    assert.equal(router.schemas.length, 2);
    assert.equal(router.sandboxId, 'fake');
  });

  test('a sandbox denial keeps its reason and is tagged denied', async () => {
    const { sandbox } = fakeSandbox({ answer: { ok: false, reason: 'denied_by_secret_policy', relPath: '.env' } });
    const router = createToolRouter({ sandbox, grants: [readGrant] });

    const outcome = await router.execute({ name: 'read_file', arguments: { path: '.env' } });

    assert.deepEqual({ status: outcome.status, ok: outcome.ok, reason: outcome.reason }, { status: 'denied', ok: false, reason: 'denied_by_secret_policy' });
  });

  test('a tool the mission was not granted is refused with the capability that is missing', async () => {
    const { sandbox, seen } = fakeSandbox();
    const router = createToolRouter({ sandbox, grants: [writeGrant] });

    const outcome = await router.execute({ name: 'read_file', arguments: { path: 'src/a.js' } });

    assert.deepEqual({ status: outcome.status, reason: outcome.reason, capability: outcome.capability }, {
      status: 'refused', reason: 'capability_not_granted', capability: CAPABILITY.WORKSPACE_READ,
    });
    assert.equal(seen.length, 0, 'the sandbox never saw the call');
  });

  test('a verb this backend has no executor for is refused as a fact about the backend', async () => {
    const { sandbox, seen } = fakeSandbox({ executable: ['read'] });
    const router = createToolRouter({ sandbox, grants: [readGrant] });

    const outcome = await router.execute({ name: 'list_dir', arguments: { path: 'src' } });

    assert.deepEqual({ status: outcome.status, reason: outcome.reason, verb: outcome.verb }, { status: 'refused', reason: 'capability_not_available', verb: 'list' });
    assert.equal(seen.length, 0);
  });

  test('a name the table does not know is refused before any lookup', async () => {
    const { sandbox, seen } = fakeSandbox();
    const outcome = await createToolRouter({ sandbox, grants: [readGrant] }).execute({ name: 'rm_rf', arguments: {} });

    assert.deepEqual({ status: outcome.status, reason: outcome.reason }, { status: 'refused', reason: 'unknown_tool' });
    assert.equal(seen.length, 0);
  });

  test('a call that cannot be read is refused with its raw text, so the audit still shows the ask', async () => {
    const { sandbox, seen } = fakeSandbox();
    const router = createToolRouter({ sandbox, grants: [readGrant] });

    const malformed = await router.execute({ malformed: 'invalid_json', raw: '{"tool":"read_file","args":{', source: 'inline' });
    const nameless = await router.execute({ malformed: 'invalid_call_shape', raw: '[]' });

    assert.deepEqual({ status: malformed.status, reason: malformed.reason, raw: malformed.raw }, {
      status: 'refused', reason: 'invalid_json', raw: '{"tool":"read_file","args":{',
    });
    assert.deepEqual({ status: nameless.status, reason: nameless.reason }, { status: 'refused', reason: 'invalid_call_shape' });
    assert.equal(seen.length, 0);
  });

  test('a call with no path at all is answered by the sandbox, which refuses it', async () => {
    const { sandbox, seen } = fakeSandbox({ answer: { ok: false, reason: 'invalid_path' } });
    const outcome = await createToolRouter({ sandbox, grants: [readGrant] }).execute({ name: 'read_file', arguments: {} });

    assert.deepEqual(seen, [{ verb: 'read' }]);
    assert.equal(outcome.reason, 'invalid_path');
  });

  test('the whole argument object travels to the verb, because content and argv are not paths', async () => {
    const { sandbox, seen } = fakeSandbox({ executable: ['write', 'run'], answer: { ok: true, relPath: 'saida.md', bytes: 3, machine: 'hane' } });
    const router = createToolRouter({ sandbox, grants: [writeGrant, { name: CAPABILITY.PROCESS_RUN, scope: 'git *' }] });

    assert.deepEqual(router.names, ['write_file', 'run_command']);
    await router.execute({ name: 'write_file', arguments: { path: 'saida.md', content: 'oi\n' } });
    await router.execute({ name: 'run_command', arguments: { argv: ['git', 'status'] } });
    assert.deepEqual(seen, [
      { verb: 'write', path: 'saida.md', content: 'oi\n' },
      { verb: 'run', argv: ['git', 'status'] },
    ]);
  });

  test('a backend that cannot carry a verb never has it offered, even when it is granted', () => {
    const { sandbox } = fakeSandbox({ executable: ['read', 'list'] });
    const router = createToolRouter({ sandbox, grants: [readGrant, writeGrant, { name: CAPABILITY.PROCESS_RUN, scope: 'git *' }] });
    assert.deepEqual(router.names, ['read_file', 'list_dir'], 'the model is not handed a call this machine would only refuse');
  });
});
