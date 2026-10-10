import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createRequestGuard, normalizeAllowedOrigin, RequestGuardError } from '../src/server/request-guard.js';

const ALLOWED_UI = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Mounts the guard in front of a handler that records having run, so a test can
 * prove a refused request never reached the router rather than being answered
 * after the fact.
 */
async function startGuardedServer(guard) {
  const state = { handled: 0 };
  const server = http.createServer((request, response) => {
    try {
      guard(request);
    } catch (error) {
      const status = error instanceof RequestGuardError ? error.status : 500;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
      return;
    }
    state.handled += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** One wire-level request where every header, including Host, is ours to set. */
function wire({ port, method = 'GET', path = '/api/missions', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function guarded(guardOptions) {
  return startGuardedServer(createRequestGuard(guardOptions));
}

const LOCAL_PAGE = { origin: 'http://localhost:5173', 'x-hane-request': '1' };

test('a cross-site simple POST never reaches the router', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  // The payload from the diagnosis: a simple request, so no preflight can fail,
  // aimed at the route that starts provider calls and reads a workspace.
  const attack = await wire({
    port: server.port,
    method: 'POST',
    headers: {
      host: `127.0.0.1:${server.port}`,
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
    },
    body: JSON.stringify({ objective: 'Read the workspace.', capabilities: [{ name: 'workspace.read', scope: '.' }] }),
  });

  assert.equal(attack.status, 403);
  assert.match(JSON.parse(attack.text).error, /cross-site/);
  assert.equal(server.state.handled, 0);
  assert.equal(attack.headers['access-control-allow-origin'], undefined);
});

test('a host rebound to loopback is refused before routing', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  const rebinding = await wire({
    port: server.port,
    method: 'GET',
    headers: { host: 'evil.example', origin: 'http://localhost:5173', 'x-hane-request': '1' },
  });
  assert.equal(rebinding.status, 403);
  assert.match(JSON.parse(rebinding.text).error, /Host "evil\.example"/);
  assert.equal(server.state.handled, 0);

  // A request that names no host at all cannot be placed on any origin, so it is
  // a usage error rather than a policy decision.
  assert.throws(() => createRequestGuard()({ headers: {} }), (error) => error instanceof RequestGuardError && error.status === 400);
});

test('only the origins this server was told to serve may reach it', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  // Only Origin, no Sec-Fetch-Site: this is the allowlist doing the work, which
  // is what a page on an older user agent or a stripped request leaves standing.
  for (const origin of ['https://evil.example', 'http://evil.example', 'http://localhost:4000', 'http://127.0.0.1:9999', 'http://localhost:5173.evil.example', 'http://hane.example']) {
    const refused = await wire({
      port: server.port,
      method: 'GET',
      headers: { host: `127.0.0.1:${server.port}`, origin, 'x-hane-request': '1' },
    });
    assert.equal(refused.status, 403, origin);
    assert.match(JSON.parse(refused.text).error, /not allowed/, origin);
  }
  assert.equal(server.state.handled, 0);

  for (const origin of ALLOWED_UI) {
    const allowed = await wire({
      port: server.port,
      headers: { host: `127.0.0.1:${server.port}`, origin, 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(allowed.status, 200, origin);
  }

  // A page served by this very address is same-origin even when unlisted.
  const served = await wire({
    port: server.port,
    headers: { host: `127.0.0.1:${server.port}`, origin: `http://127.0.0.1:${server.port}`, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(served.status, 200);
  assert.equal(server.state.handled, 3);
});

test('a page with no origin is still refused by Sec-Fetch-Site', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  for (const fetchSite of ['cross-site', 'cross-origin']) {
    const refused = await wire({
      port: server.port,
      method: 'GET',
      headers: { host: `127.0.0.1:${server.port}`, 'sec-fetch-site': fetchSite },
    });
    assert.equal(refused.status, 403, fetchSite);
    assert.match(JSON.parse(refused.text).error, new RegExp(fetchSite));
  }

  const sameSite = await wire({
    port: server.port,
    headers: { host: `127.0.0.1:${server.port}`, 'sec-fetch-site': 'same-site' },
  });
  assert.equal(sameSite.status, 200);
});

test('an opaque null origin cannot read or change state', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  const read = await wire({ port: server.port, headers: { host: `127.0.0.1:${server.port}`, origin: 'null' } });
  assert.equal(read.status, 403);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const write = await wire({
      port: server.port,
      method,
      headers: { host: `127.0.0.1:${server.port}`, origin: 'null', 'x-hane-request': '1' },
    });
    assert.equal(write.status, 403, method);
    assert.match(JSON.parse(write.text).error, /opaque \(null\) origin/);
  }
  assert.equal(server.state.handled, 0);
});

test('a page mutation must identify itself and send JSON', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  const anonymous = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Started from a page that did not opt in.' }),
  });
  assert.equal(anonymous.status, 403);
  assert.match(JSON.parse(anonymous.text).error, /x-hane-request/);

  const simpleContentType = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, ...LOCAL_PAGE, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
    body: JSON.stringify({ objective: 'A form post shaped as JSON.' }),
  });
  assert.equal(simpleContentType.status, 415);

  const noContentType = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, ...LOCAL_PAGE, 'sec-fetch-site': 'same-origin' },
    body: '{"objective":"No content type at all."}',
  });
  assert.equal(noContentType.status, 415);

  const wellFormed = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, ...LOCAL_PAGE, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: '{"objective":"A legitimate mission."}',
  });
  assert.equal(wellFormed.status, 200);

  // An action with no body still needs the opt-in, but has no content type to check.
  const bodyless = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, ...LOCAL_PAGE, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(bodyless.status, 200);
  assert.equal(server.state.handled, 2);
});

test('a preflight is refused instead of answered with CORS', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  const preflight = await wire({
    port: server.port,
    method: 'OPTIONS',
    headers: {
      host: `127.0.0.1:${server.port}`,
      origin: 'http://localhost:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'x-hane-request',
    },
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers['access-control-allow-methods'], undefined);
  assert.equal(server.state.handled, 0);
});

test('a local client with no browser identity is not asked to authenticate', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());

  // curl, the CLI and any process on this machine: no Origin, no Sec-Fetch-Site,
  // no x-hane-request. Such a client can read the SQLite file directly, so a
  // token would protect nothing here; the boundary is the loopback bind itself.
  const curl = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json' },
    body: '{"objective":"Started from the shell."}',
  });
  assert.equal(curl.status, 200);

  const plainBody = await wire({
    port: server.port,
    method: 'POST',
    headers: { host: `127.0.0.1:${server.port}`, 'content-type': 'text/plain' },
    body: '{"objective":"Started from the shell, wrong MIME."}',
  });
  assert.equal(plainBody.status, 200);
  assert.equal(server.state.handled, 2);
});

test('a server bound away from loopback answers its own host', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI, allowAnyHost: true });
  t.after(() => server.close());

  const lan = await wire({
    port: server.port,
    headers: { host: '192.168.1.10:7788', ...LOCAL_PAGE, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(lan.status, 200);
  assert.equal(server.state.handled, 1);
});

test('a policy that names anything but a bare origin is a usage error', () => {
  assert.equal(normalizeAllowedOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(normalizeAllowedOrigin(' HTTPS://Hane.Example/ '), 'https://hane.example');

  for (const value of ['', '   ', 'localhost:5173', 'http://localhost:5173/settings', 'http://localhost:5173?x=1', 'http://user:pw@localhost:5173', 'ftp://localhost:5173', 'http://evil.example/*', 'not a url', null, 42]) {
    assert.throws(() => normalizeAllowedOrigin(value), TypeError, String(value));
  }

  assert.throws(() => createRequestGuard({ allowedOrigins: ['http://localhost:5173/evil'] }), TypeError);
});


test('image bodies are accepted only for explicit avatar POSTs from an allowed page', async (t) => {
  const server = await guarded({ allowedOrigins: ALLOWED_UI });
  t.after(() => server.close());
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    const allowed = await wire({ port: server.port, method: 'POST', path: '/api/profile/avatar', headers: { ...LOCAL_PAGE, 'content-type': type }, body: 'image bytes' });
    assert.equal(allowed.status, 200, type);
  }
  for (const [path, method, type, extra, status] of [
    ['/api/missions', 'POST', 'image/png', {}, 415],
    ['/api/profile/avatar', 'PATCH', 'image/png', {}, 415],
    ['/api/profile/avatar', 'POST', 'image/svg+xml', {}, 415],
    ['/api/profile/avatar', 'POST', 'image/png', { 'x-hane-request': '' }, 403],
    ['/api/profile/avatar', 'POST', 'image/png', { origin: 'https://evil.example' }, 403],
    ['/api/profile/avatar', 'POST', 'image/png', { 'sec-fetch-site': 'cross-site' }, 403],
    ['/api/missions', 'POST', 'application/json-foo', {}, 415],
    ['/api/missions', 'POST', 'application/jsonp', {}, 415],
  ]) {
    const refused = await wire({ port: server.port, method, path, headers: { ...LOCAL_PAGE, 'content-type': type, ...extra }, body: '{}' });
    assert.equal(refused.status, status, method + ' ' + path + ' ' + type);
  }
  assert.equal(server.state.handled, 4);
});


test('IPv6 self-origin remains accepted and profile mode preserves native opt-in', async t => {
 const server=await guarded({requireExplicitRequest:true});t.after(()=>server.close());
 const self=await wire({port:server.port,headers:{host:'[::1]:7788',origin:'http://[::1]:7788'}});assert.equal(self.status,200);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) {
  const refused=await wire({port:server.port,method});assert.equal(refused.status,403,method);
 }
 const explicit=await wire({port:server.port,method:'POST',headers:{'x-hane-request':'1'}});assert.equal(explicit.status,200);
 assert.equal(server.state.handled,2);
});
