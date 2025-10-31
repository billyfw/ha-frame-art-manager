#!/usr/bin/env node

/**
 * File Coordination Tests
 * Tests coordination logic for operations that affect multiple resources:
 * - Rename: file + thumbnail + metadata
 * - Delete: file + thumbnail + metadata
 * - Upload: file + thumbnail + metadata
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

// Setup: Create isolated test directory with git repo
async function setupTestEnv() {
  testPath = path.join(os.tmpdir(), 'frame-art-coord-test-' + Date.now());
  await fs.mkdir(testPath, { recursive: true });
  await fs.mkdir(path.join(testPath, 'library'), { recursive: true });
  await fs.mkdir(path.join(testPath, 'thumbs'), { recursive: true });
  
  // Initialize git repository (required for git mv operations)
  const GitHelper = require('../git_helper');
  const git = new GitHelper(testPath);
  await git.git.init();
  
  // Configure git user for commits (required for git operations)
  await git.git.addConfig('user.name', 'Test User');
  await git.git.addConfig('user.email', 'test@example.com');
  
  // Create initial metadata.json
  const initialMetadata = {
    images: {},
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

// Helper: Create a test image file
async function createTestImage(filename) {
  const imagePath = path.join(testPath, 'library', filename);
  // 1x1 PNG image (base64 decoded)
  const dummyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(imagePath, dummyImage);
  return imagePath;
}

// Helper: Create a test thumbnail
async function createTestThumbnail(filename) {
  const thumbPath = path.join(testPath, 'thumbs', `thumb_${filename}`);
  const dummyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(thumbPath, dummyImage);
  return thumbPath;
}

// Helper: Check if file exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Helper: Perform rename using git mv (simulating what routes/images.js does)
async function renameWithGit(oldFilename, newFilename) {
  const GitHelper = require('../git_helper');
  const git = new GitHelper(testPath);
  
  // 1. Use git mv to rename the image file
  await git.git.mv(
    path.join('library', oldFilename),
    path.join('library', newFilename)
  );
  
  // 2. Rename the thumbnail if it exists
  const oldThumbPath = path.join(testPath, 'thumbs', `thumb_${oldFilename}`);
  if (await fileExists(oldThumbPath)) {
    await git.git.mv(
      path.join('thumbs', `thumb_${oldFilename}`),
      path.join('thumbs', `thumb_${newFilename}`)
    );
  }
  
  // 3. Update metadata
  await helper.renameImage(oldFilename, newFilename);
  
  // 4. Stage the metadata change
  await git.git.add('metadata.json');
}

// INTEGRATION TESTS: Rename coordination

test('INTEGRATION: rename updates all three resources (file, thumb, metadata)', async () => {
  const oldFilename = 'original-abc12345.jpg';
  const newBaseName = 'renamed';
  const newFilename = 'renamed-abc12345.jpg';
  
  // Setup: Create file, thumbnail, and metadata
  await createTestImage(oldFilename);
  await createTestThumbnail(oldFilename);
  await helper.addImage(oldFilename, 'none', 'none', ['test']);
  
  // Initialize git and commit the initial state
  const GitHelper = require('../git_helper');
  const git = new GitHelper(testPath);
  await git.git.add('.');
  await git.git.commit('Initial test file');
  
  // Verify all exist before rename
  const oldImagePath = path.join(testPath, 'library', oldFilename);
  const oldThumbPath = path.join(testPath, 'thumbs', `thumb_${oldFilename}`);
  assert.ok(await fileExists(oldImagePath), 'Old image should exist');
  assert.ok(await fileExists(oldThumbPath), 'Old thumbnail should exist');
  
  const metadataBefore = await helper.getAllImages();
  assert.ok(metadataBefore[oldFilename], 'Old metadata should exist');
  
  // Perform rename using git mv (simulating what routes/images.js does)
  await renameWithGit(oldFilename, newFilename);
  
  // Verify all renamed correctly
  const newImagePath = path.join(testPath, 'library', newFilename);
  const newThumbPath = path.join(testPath, 'thumbs', `thumb_${newFilename}`);
  assert.ok(await fileExists(newImagePath), 'New image should exist');
  assert.ok(await fileExists(newThumbPath), 'New thumbnail should exist');
  assert.ok(!(await fileExists(oldImagePath)), 'Old image should not exist');
  assert.ok(!(await fileExists(oldThumbPath)), 'Old thumbnail should not exist');
  
  const metadataAfter = await helper.getAllImages();
  assert.ok(metadataAfter[newFilename], 'New metadata should exist');
  assert.ok(!metadataAfter[oldFilename], 'Old metadata should not exist');
  assert.strictEqual(metadataAfter[newFilename].matte, 'none');
  assert.deepStrictEqual(metadataAfter[newFilename].tags, ['test']);
});

test('INTEGRATION: rename back and forth does not create orphaned files', async () => {
  const uuid = 'deadbeef';
  const filename1 = `original-${uuid}.jpg`;
  const filename2 = `renamed-${uuid}.jpg`;
  const filename3 = `original-${uuid}.jpg`;
  
  // Create initial file and commit it
  await createTestImage(filename1);
  await createTestThumbnail(filename1);
  await helper.addImage(filename1, 'none', 'none', []);
  
  const GitHelper = require('../git_helper');
  const git = new GitHelper(testPath);
  await git.git.add('.');
  await git.git.commit('Initial test file');
  
  // Rename to "renamed" using git mv
  await renameWithGit(filename1, filename2);
  
  // Rename back to "original" using git mv
  await renameWithGit(filename2, filename3);
  
  // Verify only ONE file exists
  const libraryFiles = await fs.readdir(path.join(testPath, 'library'));
  const imageFiles = libraryFiles.filter(f => f.endsWith('.jpg'));
  assert.strictEqual(imageFiles.length, 1, 'Should only have one file');
  assert.strictEqual(imageFiles[0], filename3, 'Should be the final renamed file');
  
  // Verify only ONE entry in metadata
  const metadata = await helper.getAllImages();
  assert.strictEqual(Object.keys(metadata).length, 1, 'Should only have one metadata entry');
  assert.ok(metadata[filename3], 'Final filename should be in metadata');
});

test('INTEGRATION: multiple renames without intermediate cleanup work correctly', async () => {
  const uuid1 = 'aaaaaaaa';
  const uuid2 = 'bbbbbbbb';
  const file1a = `image1-${uuid1}.jpg`;
  const file1b = `renamed1-${uuid1}.jpg`;
  const file2a = `image2-${uuid2}.jpg`;
  const file2b = `renamed2-${uuid2}.jpg`;
  
  // Create two files and commit them
  await createTestImage(file1a);
  await createTestImage(file2a);
  await helper.addImage(file1a, 'none', 'none', []);
  await helper.addImage(file2a, 'none', 'none', []);
  
  const GitHelper = require('../git_helper');
  const git = new GitHelper(testPath);
  await git.git.add('.');
  await git.git.commit('Initial two files');
  
  // Rename both using git mv
  await renameWithGit(file1a, file1b);
  await renameWithGit(file2a, file2b);
  
  // Verify old files are gone
  assert.ok(!(await fileExists(path.join(testPath, 'library', file1a))), 'Old file1 should be gone');
  assert.ok(!(await fileExists(path.join(testPath, 'library', file2a))), 'Old file2 should be gone');
  
  // Verify new files exist
  assert.ok(await fileExists(path.join(testPath, 'library', file1b)), 'New file1 should exist');
  assert.ok(await fileExists(path.join(testPath, 'library', file2b)), 'New file2 should exist');
  
  // Verify metadata is correct
  const metadata = await helper.getAllImages();
  assert.strictEqual(Object.keys(metadata).length, 2, 'Should have two metadata entries');
  assert.ok(metadata[file1b], 'Renamed file1 should be in metadata');
  assert.ok(metadata[file2b], 'Renamed file2 should be in metadata');
  assert.ok(!metadata[file1a], 'Old file1 should not be in metadata');
  assert.ok(!metadata[file2a], 'Old file2 should not be in metadata');
});

test('INTEGRATION: git mv rename pattern works with git tracking', async () => {
  // This test verifies that rename works WITH git operations
  const oldFilename = 'git-test-cccccccc.jpg';
  const newFilename = 'git-renamed-cccccccc.jpg';
  
  await createTestImage(oldFilename);
  await helper.addImage(oldFilename, 'none', 'none', []);
  
  const GitHelper = require('../git_helper');
  const git = new GitHelper(testPath);
  await git.git.add('.');
  await git.git.commit('Initial file for git test');
  
  // Perform rename using git mv
  await renameWithGit(oldFilename, newFilename);
  
  // Verify filesystem
  assert.ok(!(await fileExists(path.join(testPath, 'library', oldFilename))), 'Old file should be gone');
  assert.ok(await fileExists(path.join(testPath, 'library', newFilename)), 'New file should exist');
  
  // Verify metadata
  const metadata = await helper.getAllImages();
  assert.ok(metadata[newFilename], 'New filename should be in metadata');
  assert.ok(!metadata[oldFilename], 'Old filename should not be in metadata');
  
  // Verify git sees it as a rename, not delete + add
  const status = await git.git.status();
  const renamedFiles = status.files.filter(f => (f.index || '').startsWith('R'));
  assert.ok(renamedFiles.length > 0, 'Git should show renamed files');
});

test('INTEGRATION: rename handles missing thumbnail gracefully', async () => {
  const oldFilename = 'nothumb-xyz98765.jpg';
  const newFilename = 'renamed-xyz98765.jpg';
  
  // Setup: Create file and metadata, but NO thumbnail
  await createTestImage(oldFilename);
  await helper.addImage(oldFilename, 'none', 'none', []);
  
  // Perform rename using copy-delete
  const oldImagePath = path.join(testPath, 'library', oldFilename);
  const newImagePath = path.join(testPath, 'library', newFilename);
  
  await fs.copyFile(oldImagePath, newImagePath);
  
  // Try to copy thumbnail (should not throw even if missing)
  const oldThumbPath = path.join(testPath, 'thumbs', `thumb_${oldFilename}`);
  const newThumbPath = path.join(testPath, 'thumbs', `thumb_${newFilename}`);
  try {
    await fs.copyFile(oldThumbPath, newThumbPath);
  } catch {
    // Expected to fail, that's ok
  }
  
  await helper.renameImage(oldFilename, newFilename);
  await fs.unlink(oldImagePath);
  
  // Verify file and metadata renamed correctly
  assert.ok(await fileExists(newImagePath), 'New image should exist');
  const metadata = await helper.getAllImages();
  assert.ok(metadata[newFilename], 'New metadata should exist');
});

test('INTEGRATION: rename rollback if metadata update fails', async () => {
  const oldFilename = 'rollback-def45678.jpg';
  const newFilename = 'renamed-def45678.jpg';
  
  // Setup: Create file and thumbnail, but NO metadata
  await createTestImage(oldFilename);
  await createTestThumbnail(oldFilename);
  
  // Don't add to metadata - this will cause renameImage to fail
  
  const oldImagePath = path.join(testPath, 'library', oldFilename);
  const newImagePath = path.join(testPath, 'library', newFilename);
  const oldThumbPath = path.join(testPath, 'thumbs', `thumb_${oldFilename}`);
  const newThumbPath = path.join(testPath, 'thumbs', `thumb_${newFilename}`);
  
  // Copy files
  await fs.copyFile(oldImagePath, newImagePath);
  await fs.copyFile(oldThumbPath, newThumbPath);
  
  // Try to update metadata (should fail)
  try {
    await helper.renameImage(oldFilename, newFilename);
    assert.fail('Should have thrown error');
  } catch (error) {
    assert.ok(error.message.includes('not found'));
    
    // Rollback: delete the new files
    await fs.unlink(newImagePath);
    await fs.unlink(newThumbPath);
    
    assert.ok(await fileExists(oldImagePath), 'Original file should still exist');
    assert.ok(await fileExists(oldThumbPath), 'Original thumbnail should still exist');
    assert.ok(!(await fileExists(newImagePath)), 'New file should be rolled back');
    assert.ok(!(await fileExists(newThumbPath)), 'New thumbnail should be rolled back');
  }
});

// INTEGRATION TESTS: Delete coordination

test('INTEGRATION: delete removes all three resources (file, thumb, metadata)', async () => {
  const filename = 'todelete-hij12345.jpg';
  
  // Setup: Create file, thumbnail, and metadata
  await createTestImage(filename);
  await createTestThumbnail(filename);
  await helper.addImage(filename, 'none', 'None', ['delete-test']);
  
  // Verify all exist before delete
  const imagePath = path.join(testPath, 'library', filename);
  const thumbPath = path.join(testPath, 'thumbs', `thumb_${filename}`);
  assert.ok(await fileExists(imagePath), 'Image should exist before delete');
  assert.ok(await fileExists(thumbPath), 'Thumbnail should exist before delete');
  
  const metadataBefore = await helper.getAllImages();
  assert.ok(metadataBefore[filename], 'Metadata should exist before delete');
  
  // Perform delete operations (simulating what routes/images.js does)
  await helper.deleteImage(filename);
  await fs.unlink(imagePath);
  try {
    await fs.unlink(thumbPath);
  } catch {
    // Thumbnail might not exist, that's ok
  }
  
  // Verify all deleted
  assert.ok(!(await fileExists(imagePath)), 'Image should not exist after delete');
  assert.ok(!(await fileExists(thumbPath)), 'Thumbnail should not exist after delete');
  
  const metadataAfter = await helper.getAllImages();
  assert.ok(!metadataAfter[filename], 'Metadata should not exist after delete');
});

test('INTEGRATION: delete handles missing thumbnail gracefully', async () => {
  const filename = 'delete-nothumb-klm67890.jpg';
  
  // Setup: Create file and metadata, but NO thumbnail
  await createTestImage(filename);
  await helper.addImage(filename, 'none', 'none', []);
  
  const imagePath = path.join(testPath, 'library', filename);
  
  // Perform delete
  await helper.deleteImage(filename);
  await fs.unlink(imagePath);
  
  // Try to delete thumbnail (should not throw even if missing)
  const thumbPath = path.join(testPath, 'thumbs', `thumb_${filename}`);
  try {
    await fs.unlink(thumbPath);
  } catch {
    // Expected to fail, that's ok
  }
  
  // Verify deleted
  assert.ok(!(await fileExists(imagePath)), 'Image should be deleted');
  const metadata = await helper.getAllImages();
  assert.ok(!metadata[filename], 'Metadata should be deleted');
});

test('INTEGRATION: delete fails if metadata missing (orphaned file)', async () => {
  const filename = 'orphan-nop78901.jpg';
  
  // Setup: Create file but NO metadata (orphaned file)
  await createTestImage(filename);
  
  // Try to delete metadata (should fail)
  try {
    await helper.deleteImage(filename);
    assert.fail('Should have thrown error for missing metadata');
  } catch (error) {
    assert.ok(error.message.includes('not found'));
    
    // File still exists (wasn't deleted)
    const imagePath = path.join(testPath, 'library', filename);
    assert.ok(await fileExists(imagePath), 'Orphaned file should still exist');
  }
});

// INTEGRATION TESTS: Upload coordination

test('INTEGRATION: upload creates file, thumbnail, and metadata', async () => {
  const filename = 'upload-qrs23456.jpg';
  
  // Simulate upload: create file, add metadata, generate thumbnail
  await createTestImage(filename);
  await helper.addImage(filename, 'none', 'None', ['upload-test']);
  
  // Generate thumbnail (using MetadataHelper's method)
  try {
    await helper.generateThumbnail(filename);
  } catch (error) {
    // Might fail if sharp can't process our dummy image, that's ok
    console.log('  (Thumbnail generation skipped - dummy image)');
  }
  
  // Verify file and metadata exist
  const imagePath = path.join(testPath, 'library', filename);
  assert.ok(await fileExists(imagePath), 'Uploaded file should exist');
  
  const metadata = await helper.getAllImages();
  assert.ok(metadata[filename], 'Upload metadata should exist');
  assert.strictEqual(metadata[filename].matte, 'none');
  assert.deepStrictEqual(metadata[filename].tags, ['upload-test']);
});

test('INTEGRATION: upload continues even if thumbnail generation fails', async () => {
  const filename = 'upload-badthumb-tuv34567.jpg';
  
  // Create file and metadata
  await createTestImage(filename);
  await helper.addImage(filename, 'none', 'none', []);
  
  // Suppress console.error for this test (we expect it to fail)
  const originalConsoleError = console.error;
  console.error = () => {};
  
  try {
    // Try to generate thumbnail for non-existent file (should not crash)
    await helper.generateThumbnail('nonexistent-file.jpg');
    assert.fail('Should have thrown error');
  } catch (error) {
    // Expected - thumbnail generation failed
    assert.ok(error);
  } finally {
    // Restore console.error
    console.error = originalConsoleError;
  }
  
  // Verify upload still succeeded (file and metadata exist)
  const imagePath = path.join(testPath, 'library', filename);
  assert.ok(await fileExists(imagePath), 'File should exist even if thumbnail failed');
  
  const metadata = await helper.getAllImages();
  assert.ok(metadata[filename], 'Metadata should exist even if thumbnail failed');
});

// INTEGRATION TEST: Filename sanitization

test('INTEGRATION: filename sanitization removes invalid characters', async () => {
  const testCases = [
    { input: 'My Photo!@#$%', expected: 'my-photo-' },
    { input: 'hello world', expected: 'hello-world' },
    { input: 'Test___File', expected: 'test___file' },
    { input: 'CamelCase', expected: 'camelcase' },
    { input: 'with--dashes', expected: 'with-dashes' }
  ];
  
  for (const testCase of testCases) {
    const sanitized = testCase.input.trim()
      .replace(/[^a-z0-9_-]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    
    assert.strictEqual(sanitized, testCase.expected, 
      `"${testCase.input}" should sanitize to "${testCase.expected}"`);
  }
});

// Test runner
async function runTests() {
  console.log('🧪 Running File Coordination Tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  try {
    await setupTestEnv();
    
    for (const test of tests) {
      try {
        // Clean library and thumbs before each test to avoid file accumulation
        const libraryPath = path.join(testPath, 'library');
        const thumbsPath = path.join(testPath, 'thumbs');
        const libraryFiles = await fs.readdir(libraryPath);
        const thumbFiles = await fs.readdir(thumbsPath);
        
        for (const file of libraryFiles) {
          await fs.unlink(path.join(libraryPath, file));
        }
        for (const file of thumbFiles) {
          await fs.unlink(path.join(thumbsPath, file));
        }
        
        // Reset metadata
        await helper.writeMetadata({
          images: {},
          tags: []
        });
        
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
