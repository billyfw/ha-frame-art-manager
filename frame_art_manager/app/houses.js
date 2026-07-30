/**
 * Multi-home configuration for the central (Fly-hosted) manager.
 *
 * Since the 2026-07 migration this app is the single writer for the art library
 * and talks to EACH house's Home Assistant over the tailnet, instead of the
 * Supervisor proxy it used as an add-on. See docs/MULTI_HOME_PLAN.md.
 *
 * Config: HOUSES_JSON env, e.g.
 *   [{"id":"madrone","name":"Madrone","ha_url":"http://100.81.0.118:8123",
 *     "token_env":"HA_TOKEN_MADRONE"}]
 * Tokens are HA long-lived access tokens, each in its own env var / Fly secret.
 *
 * Outbound calls to tailnet or subnet-routed addresses must traverse the
 * tailscaled SOCKS proxy (TAILSCALE_PROXY), because tailscaled runs in
 * userspace-networking mode on Fly — there is no kernel route to 100.x.
 */

const { SocksProxyAgent } = require('socks-proxy-agent');

let cachedHouses = null;
let cachedAgent;

function getHouses() {
  if (cachedHouses) return cachedHouses;
  let parsed = [];
  try {
    parsed = JSON.parse(process.env.HOUSES_JSON || '[]');
  } catch (err) {
    console.warn('HOUSES_JSON is not valid JSON; multi-house features disabled:', err.message);
    parsed = [];
  }
  cachedHouses = parsed
    .filter((h) => h && h.id && h.ha_url)
    .map((h) => ({
      id: h.id,
      name: h.name || h.id,
      baseUrl: String(h.ha_url).replace(/\/$/, ''),
      tokenEnv: h.token_env,
      token: h.token_env ? process.env[h.token_env] : undefined,
    }));
  return cachedHouses;
}

/** Houses that are actually usable (have a token present). */
function getUsableHouses() {
  return getHouses().filter((h) => h.token);
}

function isConfigured() {
  return getUsableHouses().length > 0;
}

/** Read the sticky house cookie without pulling in a cookie parser. */
function houseFromCookie(req) {
  const header = req && req.headers && req.headers.cookie;
  if (!header) return undefined;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith('house='));
  return match ? decodeURIComponent(match.slice('house='.length)) : undefined;
}

/**
 * Resolve which house a request targets: ?house=<id>, else the sticky `house`
 * cookie set by the UI switcher, else the first usable house. The cookie means
 * the ~100 existing frontend fetch calls need no changes to be house-aware.
 * Returns undefined when no houses are configured (add-on/dev paths).
 */
function resolveHouse(req) {
  const houses = getUsableHouses();
  if (!houses.length) return undefined;
  const wanted = (req && req.query && req.query.house) || houseFromCookie(req);
  if (!wanted) return houses[0];
  return houses.find((h) => h.id === wanted) || houses[0];
}

/** Public list for the UI switcher — never expose tokens. */
function listHousesPublic() {
  return getUsableHouses().map((h) => ({ id: h.id, name: h.name }));
}

/** SOCKS agent for tailnet-bound traffic, or undefined when not needed. */
function getProxyAgent() {
  if (cachedAgent !== undefined) return cachedAgent;
  const proxy = process.env.TAILSCALE_PROXY;
  cachedAgent = proxy ? new SocksProxyAgent(proxy) : null;
  return cachedAgent;
}

/**
 * Axios config fragment for talking to a house's HA REST API.
 * `apiBase` already includes /api.
 */
function houseRequestConfig(house) {
  const agent = getProxyAgent();
  const config = {
    apiBase: `${house.baseUrl}/api`,
    headers: {
      Authorization: `Bearer ${house.token}`,
      'Content-Type': 'application/json',
    },
    timeout: Number(process.env.HA_REQUEST_TIMEOUT_MS || 30000),
  };
  if (agent) {
    config.httpAgent = agent;
    config.httpsAgent = agent;
    // Let the SOCKS proxy resolve/route; without this axios uses the direct socket.
    config.proxy = false;
  }
  return config;
}

module.exports = {
  getHouses,
  getUsableHouses,
  isConfigured,
  resolveHouse,
  listHousesPublic,
  getProxyAgent,
  houseRequestConfig,
};
