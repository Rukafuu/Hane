import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_FENCE, normalizeNativeToolCalls, parseInlineToolCalls, renderToolProtocolHint, stripToolFences } from '../src/tools/protocol.js';

test('the inline protocol names one shape and the tools it may be used with', () => {
  const hint = renderToolProtocolHint(['read_file', 'list_dir']);
  assert.ok(hint.includes(TOOL_FENCE), 'the hint teaches the tag the parser reads');
  assert.ok(hint.includes('read_file, list_dir'));
  assert.match(hint, /never claim a result/);
});

test('only a block tagged with the protocol is a call', () => {
  const prose = [
    'The plan is to read the file, for instance:',
    '```json',
    '{"tool":"read_file","args":{"path":"src/a.js"}}',
    '```',
    'and then decide.',
  ].join('\n');
  assert.deepEqual(parseInlineToolCalls(prose).calls, [], 'a JSON example in prose asks for nothing');
  assert.equal(parseInlineToolCalls(prose).hadFence, false);
});

test('an inline call parses to a name and arguments, and no-call shapes stay refusals', () => {
  const single = `calling now:\n\`\`\`${TOOL_FENCE}\n{"tool":"read_file","args":{"path":"src/a.js"}}\n\`\`\``;
  assert.deepEqual(parseInlineToolCalls(single).calls, [
    { name: 'read_file', arguments: { path: 'src/a.js' } },
  ]);

  // A bare name with no arguments is a real call (`list the workdir`); a
  // non-object argument list is not one we can run, so it is refused, not guessed.
  assert.deepEqual(parseInlineToolCalls(`\`\`\`${TOOL_FENCE}\n{"tool":"list_dir"}\n\`\`\``).calls, [
    { name: 'list_dir', arguments: {} },
  ]);
  for (const body of ['{"tool":"read_file","args":"src/a.js"}', '{"path":"src/a.js"}', '{"tool":123}', 'not json at all', '[]']) {
    const [call] = parseInlineToolCalls(`\`\`\`${TOOL_FENCE}\n${body}\n\`\`\``).calls;
    assert.equal(call.name, undefined, body);
    assert.ok(call.malformed, body);
  }
});

test('the fence is removed from what the role keeps as its answer', () => {
  const text = `I will read it.\n\n\`\`\`${TOOL_FENCE}\n{"tool":"read_file","args":{"path":"a"}}\n\`\`\`\n\nafterwards I will summarise.`;
  assert.equal(stripToolFences(text), 'I will read it.\n\nafterwards I will summarise.');
});

test('a structured call with unparsable arguments is kept as evidence, not dropped', () => {
  const [truncated] = normalizeNativeToolCalls([
    { id: 'call_1', function: { name: 'read_file', arguments: '{"path":"src/a' } },
  ]);
  assert.equal(truncated.name, 'read_file');
  assert.equal(truncated.arguments, null);
  assert.equal(truncated.malformed, 'invalid_json');
  assert.match(truncated.raw, /src\/a/, 'the half-written argument stays visible to the audit');
});

test('a structured call shapes itself into the same form the inline protocol uses', () => {
  assert.deepEqual(normalizeNativeToolCalls([
    { id: 'call_9', function: { name: 'list_dir', arguments: '{"path":"src"}' } },
    { id: 'call_10', function: { name: 'read_file', arguments: '' } },
  ]), [
    { id: 'call_9', name: 'list_dir', arguments: { path: 'src' } },
    { id: 'call_10', name: 'read_file', arguments: {} },
  ]);

  assert.deepEqual(normalizeNativeToolCalls([{ function: { arguments: '{}' } }]), [
    { id: 'call-1', name: null, arguments: null, malformed: 'unnamed_call', raw: '{}' },
  ]);
});
