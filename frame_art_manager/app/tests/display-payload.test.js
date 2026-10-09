const assert = require('assert');
const { displayPayload } = require('../display_payload');

console.log('\nTesting display_image payloads...\n');

// Central deployment: the house's integration resolves the filename in its own library.
assert.deepStrictEqual(
  displayPayload({ house: { id: 'madrone' }, frameArtPath: '/data/frame_art', filename: 'a-1.jpeg', device_id: 'dev1' }),
  { filename: 'a-1.jpeg', device_id: 'dev1' },
  'central: filename and target only, no path from this machine'
);
console.log('  ok  central deployment sends the filename only');

assert.deepStrictEqual(
  displayPayload({ house: { id: 'lau' }, frameArtPath: '/data/frame_art', filename: 'a-1.jpeg', entity_id: 'image.wall', matte: 'flexible_sage', filter: 'Pastel' }),
  { filename: 'a-1.jpeg', entity_id: 'image.wall', matte: 'flexible_sage', filter: 'Pastel' },
  'central: matte, filter and entity_id pass through'
);
console.log('  ok  central deployment keeps matte, filter and entity_id');

// Add-on deployment: manager and integration share /config/www, the old fields still go.
assert.deepStrictEqual(
  displayPayload({ house: undefined, frameArtPath: '/config/www/frame_art', filename: 'a-1.jpeg', device_id: 'dev1' }),
  {
    filename: 'a-1.jpeg',
    image_path: '/config/www/frame_art/library/a-1.jpeg',
    image_url: '/local/frame_art/library/a-1.jpeg',
    device_id: 'dev1',
  },
  'add-on: image_path and image_url as before'
);
console.log('  ok  add-on deployment still sends image_path and image_url');

console.log('\nAll display payload tests passed\n');
