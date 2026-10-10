import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';

const httpResponse = ({ status = 200, body, text, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => text ?? content(body ?? 'model text'),
});

const content = (body) => JSON.stringify({ choices: [{ message: { content: body } }] });

/** Builds a provider whose transport is fully observable and never really waits. */
function harness(outcomes, { providerOptions = {}, maxAttempts = 3 } = {}) {
  const queue = [...outcomes];
  const calls = [];
  const delays = [];
  const retries = [];
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://gateway.test/v1/',
    apiKey: 'sk-test',
    model: 'gpt-test',
    retryAttempts: maxAttempts,
    baseDelayMs: 500,
    sleep: async (ms) => { delays.push(ms); },
    random: () => 1,
    onRetry: (info) => retries.push(info),
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      const outcome = queue.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome ?? httpResponse({ body: 'model text' });
    },
    ...providerOptions,
  });
  return { provider, calls, delays, retries };
}

const REQUEST = { role: 'planner', objective: 'Ship it.', instruction: 'Plan.', priorOutputs: {} };

test('posts an OpenAI-compatible request and never puts the key in the body', async () => {
  const { provider, calls } = harness([httpResponse({ body: 'planned' })]);

  assert.equal(await provider.complete(REQUEST), 'planned');
  assert.equal(calls[0].url, 'https://gateway.test/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].body.model, 'gpt-test');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.match(calls[0].options.body, /Ship it\./);
  assert.equal(calls[0].options.body.includes('sk-test'), false);
  assert.ok(calls[0].options.signal);
});

test('sends max_tokens only when the configuration declares it', async () => {
  const unset = harness([httpResponse()]);
  await unset.provider.complete(REQUEST);
  assert.equal('max_tokens' in unset.calls[0].body, false);

  const configured = harness([httpResponse()], { providerOptions: { maxTokens: 4096 } });
  await configured.provider.complete(REQUEST);
  assert.equal(configured.calls[0].body.max_tokens, 4096);

  const rejected = harness([httpResponse()], { providerOptions: { maxTokens: '4096' } });
  await rejected.provider.complete(REQUEST);
  assert.equal('max_tokens' in rejected.calls[0].body, false);
});

test('retries a rate-limited call and reports each retry', async () => {
  const { provider, calls, delays, retries } = harness([
    httpResponse({ status: 429 }),
    httpResponse({ status: 503 }),
    httpResponse({ body: 'planned after waits' }),
  ]);

  assert.equal(await provider.complete(REQUEST), 'planned after waits');
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [500, 1000]);
  assert.deepEqual(retries, [
    { attempt: 1, maxAttempts: 3, delayMs: 500, reason: 'http_429' },
    { attempt: 2, maxAttempts: 3, delayMs: 1000, reason: 'http_503' },
  ]);
});

test('honors Retry-After instead of the backoff ladder', async () => {
  const { provider, delays } = harness([httpResponse({ status: 429, headers: { 'retry-after': '3' } }), httpResponse({ body: 'late' })]);

  assert.equal(await provider.complete(REQUEST), 'late');
  assert.deepEqual(delays, [3000]);
});

test('gives up after the bounded attempts and surfaces the last failure', async () => {
  const { provider, calls, delays } = harness([
    httpResponse({ status: 500 }),
    httpResponse({ status: 502 }),
    httpResponse({ status: 503 }),
    httpResponse({ body: 'never reached' }),
  ]);

  await assert.rejects(() => provider.complete(REQUEST), /HTTP 503/);
  assert.equal(calls.length, 3);
  assert.equal(delays.length, 2);
});

test('does not retry a request the provider rejected outright', async () => {
  const { provider, calls, retries } = harness([httpResponse({ status: 400 })]);

  await assert.rejects(() => provider.complete(REQUEST), /HTTP 400/);
  assert.equal(calls.length, 1);
  assert.equal(retries.length, 0);
});

test('does not retry a 2xx body that is not JSON', async () => {
  const { provider, calls } = harness([httpResponse({ status: 200, text: '<html>gateway</html>' })]);

  await assert.rejects(() => provider.complete(REQUEST), /non-JSON response \(HTTP 200\): <html>gateway<\/html>/);
  assert.equal(calls.length, 1);
});

test('retries network failures and timeouts', async () => {
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  const { provider, retries, calls } = harness([
    Object.assign(new Error('socket hang up'), { name: 'TypeError' }),
    timeout,
    httpResponse({ body: 'recovered' }),
  ]);

  assert.equal(await provider.complete(REQUEST), 'recovered');
  assert.equal(calls.length, 3);
  assert.deepEqual(retries.map((entry) => entry.reason), ['network_error', 'timeout']);
});

test('a per-call onRetry observer wins over the constructor one', async () => {
  const seen = [];
  const { provider, retries } = harness([httpResponse({ status: 429 }), httpResponse({ body: 'ok' })]);

  assert.equal(await provider.complete({ ...REQUEST, onRetry: (info) => seen.push(info.attempt) }), 'ok');
  assert.deepEqual(seen, [1]);
  assert.equal(retries.length, 0);
});

test('a single logical call can span several transport attempts', async () => {
  // The call budget is owned by the orchestrator; this documents that retries
  // happen inside one complete() rather than becoming extra mission calls.
  const { provider, calls } = harness([httpResponse({ status: 429 }), httpResponse({ status: 429 }), httpResponse({ body: 'eventually' })]);

  assert.equal(await provider.complete(REQUEST), 'eventually');
  assert.equal(calls.length, 3);
});

test('does not start or retry a request after the mission is cancelled', async () => {
  const { provider, calls } = harness([httpResponse({ body: 'never reached' })]);
  const controller = new AbortController();
  controller.abort(new Error('user_requested'));

  await assert.rejects(() => provider.complete({ ...REQUEST, signal: controller.signal }), /user_requested/);
  assert.equal(calls.length, 0);
});

test('a tool-less role sends exactly the two messages the contract describes', async () => {
  const { provider, calls } = harness([httpResponse({ body: 'plan' })]);

  await provider.complete({ ...REQUEST, priorOutputs: { planner: 'the plan' } });

  assert.deepEqual(calls[0].body.messages, [
    { role: 'system', content: 'You are the planner in a bounded multi-agent task. Plan.' },
    { role: 'user', content: JSON.stringify({ objective: REQUEST.objective, priorOutputs: { planner: 'the plan' } }) },
  ]);
  assert.equal('tools' in calls[0].body, false, 'a role with no loop is not offered a tool table');
});

const toolResponse = (body) => JSON.stringify({ choices: [{ message: body }] });
const MESSAGES = [{ role: 'system', content: 'You may call tools.' }, { role: 'user', content: 'Read src/a.js' }];
const TOOLS = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }];

test('a turn sends the declared tools and a plain call never does', async () => {
  const withTools = harness([httpResponse({ text: toolResponse({ content: 'nothing to read' }) })]);
  await withTools.provider.completeTurn({ messages: MESSAGES, tools: TOOLS });
  assert.deepEqual(withTools.calls[0].body.tools, TOOLS);

  const withoutTools = harness([httpResponse({ text: toolResponse({ content: 'planned' }) })]);
  await withoutTools.provider.completeTurn({ messages: MESSAGES });
  assert.equal('tools' in withoutTools.calls[0].body, false);
});

test('a gateway that honours tools comes back as a native protocol turn', async () => {
  const { provider } = harness([httpResponse({ text: toolResponse({
    content: null,
    tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"src/a.js"}' } }],
  }) })]);

  const turn = await provider.completeTurn({ messages: MESSAGES, tools: TOOLS });
  assert.equal(turn.protocol, 'native');
  assert.deepEqual(turn.toolCalls, [
    { id: 'call_1', name: 'read_file', arguments: { path: 'src/a.js' }, source: 'native' },
  ]);
});

test('a gateway that ignores tools can still ask, and the turn says which way it happened', async () => {
  const fenced = 'Reading it.\n\n```hane-tool\n{"tool":"read_file","args":{"path":"src/a.js"}}\n```';
  const { provider, calls } = harness([httpResponse({ text: toolResponse({ content: fenced }) })]);

  const turn = await provider.completeTurn({ messages: MESSAGES, tools: TOOLS });
  assert.equal(turn.protocol, 'inline', 'a free-tier model that drops `tools` is not the machine the loop was designed for');
  assert.deepEqual(turn.toolCalls, [
    { id: null, name: 'read_file', arguments: { path: 'src/a.js' }, source: 'inline' },
  ]);
  assert.equal(turn.content, 'Reading it.', 'the protocol block does not stay in the role answer');
  assert.equal(JSON.parse(calls[0].options.body).messages[1].content, MESSAGES[1].content);
});

test('an inline block that cannot be read becomes a refusal the router audits, never a guessed call', async () => {
  const { provider } = harness([httpResponse({ text: toolResponse({ content: '```hane-tool\n{"tool":"read_file","args":{"path":\n```' }) })]);

  const turn = await provider.completeTurn({ messages: MESSAGES, tools: TOOLS });
  assert.equal(turn.toolCalls.length, 1);
  assert.equal(turn.toolCalls[0].name, undefined);
  assert.equal(turn.toolCalls[0].malformed, 'invalid_json');
});

test('transport retries stay inside one turn of the loop', async () => {
  const { provider, calls, retries } = harness([
    httpResponse({ status: 429, text: '{}' }),
    httpResponse({ status: 503, text: '{}' }),
    httpResponse({ text: toolResponse({ content: 'done', tool_calls: [] }) }),
  ]);

  const turn = await provider.completeTurn({ messages: MESSAGES, tools: TOOLS });
  assert.equal(turn.content, 'done');
  assert.equal(calls.length, 3);
  assert.equal(retries.length, 2);
});

test('a turn refuses an answer with neither text nor calls instead of inventing one', async () => {
  const { provider } = harness([httpResponse({ text: toolResponse({ content: null }) })]);
  await assert.rejects(() => provider.completeTurn({ messages: MESSAGES, tools: TOOLS }), /no assistant content/);
});

test('complete() keeps its old contract: a text answer, fences and all', async () => {
  const fenced = 'I would write:\n\n```hane-tool\n{"tool":"read_file","args":{"path":"src/a.js"}}\n```';
  const { provider, calls } = harness([httpResponse({ text: toolResponse({ content: fenced }) })]);

  assert.equal(await provider.complete(REQUEST), fenced, 'a role without tools is not a tool loop');
  assert.equal(calls[0].body.tools, undefined);
});

test('a turn needs the messages it is continuing from', async () => {
  const { provider } = harness([httpResponse()]);
  await assert.rejects(() => provider.completeTurn({ messages: [] }), /requires a message list/);
  await assert.rejects(() => provider.completeTurn({}), /requires a message list/);
});
