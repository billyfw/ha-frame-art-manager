const assert = require('assert');
const lastDisplays = require('../last_displays');

console.log('\nTesting last displays per home...\n');

lastDisplays.reset();
assert.deepStrictEqual(lastDisplays.get('lau'), [], 'a home never seen has no displays to name');
console.log('  ok  a home never seen lists no displays');

lastDisplays.remember('lau', [{ name: 'KitchenHall', device_id: 'a' }, { name: 'Lanai', device_id: 'b' }]);
assert.deepStrictEqual(lastDisplays.get('lau'), ['KitchenHall', 'Lanai'], 'the names from the last answer');
console.log('  ok  the names from the last answer are kept');

lastDisplays.remember('lau', [{ name: 'KitchenHall', device_id: 'a' }]);
assert.deepStrictEqual(lastDisplays.get('lau'), ['KitchenHall'], 'a later answer replaces the earlier one');
console.log('  ok  a later answer replaces the earlier one');

assert.deepStrictEqual(lastDisplays.get('madrone'), [], 'homes are kept apart');
console.log('  ok  homes are kept apart');

console.log('\nAll last displays tests passed\n');
