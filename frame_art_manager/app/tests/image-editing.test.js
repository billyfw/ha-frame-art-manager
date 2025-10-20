#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');

const ImageEditService = require('../image_edit_service');
const MetadataHelper = require('../metadata_helper');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function logSuccess(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function logSection(title) {
  console.log(`\n${colors.blue}${title}${colors.reset}`);
}

const tests = [];
let testPath;
let helper;
let service;

function test(name, fn) {
  tests.push({ name, fn });
}

async function setupTestEnv() {
  testPath = path.join(os.tmpdir(), `frame-art-edit-test-${Date.now()}`);
  await fs.mkdir(testPath, { recursive: true });
  await fs.mkdir(path.join(testPath, 'library'), { recursive: true });
  await fs.mkdir(path.join(testPath, 'thumbs'), { recursive: true });
  await fs.mkdir(path.join(testPath, 'originals'), { recursive: true });

  // Initialize metadata file
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
  service = new ImageEditService(testPath);
}

async function cleanupTestEnv() {
  if (testPath) {
    await fs.rm(testPath, { recursive: true, force: true });
  }
}

async function cleanTestState() {
  const folders = ['library', 'thumbs', 'originals'];
  for (const folder of folders) {
    const folderPath = path.join(testPath, folder);
    const entries = await fs.readdir(folderPath);
    for (const entry of entries) {
      await fs.rm(path.join(folderPath, entry), { recursive: true, force: true });
    }
  }

  await helper.writeMetadata({
    images: {},
    tvs: [],
    tags: []
  });
}

async function createSampleImage(filename, width = 200, height = 120, color = { r: 180, g: 90, b: 60 }) {
  const imagePath = path.join(testPath, 'library', filename);
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  await fs.writeFile(imagePath, buffer);
  return imagePath;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(data).digest('hex');
}

// Tests

test('INTEGRATION: applyEdits creates backup and updates metadata', async () => {
  const filename = 'edit-subject-aaaaaaaa.jpg';

  await createSampleImage(filename, 200, 120);
  await helper.addImage(filename, 'none', 'none', ['test']);

  const result = await service.applyEdits(filename, {
    crop: { top: 5, right: 5, bottom: 5, left: 5 },
    adjustments: { brightness: 15, contrast: 10 },
    filter: 'film-classic'
  });

  assert.strictEqual(result.backupCreated, true, 'First edit should create a backup');

  const backupPath = path.join(testPath, 'originals', 'edit-subject-aaaaaaaa_original.jpg');
  assert.ok(await fileExists(backupPath), 'Backup file should exist');

  const metadata = await helper.getAllImages();
  const updated = metadata[filename];
  assert.ok(updated, 'Metadata entry should exist');
  assert.ok(updated.dimensions.width < 200, 'Width should decrease after crop');
  assert.ok(updated.dimensions.height < 120, 'Height should decrease after crop');
});

test('INTEGRATION: applyEdits reuses backup on subsequent edits', async () => {
  const filename = 'edit-subject-bbbbbbbb.jpg';

  await createSampleImage(filename, 220, 140);
  await helper.addImage(filename, 'none', 'none', []);

  // First edit to create backup
  await service.applyEdits(filename, {
    crop: { top: 4, right: 4, bottom: 4, left: 4 },
    adjustments: { brightness: 5, contrast: 5 },
    filter: 'none'
  });

  const secondResult = await service.applyEdits(filename, {
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    adjustments: { brightness: -10, contrast: 20 },
    filter: 'graphite-ink'
  });

  assert.strictEqual(secondResult.backupCreated, false, 'Backup should not be recreated on subsequent edits');

  const backupPath = path.join(testPath, 'originals', 'edit-subject-bbbbbbbb_original.jpg');
  assert.ok(await fileExists(backupPath), 'Existing backup should remain');
});

test('INTEGRATION: revert restores original file and metadata', async () => {
  const filename = 'edit-subject-cccccccc.jpg';

  await createSampleImage(filename, 240, 160);
  await helper.addImage(filename, 'none', 'none', []);

  const beforeHash = await hashFile(path.join(testPath, 'library', filename));

  await service.applyEdits(filename, {
    crop: { top: 10, right: 5, bottom: 10, left: 5 },
    adjustments: { brightness: 20, contrast: -10 },
    filter: 'pastel-wash'
  });

  const backupPath = path.join(testPath, 'originals', 'edit-subject-cccccccc_original.jpg');
  assert.ok(await fileExists(backupPath), 'Backup should exist before revert');
  const backupHash = await hashFile(backupPath);

  await service.revertToOriginal(filename);

  const afterHash = await hashFile(path.join(testPath, 'library', filename));

  assert.strictEqual(afterHash, backupHash, 'Reverted image should match backup');
  assert.strictEqual(beforeHash, backupHash, 'Backup should match original image content');
  assert.strictEqual(await fileExists(backupPath), false, 'Backup should be removed after revert');

  const stateAfterRevert = await service.getEditState(filename);
  assert.strictEqual(stateAfterRevert.hasBackup, false, 'Edit state should report no backup after revert');

  const metadata = await helper.getAllImages();
  const reverted = metadata[filename];
  assert.ok(reverted, 'Metadata entry should exist after revert');
  assert.strictEqual(reverted.dimensions.width, 240, 'Width should match original after revert');
  assert.strictEqual(reverted.dimensions.height, 160, 'Height should match original after revert');
});

test('INTEGRATION: revert removes backup and subsequent edit recreates it', async () => {
  const filename = 'edit-subject-eeeeeeee.jpg';

  await createSampleImage(filename, 210, 150);
  await helper.addImage(filename, 'none', 'none', []);

  await service.applyEdits(filename, {
    crop: { top: 2, right: 2, bottom: 2, left: 2 },
    adjustments: { brightness: 10, contrast: 5 },
    filter: 'silver-pearl'
  });

  const backupPath = path.join(testPath, 'originals', 'edit-subject-eeeeeeee_original.jpg');
  assert.ok(await fileExists(backupPath), 'Backup should exist after first edit');

  await service.revertToOriginal(filename);

  assert.strictEqual(await fileExists(backupPath), false, 'Backup should be removed after revert');
  const stateAfterRevert = await service.getEditState(filename);
  assert.strictEqual(stateAfterRevert.hasBackup, false, 'Edit state should report no backup after revert');

  const secondResult = await service.applyEdits(filename, {
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    adjustments: { brightness: -5, contrast: 0 },
    filter: 'none'
  });

  assert.strictEqual(secondResult.backupCreated, true, 'Backup should be recreated after revert when applying new edits');
  assert.ok(await fileExists(backupPath), 'Backup should exist again after new edits');
});

test('UNIT: legacy filter names remap to available filters', () => {
  const remapped = service.sanitizeOperations({ filter: 'cobalt-pop' });
  assert.strictEqual(remapped.filter, 'coastal-breeze', 'Legacy cobalt-pop should normalize to coastal-breeze');
});

test('INTEGRATION: invalid crop is rejected without altering the source file', async () => {
  const filename = 'edit-subject-dddddddd.jpg';

  await createSampleImage(filename, 200, 120);
  await helper.addImage(filename, 'none', 'none', []);

  const originalHash = await hashFile(path.join(testPath, 'library', filename));

  let errorCaught = false;
  try {
    await service.applyEdits(filename, {
      crop: { top: 0, right: 60, bottom: 0, left: 50 },
      adjustments: { brightness: 0, contrast: 0 },
      filter: 'none'
    });
  } catch (error) {
    errorCaught = true;
    assert.ok(/crop/i.test(error.message), 'Error message should mention crop issue');
  }

  assert.ok(errorCaught, 'Invalid crop should throw an error');

  const postHash = await hashFile(path.join(testPath, 'library', filename));
  assert.strictEqual(postHash, originalHash, 'Source image should remain unchanged');
});

async function runTests() {
  console.log('🧪 Running Image Editing Tests...\n');

  let passed = 0;
  let failed = 0;

  try {
    await setupTestEnv();

    for (const { name, fn } of tests) {
      await cleanTestState();
      try {
        await fn();
        logSuccess(name);
        passed++;
      } catch (error) {
        logError(name);
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

if (require.main === module) {
  runTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
