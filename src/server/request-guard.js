/**
 * The browser boundary of the loopback API.
 *
 * Binding to 127.0.0.1 keeps remote machines out; it does not keep *pages* out.
 * Any website the user opens can send a request to loopback, and a simple CORS
 * request — a form post, or a `fetch` with `text/plain` — reaches the server
 * without a preflight it could fail. This guard closes that door: a request
 * carrying browser identity is accepted only from an origin this server was told
 * to serve, and a request whose Host is not loopback is refused before routing,
 * so a domain rebound to 127.0.0.1 cannot reach the API either.
 *
 * A request with neither `Origin` nor `Sec-Fetch-Site` is not a web page (the
 * CLI, tests, local tools) and stays unrestricted. That asymmetry is deliberate:
 * a process that can already speak HTTP to loopback can read the same SQLite
 * file directly, so pretending to authenticate it would secure nothing while
 * breaking every local client.
 *
 * The guard is a property of the server, not of any feature: it runs whether or
 * not a personal profile, a team, or a provider exists.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CROSS_SITE_FETCHES = new Set(['cross-site', 'cross-origin']);

export class RequestGuardError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RequestGuardError';
    this.status = status;
  }
}

/** Splits `127.0.0.1:7788` and `[::1]:7788` into their host and port parts. */
function splitHost(value) {
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close === -1) return { host: trimmed, port: '' };
    const rest = trimmed.slice(close + 1);
    // The brackets only exist to delimit the port in a URL; they are not part
    // of the address, so a caller comparing against a Host header and a caller
    // comparing against a `--host` value both end up holding `::1`.
    return { host: trimmed.slice(1, close), port: rest.startsWith(':') ? rest.slice(1) : '' };
  }
  const colon = trimmed.indexOf(':');
  if (colon === -1 || colon !== trimmed.lastIndexOf(':')) return { host: trimmed, port: '' };
  return { host: trimmed.slice(0, colon), port: trimmed.slice(colon + 1) };
}

/**
 * The one place that knows what "loopback" is, for callers that hold an address
 * rather than a Host header — a server deciding whether its own bind needs the
 * Host rule at all. Accepts `::1` and `[::1]`, with or without a port.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLoopbackHost(value) {
  return LOOPBACK_HOSTS.has(splitHost(value ?? '').host);
}

/**
 * A page origin is a scheme, a host and an optional port, and nothing else; a
 * path or a wildcard here would silently widen the allowlist past one site.
 * @param {unknown} value
 * @returns {string} the normalized origin
 */
export function normalizeAllowedOrigin(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (candidate.length === 0) throw new TypeError('--ui-origin must not be empty.');
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError(`--ui-origin must be an absolute origin like http://localhost:5173, got "${value}".`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('--ui-origin must use http or https.');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError(`--ui-origin must be a bare origin without a path, query or credentials, got "${value}".`);
  }
  return parsed.origin.toLowerCase();
}

/**
 * The origin a page would report when it was served by this very address. The
 * loopback API answers over plain http, so the scheme is not a guess; only the
 * exact host and port the client used count. Any localhost port would be a
 * widening: a different local service is a different site, not the same origin.
 */
function sameOriginOf(host, port) {
  return `http://${host}${port.length > 0 ? `:${port}` : ''}`;
}

/**
 * @param {{ allowedOrigins?: readonly string[], allowAnyHost?: boolean }} options
 *        `allowAnyHost` is set only when the server was bound away from
 *        loopback, where a loopback-only Host rule would refuse its own clients.
 * @returns {(request: { method?: string, headers?: Record<string, string | string[] | undefined> }) => void}
 *          throws a RequestGuardError when the request must not reach the router
 */
export function createRequestGuard({ allowedOrigins = [], allowAnyHost = false } = {}) {
  const origins = new Set(allowedOrigins.map(normalizeAllowedOrigin));

  return function guard(request) {
    const headers = request.headers ?? {};
    const { host, port } = splitHost(headers.host ?? '');
    if (host.length === 0) throw new RequestGuardError(400, 'Request is missing a Host header.');
    if (!allowAnyHost && !LOOPBACK_HOSTS.has(host)) {
      throw new RequestGuardError(403, `Host "${headers.host}" is not the address this server binds. hint: a domain rebound to 127.0.0.1 never reaches the router, even when the page that asked for it is an allowed origin.`);
    }

    const origin = headers.origin;
    const fetchSite = String(headers['sec-fetch-site'] ?? '').toLowerCase();
    const method = String(request.method ?? 'GET').toUpperCase();
    const mutating = MUTATING_METHODS.has(method);
    if (method === 'OPTIONS' && (origin !== undefined || fetchSite.length > 0)) {
      // No CORS is offered, so a preflight can only ever fail; say so plainly.
      throw new RequestGuardError(403, 'Cross-origin access is not available on this API.');
    }
    if (origin === undefined && fetchSite.length === 0) return;

    if (CROSS_SITE_FETCHES.has(fetchSite)) {
      throw new RequestGuardError(403, `A ${method} from a ${fetchSite} page is refused. hint: the API answers pages served from an allowed origin only (hane serve --ui-origin <origin>).`);
    }

    if (origin !== undefined) {
      const normalized = String(origin).trim().toLowerCase();
      if (normalized === 'null' || normalized === 'nil') {
        if (mutating) throw new RequestGuardError(403, 'An opaque (null) origin cannot change server state.');
      } else if (!origins.has(normalized) && normalized !== sameOriginOf(host, port)) {
        throw new RequestGuardError(403, `Origin "${origin}" is not allowed. hint: hane serve --ui-origin ${normalized}`);
      }
    }

    if (!mutating) return;
    if (headers['x-hane-request'] !== '1') {
      throw new RequestGuardError(403, 'A request from a page must identify itself with x-hane-request: 1.');
    }
    const hasBody = Number(headers['content-length'] ?? 0) > 0 || headers['transfer-encoding'] !== undefined;
    if (!hasBody) return;
    const contentType = String(headers['content-type'] ?? '');
    if (!/^application\/json\b/i.test(contentType)) {
      throw new RequestGuardError(415, 'A request from a page with a body must be application/json. hint: text/plain form posts are refused so a page cannot reach this API without CORS.');
    }
  };
}
