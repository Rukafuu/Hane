import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubAuthorizationPendingError, pollGitHubDeviceAuthorization, startGitHubDeviceAuthorization } from '../src/integrations/github-device-flow.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('starts GitHub device flow with a client id and minimal onboarding scopes', async () => {
  let request;
  const authorization = await startGitHubDeviceAuthorization({
    clientId: 'Iv1.test',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({ device_code: 'device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    },
  });
  assert.equal(request.url, 'https://github.com/login/device/code');
  assert.equal(new URLSearchParams(request.init.body).get('client_id'), 'Iv1.test');
  assert.equal(new URLSearchParams(request.init.body).get('scope'), 'read:user repo:status');
  assert.deepEqual(authorization, { deviceCode: 'device', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 });
});

test('reports pending authorization and resolves the account without persisting a token', async () => {
  await assert.rejects(
    pollGitHubDeviceAuthorization({ clientId: 'Iv1.test', deviceCode: 'device', fetchImpl: async () => jsonResponse({ error: 'authorization_pending' }) }),
    GitHubAuthorizationPendingError,
  );
  const requests = [];
  const connection = await pollGitHubDeviceAuthorization({
    clientId: 'Iv1.test',
    deviceCode: 'device',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return url.includes('/access_token')
        ? jsonResponse({ access_token: 'gho_private', scope: 'read:user,repo:status' })
        : jsonResponse({ login: 'hane-user' });
    },
  });
  assert.deepEqual(connection, { accessToken: 'gho_private', login: 'hane-user', scopes: ['read:user', 'repo:status'] });
  assert.equal(requests[1].init.headers.authorization, 'Bearer gho_private');
});
