const assert = require('assert');
const { explainDisplayFailure, displayLabel } = require('../display_failure');

console.log('\nTesting Show on TV failure wording...\n');

// The picture is in the library but the house has not pulled it yet (the common case right
// after an add: the push, the 15 s poke delay, the house's sync).
let r = explainDisplayFailure({
  message: 'Art file not found: /media/frame_art/library/sunset-1a2b3c4d.jpeg',
  code: 'unknown_error',
  houseName: 'Seaside',
  tvName: 'Great Room',
  unpushed: false,
});
assert.strictEqual(r.reason, 'not_at_house');
assert.strictEqual(r.status, 409);
assert.strictEqual(r.text, "That picture hasn't reached the Seaside house yet. Try again in about 30 seconds.");
console.log('  ok  a file the house has not pulled yet');

// The same error while the library has unpushed commits: the house cannot have it, and
// waiting 30 s will not help (the 2026-10-20 push outage looked exactly like this).
r = explainDisplayFailure({
  message: 'Art file not found: /media/frame_art/library/sunset-1a2b3c4d.jpeg',
  houseName: 'Seaside',
  unpushed: true,
});
assert.strictEqual(r.reason, 'not_pushed');
assert.strictEqual(r.status, 409);
assert.ok(r.text.includes('has not been pushed to GitHub yet'), r.text);
assert.ok(r.text.includes('the Seaside house cannot fetch it'), r.text);
console.log('  ok  a file the manager has not pushed yet');

// The TV is in the middle of another upload (the shuffle, or an earlier Show on TV).
r = explainDisplayFailure({
  message: 'Upload skipped for GreatRoom: another upload is already in progress. Please wait a moment and try again.',
  code: 'service_validation_error',
  houseName: 'Seaside',
  tvName: 'Great Room',
});
assert.strictEqual(r.reason, 'tv_busy');
assert.strictEqual(r.status, 409);
assert.strictEqual(r.text, 'The Great Room TV is busy putting up another picture. Try again in about 30 seconds.');
console.log('  ok  a TV busy with another upload');

// Any other reason: the shuffler's own words, unchanged.
r = explainDisplayFailure({
  message: 'TV 192.0.2.10 is unreachable (timeout): Unable to connect',
  code: 'unknown_error',
  houseName: 'Seaside',
  tvName: 'Great Room',
});
assert.strictEqual(r.reason, 'unknown_error');
assert.strictEqual(r.status, 500);
assert.strictEqual(r.text, 'TV 192.0.2.10 is unreachable (timeout): Unable to connect');
console.log('  ok  other reasons pass through as worded');

// Nothing known at all.
r = explainDisplayFailure({ message: '', code: undefined });
assert.strictEqual(r.reason, 'failed');
assert.strictEqual(r.text, 'Failed to send command to TV');
console.log('  ok  an empty reason keeps the old generic text');

// No house name configured (single-house, add-on style).
r = explainDisplayFailure({ message: 'Art file not found: x.jpeg' });
assert.strictEqual(r.text, "That picture hasn't reached the house yet. Try again in about 30 seconds.");
console.log('  ok  no house name: "the house"');

// Display labels: add "TV" only when the name does not already say what it is.
assert.strictEqual(displayLabel('Great Room'), 'The Great Room TV');
assert.strictEqual(displayLabel('Fireplace Frame'), 'The Fireplace Frame');
assert.strictEqual(displayLabel('Office TV'), 'The Office TV');
assert.strictEqual(displayLabel('Kitchen Tablet'), 'The Kitchen Tablet');
assert.strictEqual(displayLabel(''), 'That TV');
assert.strictEqual(displayLabel(undefined), 'That TV');
console.log('  ok  display labels');

console.log('\nAll Show on TV failure wording tests passed\n');
