/**
 * Service calls to a house's Home Assistant over its WebSocket API.
 *
 * Why not REST: HA's REST service endpoint (`POST /api/services/<domain>/<service>`) answers
 * every error a service raises with a bare 500 (HA 2026.9, helpers/http.py translates only
 * vol.Invalid, ServiceNotFound and Unauthorized), so the reason the shuffler gives ("Art file
 * not found", "another upload is already in progress", "TV ... is unreachable") never reached
 * the manager, and the UI read "Request failed with status code 500" (2026-11-03, three Show on
 * TV failures at the second house). The WebSocket API's `call_service` answers an error with
 * the service's own message and a code (`service_validation_error`, `home_assistant_error`,
 * `unknown_error`), so the manager can say what went wrong.
 *
 * Same token, same base URL and the same SOCKS agent as the REST calls (houses.js). One
 * connection per call: connect, auth, one `call_service`, close. `timeout` covers the whole
 * exchange; HA holds the call until the service returns (a display takes up to ~35 s).
 */

const WebSocket = require('ws');
const houses = require('./houses');

/** A service call that did not succeed, with the reason as Home Assistant reported it. */
class HAServiceError extends Error {
  constructor(message, { code, translationKey, translationPlaceholders } = {}) {
    super(message);
    this.name = 'HAServiceError';
    this.code = code || 'unknown_error';
    this.translationKey = translationKey;
    this.translationPlaceholders = translationPlaceholders;
  }
}

/** The error of a failed `result` message as an HAServiceError (the WS prefix dropped). */
function errorFromResult(error) {
  const err = error || {};
  let message = err.message || 'Home Assistant reported an error';
  if (err.code === 'service_validation_error') {
    message = message.replace(/^Validation error: /, '');
  }
  return new HAServiceError(message, {
    code: err.code,
    translationKey: err.translation_key,
    translationPlaceholders: err.translation_placeholders,
  });
}

/** ws:// or wss:// endpoint of a house's WebSocket API. */
function websocketUrl(house) {
  return `${house.baseUrl.replace(/^http/, 'ws')}/api/websocket`;
}

/**
 * Call `domain.service` with `serviceData` at `house` and resolve with HA's result once the
 * service has returned. Rejects with an HAServiceError: the service's own message and code when
 * the service failed, or `unreachable`, `auth_invalid`, `closed`, `timeout` for the transport.
 */
function callService(house, domain, service, serviceData, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const agent = houses.getProxyAgent() || undefined;
    const ws = new WebSocket(websocketUrl(house), { agent, handshakeTimeout: timeout });
    let settled = false;
    const timer = setTimeout(() => {
      finish(reject, new HAServiceError(
        `No answer from Home Assistant within ${Math.round(timeout / 1000)} s`,
        { code: 'timeout' }
      ));
    }, timeout);

    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch (e) {
        // already gone
      }
      settle(value);
    }

    function send(msg) {
      ws.send(JSON.stringify(msg), (err) => {
        if (err) finish(reject, new HAServiceError(`Cannot reach Home Assistant: ${err.message}`, { code: 'unreachable' }));
      });
    }

    ws.on('error', (err) => {
      finish(reject, new HAServiceError(`Cannot reach Home Assistant: ${err.message}`, { code: 'unreachable' }));
    });
    ws.on('close', () => {
      finish(reject, new HAServiceError('Home Assistant closed the connection before answering', { code: 'closed' }));
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      switch (msg.type) {
        case 'auth_required':
          send({ type: 'auth', access_token: house.token });
          break;
        case 'auth_ok':
          send({ id: 1, type: 'call_service', domain, service, service_data: serviceData || {} });
          break;
        case 'auth_invalid':
          finish(reject, new HAServiceError(
            `Home Assistant rejected the token: ${msg.message || 'auth_invalid'}`,
            { code: 'auth_invalid' }
          ));
          break;
        case 'result':
          if (msg.id !== 1) return;
          if (msg.success) finish(resolve, msg.result);
          else finish(reject, errorFromResult(msg.error));
          break;
        default:
          // pong, event: nothing for a one-shot call
      }
    });
  });
}

module.exports = { callService, HAServiceError, errorFromResult, websocketUrl };
