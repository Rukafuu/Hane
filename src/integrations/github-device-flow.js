const GITHUB_DEVICE_ENDPOINT = 'https://github.com/login/device/code';
const GITHUB_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_ENDPOINT = 'https://api.github.com/user';

export class GitHubAuthorizationPendingError extends Error {}

export async function startGitHubDeviceAuthorization({ clientId, fetchImpl = fetch }) {
  assertClientId(clientId);
  const response = await fetchImpl(GITHUB_DEVICE_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: 'read:user repo:status' }),
  });
  const body = await readJson(response, 'GitHub device authorization');
  if (!body.device_code || !body.user_code || !body.verification_uri || !Number.isInteger(body.expires_in) || !Number.isInteger(body.interval)) {
    throw new Error('GitHub returned an incomplete device authorization response.');
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresIn: body.expires_in,
    interval: body.interval,
  };
}

export async function pollGitHubDeviceAuthorization({ clientId, deviceCode, fetchImpl = fetch }) {
  assertClientId(clientId);
  if (typeof deviceCode !== 'string' || deviceCode.length < 1) throw new TypeError('deviceCode is required.');
  const tokenResponse = await fetchImpl(GITHUB_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const token = await readJson(tokenResponse, 'GitHub token exchange');
  if (token.error === 'authorization_pending' || token.error === 'slow_down') throw new GitHubAuthorizationPendingError(token.error);
  if (token.error) throw new Error(`GitHub authorization failed: ${token.error}.`);
  if (typeof token.access_token !== 'string' || token.access_token.length === 0) throw new Error('GitHub did not return an access token.');

  const userResponse = await fetchImpl(GITHUB_USER_ENDPOINT, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}` } });
  const user = await readJson(userResponse, 'GitHub user lookup');
  if (typeof user.login !== 'string' || user.login.length === 0) throw new Error('GitHub did not return an account login.');
  return { accessToken: token.access_token, login: user.login, scopes: typeof token.scope === 'string' ? token.scope.split(',').filter(Boolean) : [] };
}

function assertClientId(clientId) {
  if (typeof clientId !== 'string' || clientId.trim().length === 0) throw new Error('GitHub connection is not configured. Start Hane with --github-client-id <client-id>.');
}

async function readJson(response, action) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`${action} returned invalid JSON.`); }
  if (!response.ok) throw new Error(`${action} failed (HTTP ${response.status}).`);
  return body;
}
