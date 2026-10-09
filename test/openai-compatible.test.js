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
