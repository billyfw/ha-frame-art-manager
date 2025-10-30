const assert = require('assert');

// Copy the validation functions from app.js
function isValidIPAddress(ip) {
  if (!ip || typeof ip !== 'string') {
    return false;
  }
  
  // Basic IPv4 validation
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Pattern.test(ip)) {
    return false;
  }
  
  // Check each octet is 0-255
  const octets = ip.split('.');
  return octets.every(octet => {
    const num = parseInt(octet, 10);
    return num >= 0 && num <= 255;
  });
}

function isValidMacAddress(mac) {
  if (!mac || typeof mac !== 'string') {
    return false;
  }
  
  // Remove all non-hex characters
  const cleaned = mac.replace(/[^0-9a-fA-F]/g, '');
  
  // MAC address should be exactly 12 hex characters
  return cleaned.length === 12;
}

console.log('\n🧪 Testing IP Address Validation...\n');

// Valid IP addresses
assert.strictEqual(isValidIPAddress('192.168.1.1'), true, 'Should accept 192.168.1.1');
assert.strictEqual(isValidIPAddress('10.0.0.1'), true, 'Should accept 10.0.0.1');
assert.strictEqual(isValidIPAddress('255.255.255.255'), true, 'Should accept 255.255.255.255');
assert.strictEqual(isValidIPAddress('0.0.0.0'), true, 'Should accept 0.0.0.0');
assert.strictEqual(isValidIPAddress('127.0.0.1'), true, 'Should accept 127.0.0.1');

// Invalid IP addresses
assert.strictEqual(isValidIPAddress('256.1.1.1'), false, 'Should reject 256.1.1.1 (octet > 255)');
assert.strictEqual(isValidIPAddress('192.168.1.256'), false, 'Should reject 192.168.1.256 (octet > 255)');
assert.strictEqual(isValidIPAddress('192.168.1'), false, 'Should reject 192.168.1 (only 3 octets)');
assert.strictEqual(isValidIPAddress('192.168.1.1.1'), false, 'Should reject 192.168.1.1.1 (5 octets)');
assert.strictEqual(isValidIPAddress('abc.def.ghi.jkl'), false, 'Should reject abc.def.ghi.jkl (non-numeric)');
assert.strictEqual(isValidIPAddress('192.168.-1.1'), false, 'Should reject 192.168.-1.1 (negative octet)');
assert.strictEqual(isValidIPAddress(''), false, 'Should reject empty string');
assert.strictEqual(isValidIPAddress(null), false, 'Should reject null');
assert.strictEqual(isValidIPAddress(undefined), false, 'Should reject undefined');
assert.strictEqual(isValidIPAddress(12345), false, 'Should reject number type');

console.log('✅ All IP address validation tests passed!\n');

console.log('🧪 Testing MAC Address Validation...\n');

// Valid MAC addresses (various formats)
assert.strictEqual(isValidMacAddress('AA:BB:CC:DD:EE:FF'), true, 'Should accept AA:BB:CC:DD:EE:FF (colon)');
assert.strictEqual(isValidMacAddress('aa:bb:cc:dd:ee:ff'), true, 'Should accept aa:bb:cc:dd:ee:ff (lowercase colon)');
assert.strictEqual(isValidMacAddress('AA-BB-CC-DD-EE-FF'), true, 'Should accept AA-BB-CC-DD-EE-FF (dash)');
assert.strictEqual(isValidMacAddress('AABBCCDDEEFF'), true, 'Should accept AABBCCDDEEFF (no separator)');
assert.strictEqual(isValidMacAddress('aabbccddeeff'), true, 'Should accept aabbccddeeff (lowercase no separator)');
assert.strictEqual(isValidMacAddress('AA.BB.CC.DD.EE.FF'), true, 'Should accept AA.BB.CC.DD.EE.FF (dot)');
assert.strictEqual(isValidMacAddress('AA BB CC DD EE FF'), true, 'Should accept AA BB CC DD EE FF (space)');
assert.strictEqual(isValidMacAddress('00:11:22:33:44:55'), true, 'Should accept 00:11:22:33:44:55');
assert.strictEqual(isValidMacAddress('FF:FF:FF:FF:FF:FF'), true, 'Should accept FF:FF:FF:FF:FF:FF');
assert.strictEqual(isValidMacAddress('a1:b2:c3:d4:e5:f6'), true, 'Should accept a1:b2:c3:d4:e5:f6 (mixed)');

// Invalid MAC addresses
assert.strictEqual(isValidMacAddress('AA:BB:CC'), false, 'Should reject AA:BB:CC (too short)');
assert.strictEqual(isValidMacAddress('AA:BB:CC:DD:EE'), false, 'Should reject AA:BB:CC:DD:EE (only 10 hex chars)');
assert.strictEqual(isValidMacAddress('AA:BB:CC:DD:EE:FF:00'), false, 'Should reject AA:BB:CC:DD:EE:FF:00 (14 hex chars)');
assert.strictEqual(isValidMacAddress('GG:HH:II:JJ:KK:LL'), false, 'Should reject GG:HH:II:JJ:KK:LL (non-hex)');
assert.strictEqual(isValidMacAddress('ZZ:ZZ:ZZ:ZZ:ZZ:ZZ'), false, 'Should reject ZZ:ZZ:ZZ:ZZ:ZZ:ZZ (non-hex)');
assert.strictEqual(isValidMacAddress(''), false, 'Should reject empty string');
assert.strictEqual(isValidMacAddress(null), false, 'Should reject null');
assert.strictEqual(isValidMacAddress(undefined), false, 'Should reject undefined');
assert.strictEqual(isValidMacAddress(123456), false, 'Should reject number type');
assert.strictEqual(isValidMacAddress('AA:BB:CC:DD:EE:FG'), false, 'Should reject AA:BB:CC:DD:EE:FG (G is not hex)');

console.log('✅ All MAC address validation tests passed!\n');

console.log('✅ All validation tests passed!\n');
