#!/usr/bin/env node

/**
 * Metadata Helper Tests
 * Tests core metadata operations that handle file I/O and JSON parsing
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const MetadataHelper = require('../metadata_helper');

// Color output helpers
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logInfo(msg) {
  console.log(`${colors.yellow}ℹ${colors.reset} ${msg}`);
}

function logSection(msg) {
  console.log(`\n${colors.blue}${msg}${colors.reset}`);
}

// Test utilities
const tests = [];
let testPath;
let helper;

function test(name, fn) {
  tests.push({ name, fn });
}

// Setup: Create isolated test directory
async function setupTestEnv() {
  testPath = path.join(os.tmpdir(), 'frame-art-metadata-test-' + Date.now());
  await fs.mkdir(testPath, { recursive: true });
  await fs.mkdir(path.join(testPath, 'library'), { recursive: true });
  await fs.mkdir(path.join(testPath, 'thumbs'), { recursive: true });
  
  // Create initial metadata.json
  const initialMetadata = {
    images: {},
    tvs: [],
    tags: []
  };
  await fs.writeFile(
    path.join(testPath, 'metadata.json'),
    JSON.stringify(initialMetadata, null, 2)
  );
  
  helper = new MetadataHelper(testPath);
  console.log(`ℹ Test environment created at ${testPath}`);
}

// Cleanup: Remove test directory
async function cleanupTestEnv() {
  if (testPath) {
    await fs.rm(testPath, { recursive: true, force: true });
    console.log('ℹ Test environment cleaned up');
  }
}

// UNIT TESTS: Basic operations

test('MetadataHelper can be instantiated', () => {
  assert.ok(helper instanceof MetadataHelper);
  assert.strictEqual(helper.frameArtPath, testPath);
});

test('readMetadata returns valid structure', async () => {
  const metadata = await helper.readMetadata();
  assert.ok(metadata);
  assert.ok(typeof metadata === 'object');
  assert.ok(Array.isArray(metadata.images) || typeof metadata.images === 'object');
  assert.ok(Array.isArray(metadata.tvs));
  assert.ok(Array.isArray(metadata.tags));
});

test('getAllImages returns object', async () => {
  const images = await helper.getAllImages();
  assert.ok(typeof images === 'object');
  assert.ok(!Array.isArray(images)); // It's an object, not an array
});

test('getAllTVs returns array', async () => {
  const tvs = await helper.getAllTVs();
  assert.ok(Array.isArray(tvs));
});

test('getAllTags returns array', async () => {
  const tags = await helper.getAllTags();
  assert.ok(Array.isArray(tags));
});

// INTEGRATION TESTS: Full workflows

test('INTEGRATION: addImage stores metadata correctly', async () => {
  const filename = 'test-image-abc123.jpg';
  const matte = 'square_white';
  const filter = 'none';
  const tags = ['landscape', 'test'];
  
  // Create a dummy image file so sharp doesn't fail
  const imagePath = path.join(testPath, 'library', filename);
  const dummyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(imagePath, dummyImage);
  
  await helper.addImage(filename, matte, filter, tags);
  
  const images = await helper.getAllImages();
  const addedImage = images[filename];
  
  assert.ok(addedImage, 'Image should be added');
  assert.strictEqual(addedImage.matte, matte);
  assert.strictEqual(addedImage.filter, filter);
  assert.deepStrictEqual(addedImage.tags, tags);
  assert.ok(addedImage.dimensions, 'Should have dimensions');
  assert.ok(addedImage.added, 'Should have added timestamp');
});

test('INTEGRATION: updateImage modifies metadata', async () => {
  const filename = 'test-image-abc123.jpg';
  const updates = {
    matte: 'square_black',
    filter: 'soft',
    tags: ['updated', 'test']
  };
  
  await helper.updateImage(filename, updates);
  
  const images = await helper.getAllImages();
  const updatedImage = images[filename];
  
  assert.strictEqual(updatedImage.matte, updates.matte);
  assert.strictEqual(updatedImage.filter, updates.filter);
  assert.deepStrictEqual(updatedImage.tags, updates.tags);
});

test('INTEGRATION: renameImage updates filename', async () => {
  const oldFilename = 'test-image-abc123.jpg';
  const newFilename = 'renamed-image-abc123.jpg';
  
  await helper.renameImage(oldFilename, newFilename);
  
  const images = await helper.getAllImages();
  const renamedImage = images[newFilename];
  const oldImage = images[oldFilename];
  
  assert.ok(renamedImage, 'New filename should exist');
  assert.ok(!oldImage, 'Old filename should not exist');
  assert.strictEqual(renamedImage.matte, 'square_black'); // From previous test
});

test('INTEGRATION: deleteImage removes metadata', async () => {
  const filename = 'renamed-image-abc123.jpg';
  
  await helper.deleteImage(filename);
  
  const images = await helper.getAllImages();
  const deletedImage = images[filename];
  
  assert.ok(!deletedImage, 'Image should be deleted');
});

test('INTEGRATION: addTag and removeTag work correctly', async () => {
  const tagName = 'test-tag';
  
  // Add tag
  await helper.addTag(tagName);
  let tags = await helper.getAllTags();
  assert.ok(tags.includes(tagName), 'Tag should be added');
  
  // Remove tag
  await helper.removeTag(tagName);
  tags = await helper.getAllTags();
  assert.ok(!tags.includes(tagName), 'Tag should be removed');
});

test('INTEGRATION: addTV and removeTV work correctly', async () => {
  const name = 'Test TV';
  const ip = '192.168.1.100';
  
  // Add TV
  const tv = await helper.addTV(name, ip);
  assert.ok(tv.id, 'TV should have ID');
  assert.strictEqual(tv.name, name);
  assert.strictEqual(tv.ip, ip);
  assert.deepStrictEqual(tv.tags, []);
  assert.deepStrictEqual(tv.notTags, []);
  
  let tvs = await helper.getAllTVs();
  assert.strictEqual(tvs.length, 1);
  const persistedTV = tvs[0];
  assert.deepStrictEqual(persistedTV.tags, []);
  assert.deepStrictEqual(persistedTV.notTags, []);
  
  // Remove TV
  await helper.removeTV(tv.id);
  tvs = await helper.getAllTVs();
  assert.strictEqual(tvs.length, 0, 'TV should be removed');
});

test('INTEGRATION: updateTV modifies TV metadata', async () => {
  const name = 'Original TV';
  const ip = '192.168.1.100';
  
  const tv = await helper.addTV(name, ip);
  
  const newName = 'Updated TV';
  const newIp = '192.168.1.101';
  
  await helper.updateTV(tv.id, newName, newIp);
  
  const tvs = await helper.getAllTVs();
  const updatedTV = tvs.find(t => t.id === tv.id);
  
  assert.strictEqual(updatedTV.name, newName);
  assert.strictEqual(updatedTV.ip, newIp);
  assert.deepStrictEqual(updatedTV.tags, []);
  assert.deepStrictEqual(updatedTV.notTags, []);
});

test('INTEGRATION: updateTVTags assigns tags to TV', async () => {
  const tvs = await helper.getAllTVs();
  const tv = tvs[0];
  
  const tags = ['landscape', 'portrait'];
  const notTags = ['sunset'];
  await helper.updateTVTags(tv.id, tags, notTags);
  
  const updatedTVs = await helper.getAllTVs();
  const updatedTV = updatedTVs.find(t => t.id === tv.id);
  
  assert.deepStrictEqual(updatedTV.tags, tags);
  assert.deepStrictEqual(updatedTV.notTags, notTags);
});

test('INTEGRATION: getImagesByTag filters correctly', async () => {
  // Create dummy image files
  const image1 = path.join(testPath, 'library', 'image1-uuid1.jpg');
  const image2 = path.join(testPath, 'library', 'image2-uuid2.jpg');
  const image3 = path.join(testPath, 'library', 'image3-uuid3.jpg');
  const dummyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(image1, dummyImage);
  await fs.writeFile(image2, dummyImage);
  await fs.writeFile(image3, dummyImage);
  
  // Add test images with different tags
  await helper.addImage('image1-uuid1.jpg', 'none', 'none', ['landscape']);
  await helper.addImage('image2-uuid2.jpg', 'none', 'none', ['portrait']);
  await helper.addImage('image3-uuid3.jpg', 'none', 'none', ['landscape', 'nature']);
  
  const landscapeImages = await helper.getImagesByTag('landscape');
  assert.strictEqual(Object.keys(landscapeImages).length, 2, 'Should find 2 landscape images');
  
  const portraitImages = await helper.getImagesByTag('portrait');
  assert.strictEqual(Object.keys(portraitImages).length, 1, 'Should find 1 portrait image');
  
  const natureImages = await helper.getImagesByTag('nature');
  assert.strictEqual(Object.keys(natureImages).length, 1, 'Should find 1 nature image');
});

test('INTEGRATION: metadata persists across helper instances', async () => {
  // Create dummy image file
  const imagePath = path.join(testPath, 'library', 'persist-test-uuid.jpg');
  const dummyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(imagePath, dummyImage);
  
  // Add data with first helper instance
  await helper.addImage('persist-test-uuid.jpg', 'square_white', 'soft', ['test']);
  
  // Create new helper instance
  const newHelper = new MetadataHelper(testPath);
  const images = await newHelper.getAllImages();
  
  const persistedImage = images['persist-test-uuid.jpg'];
  assert.ok(persistedImage, 'Image should persist across instances');
  assert.strictEqual(persistedImage.matte, 'square_white');
});

test('INTEGRATION: corrupt metadata.json is handled gracefully', async () => {
  // Write corrupt JSON
  const metadataPath = path.join(testPath, 'metadata.json');
  await fs.writeFile(metadataPath, '{ invalid json }');
  
  // Suppress console.error for this test (we expect it to fail)
  const originalConsoleError = console.error;
  console.error = () => {};
  
  try {
    await helper.readMetadata();
    assert.fail('Should throw error on corrupt JSON');
  } catch (error) {
    assert.ok(error.message.includes('JSON') || error.message.includes('parse'));
  } finally {
    // Restore console.error
    console.error = originalConsoleError;
  }
  
  // Restore valid metadata for remaining tests
  const validMetadata = {
    images: {},
    tvs: [],
    tags: []
  };
  await fs.writeFile(metadataPath, JSON.stringify(validMetadata, null, 2));
});

// Test runner
async function runTests() {
  console.log('🧪 Running Metadata Helper Tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  try {
    await setupTestEnv();
    
    for (const test of tests) {
      try {
        await test.fn();
        logSuccess(test.name);
        passed++;
      } catch (error) {
        logError(`${test.name}`);
        console.error(`  ${error.message}`);
        if (error.stack) {
          console.error(`  ${error.stack.split('\n').slice(1, 3).join('\n')}`);
        }
        failed++;
      }
    }
  } finally {
    await cleanupTestEnv();
  }
  
  logSection('📊 Test Results');
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  console.log(`Total: ${tests.length}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
