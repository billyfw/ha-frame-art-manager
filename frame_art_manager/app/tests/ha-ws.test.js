/**
 * ha_ws.callService against a fake Home Assistant WebSocket API on localhost: the auth
 * handshake, a success, the error shapes HA sends for a service that raised, a bad token,
 * a house that never answers and a house that is not there.
 */
const assert = require('assert');
const { WebSocketServer } = require('ws');
const { callService, HAServiceError, errorFromResult, websocketUrl } = require('../ha_ws');

console.log('\nTesting Home Assistant WebSocket service calls...\n');

const TOKEN = 'test-long-lived-token';

/**
 * Start a fake HA: sends auth_required, checks the token, then hands each call_service
 * message to `answer(msg)` which returns the `result` message to send (or nothing to stall).
 * Resolves with { house, received, close }.
 */
function fakeHA(answer) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const received = [];
    wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.9.0' }));
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (msg.type === 'auth') {
          if (msg.access_token === TOKEN) socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.9.0' }));
          else socket.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' }));
          return;
        }
        if (msg.type === 'call_service') {
          const reply = answer(msg);
          if (reply) socket.send(JSON.stringify({ id: msg.id, type: 'result', ...reply }));
        }
      });
    });
    wss.on('listening', () => {
      const { port } = wss.address();
      resolve({
        house: { id: 'seaside', name: 'Seaside', baseUrl: `http://127.0.0.1:${port}`, token: TOKEN },
        received,
        close: () => new Promise((done) => wss.close(() => done())),
      });
    });
  });
}

async function run() {
  // URL shape.
  assert.strictEqual(websocketUrl({ baseUrl: 'http://192.0.2.5:8123' }), 'ws://192.0.2.5:8123/api/websocket');
  assert.strictEqual(websocketUrl({ baseUrl: 'https://ha.example.test' }), 'wss://ha.example.test/api/websocket');
  console.log('  ok  ws:// and wss:// from the house base URL');

  // Success: auth, one call_service with the payload, the result comes back.
  let ha = await fakeHA(() => ({ success: true, result: { context: { id: 'abc' } } }));
  let result = await callService(ha.house, 'frame_art_shuffler', 'display_image', { filename: 'a.jpeg', device_id: 'dev1' });
  assert.deepStrictEqual(result, { context: { id: 'abc' } });
  assert.strictEqual(ha.received[0].type, 'auth');
  assert.strictEqual(ha.received[0].access_token, TOKEN);
  assert.deepStrictEqual(ha.received[1], {
    id: 1,
    type: 'call_service',
    domain: 'frame_art_shuffler',
    service: 'display_image',
    service_data: { filename: 'a.jpeg', device_id: 'dev1' },
  });
  await ha.close();
  console.log('  ok  auth handshake, one call_service, result');

  // The service raised ServiceValidationError: HA's "Validation error: " prefix is dropped.
  ha = await fakeHA(() => ({
    success: false,
    error: {
      code: 'service_validation_error',
      message: 'Validation error: Upload skipped for GreatRoom: another upload is already in progress. Please wait a moment and try again.',
    },
  }));
  let err = await callService(ha.house, 'frame_art_shuffler', 'display_image', {}).then(() => null, (e) => e);
  assert.ok(err instanceof HAServiceError, 'rejects with HAServiceError');
  assert.strictEqual(err.code, 'service_validation_error');
  assert.strictEqual(err.message, 'Upload skipped for GreatRoom: another upload is already in progress. Please wait a moment and try again.');
  await ha.close();
  console.log('  ok  ServiceValidationError: the service\'s own words and code');

  // The service raised a plain exception (FrameArtUploadError): unknown_error with the text.
  ha = await fakeHA(() => ({
    success: false,
    error: { code: 'unknown_error', message: 'Art file not found: /media/frame_art/library/a.jpeg' },
  }));
  err = await callService(ha.house, 'frame_art_shuffler', 'display_image', {}).then(() => null, (e) => e);
  assert.strictEqual(err.code, 'unknown_error');
  assert.strictEqual(err.message, 'Art file not found: /media/frame_art/library/a.jpeg');
  await ha.close();
  console.log('  ok  a plain exception: unknown_error with the text');

  // Translation fields ride along when HA sends them.
  err = errorFromResult({
    code: 'home_assistant_error',
    message: 'TV is unreachable',
    translation_key: 'tv_unreachable',
    translation_domain: 'frame_art_shuffler',
    translation_placeholders: { ip: '192.0.2.10' },
  });
  assert.strictEqual(err.translationKey, 'tv_unreachable');
  assert.deepStrictEqual(err.translationPlaceholders, { ip: '192.0.2.10' });
  assert.strictEqual(err.message, 'TV is unreachable');
  console.log('  ok  translation key and placeholders kept');

  // A bad token.
  ha = await fakeHA(() => ({ success: true, result: null }));
  err = await callService({ ...ha.house, token: 'wrong' }, 'frame_art_shuffler', 'display_image', {}).then(() => null, (e) => e);
  assert.strictEqual(err.code, 'auth_invalid');
  assert.ok(err.message.includes('Invalid access token'), err.message);
  await ha.close();
  console.log('  ok  a rejected token');

  // A house that accepts the call and never answers: the timeout, and the socket is closed.
  ha = await fakeHA(() => null);
  const t0 = Date.now();
  err = await callService(ha.house, 'frame_art_shuffler', 'display_image', {}, { timeout: 300 }).then(() => null, (e) => e);
  assert.strictEqual(err.code, 'timeout');
  assert.ok(Date.now() - t0 < 2000, 'gave up on the clock');
  assert.ok(err.message.includes('No answer from Home Assistant'), err.message);
  await ha.close();
  console.log('  ok  no answer: timeout');

  // Nothing listening.
  ha = await fakeHA(() => null);
  const deadHouse = { ...ha.house };
  await ha.close();
  err = await callService(deadHouse, 'frame_art_shuffler', 'display_image', {}, { timeout: 2000 }).then(() => null, (e) => e);
  assert.strictEqual(err.code, 'unreachable');
  assert.ok(err.message.startsWith('Cannot reach Home Assistant'), err.message);
  console.log('  ok  nothing listening: unreachable');

  console.log('\nAll Home Assistant WebSocket tests passed\n');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
