/**
 * Semantic Sync Tests
 * Tests for semantic sync status parsing (images only, no thumbnails/metadata)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const simpleGit = require('simple-git');
const GitHelper = require('../git_helper');

// Test configuration
const FRAME_ART_PATH = process.env.FRAME_ART_PATH || 
  path.join(os.homedir(), 'devprojects/ha-config/www/frame_art');

// Test repo for integration tests
let testRepoPath = null;
const TEST_REPO_URL = 'git@github.com:billyfw/frame_art.git';

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

// Test suite
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Setup test repo before all tests
async function setupTestRepo() {
  try {
    testRepoPath = path.join(os.tmpdir(), 'frame-art-semantic-test-' + Date.now());
    
    logInfo(`Setting up test repo at ${testRepoPath}...`);
    
    // Shallow clone for speed
    await simpleGit().clone(TEST_REPO_URL, testRepoPath, ['--depth', '10']);
    
    // Create library and thumbs directories if they don't exist
    await fs.mkdir(path.join(testRepoPath, 'library'), { recursive: true });
    await fs.mkdir(path.join(testRepoPath, 'thumbs'), { recursive: true });
    
    logInfo('Test repo setup complete');
    return true;
  } catch (error) {
    logInfo(`Could not setup test repo: ${error.message}`);
    logInfo('Integration tests will be skipped');
    return false;
  }
}

// Cleanup test repo after all tests
async function cleanupTestRepo() {
  if (testRepoPath) {
    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
      logInfo('Test repo cleaned up');
    } catch (error) {
      logInfo(`Warning: Could not cleanup test repo: ${error.message}`);
    }
  }
}

// Helper to create a test image file
async function createTestImage(repoPath, filename) {
  const imagePath = path.join(repoPath, 'library', filename);
  // Create a minimal fake image file (just needs to exist)
  await fs.writeFile(imagePath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])); // JPEG header bytes
  return imagePath;
}

// Helper to create a test thumbnail
async function createTestThumbnail(repoPath, filename) {
  const thumbPath = path.join(repoPath, 'thumbs', `thumb_${filename}`);
  await fs.writeFile(thumbPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]));
  return thumbPath;
}

// Helper to update metadata.json
async function updateMetadata(repoPath, imageFilename) {
  const metadataPath = path.join(repoPath, 'metadata.json');
  let metadata = {};
  
  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    metadata = JSON.parse(content);
  } catch (error) {
    // File doesn't exist, create new
  }
  
  metadata[imageFilename] = {
    tags: ['test'],
    uploadDate: new Date().toISOString()
  };
  
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
}

// ============================================================================
// Unit Tests - parseImageChanges()
// ============================================================================

test('parseImageChanges - filters out thumbnails', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  const files = [
    { path: 'library/image1.jpg', working_dir: 'A' },
    { path: 'thumbs/thumb_image1.jpg', working_dir: 'A' },
    { path: 'library/image2.jpg', working_dir: 'M' }
  ];
  
  const result = git.parseImageChanges(files);
  
  assert.strictEqual(result.newImages, 1, 'Should count 1 new image (not thumbnail)');
  assert.strictEqual(result.modifiedImages, 1, 'Should count 1 modified image');
  assert.strictEqual(result.deletedImages, 0, 'Should count 0 deleted images');
  
  logSuccess('Thumbnails are filtered out correctly');
});

test('parseImageChanges - filters out metadata.json', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  const files = [
    { path: 'library/image1.jpg', working_dir: 'A' },
    { path: 'metadata.json', working_dir: 'M' }
  ];
  
  const result = git.parseImageChanges(files);
  
  assert.strictEqual(result.newImages, 1, 'Should count 1 new image');
  assert.strictEqual(result.modifiedImages, 0, 'Should not count metadata.json');
  assert.strictEqual(result.deletedImages, 0, 'Should count 0 deleted images');
  
  logSuccess('metadata.json is filtered out correctly');
});

test('parseImageChanges - distinguishes new vs modified images', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  const files = [
    { path: 'library/new-image.jpg', working_dir: 'A' },
    { path: 'library/existing-image.jpg', working_dir: 'M' }
  ];
  
  const result = git.parseImageChanges(files);
  
  assert.strictEqual(result.newImages, 1, 'Should count 1 new image (status A)');
  assert.strictEqual(result.modifiedImages, 1, 'Should count 1 modified image (status M)');
  assert.strictEqual(result.deletedImages, 0, 'Should count 0 deleted images');
  
  logSuccess('New vs modified images distinguished correctly');
});

test('parseImageChanges - handles untracked files', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  const files = [
    { path: 'library/untracked-image.jpg', working_dir: '?' }
  ];
  
  const result = git.parseImageChanges(files);
  
  assert.strictEqual(result.newImages, 1, 'Should count untracked (?) as new image');
  assert.strictEqual(result.modifiedImages, 0, 'Should not count as modified');
  assert.strictEqual(result.deletedImages, 0, 'Should count 0 deleted images');
  
  logSuccess('Untracked files handled as new images');
});

test('parseImageChanges - respects newImageFiles parameter', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  // Simulate a commit that has metadata change for a new image
  const files = [
    { path: 'library/new-image.jpg', status: 'A' },
    { path: 'metadata.json', status: 'M' }
  ];
  
  const newImageFiles = ['library/new-image.jpg'];
  
  const result = git.parseImageChanges(files, newImageFiles);
  
  assert.strictEqual(result.newImages, 1, 'Should recognize file as new via newImageFiles');
  
  logSuccess('newImageFiles parameter works correctly');
});

test('parseImageChanges - handles deleted images', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  const files = [
    { path: 'library/deleted-image.jpg', working_dir: 'D' }
  ];
  
  const result = git.parseImageChanges(files);
  
  assert.strictEqual(result.newImages, 0, 'Should not count as new');
  assert.strictEqual(result.modifiedImages, 0, 'Should not count as modified');
  assert.strictEqual(result.deletedImages, 1, 'Should count 1 deleted image (status D)');
  
  logSuccess('Deleted images handled correctly');
});

// ============================================================================
// Integration Tests - getSemanticSyncStatus()
// ============================================================================

test('getSemanticSyncStatus - returns correct structure', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  try {
    const status = await git.getSemanticSyncStatus();
    
    assert.ok(status.upload, 'Should have upload object');
    assert.ok(status.download, 'Should have download object');
    assert.ok(typeof status.hasChanges === 'boolean', 'Should have hasChanges boolean');
    
    assert.ok(typeof status.upload.count === 'number', 'upload.count should be a number');
    assert.ok(typeof status.upload.newImages === 'number', 'upload.newImages should be a number');
    assert.ok(typeof status.upload.modifiedImages === 'number', 'upload.modifiedImages should be a number');
    assert.ok(typeof status.upload.deletedImages === 'number', 'upload.deletedImages should be a number');
    
    assert.ok(typeof status.download.count === 'number', 'download.count should be a number');
    assert.ok(typeof status.download.newImages === 'number', 'download.newImages should be a number');
    assert.ok(typeof status.download.modifiedImages === 'number', 'download.modifiedImages should be a number');
    assert.ok(typeof status.download.deletedImages === 'number', 'download.deletedImages should be a number');
    
    logSuccess('getSemanticSyncStatus returns correct structure');
    logInfo(`Current status: ${status.upload.count}▲/${status.download.count}▼`);
  } catch (error) {
    throw new Error(`getSemanticSyncStatus failed: ${error.message}`);
  }
});

test('getSemanticSyncStatus - upload count matches sum', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  try {
    const status = await git.getSemanticSyncStatus();
    
    const expectedCount = status.upload.newImages + status.upload.modifiedImages + status.upload.deletedImages;
    assert.strictEqual(status.upload.count, expectedCount, 
      'upload.count should equal newImages + modifiedImages + deletedImages');
    
    logSuccess('Upload count calculation is correct');
  } catch (error) {
    throw new Error(`Count validation failed: ${error.message}`);
  }
});

test('getSemanticSyncStatus - download count matches sum', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  try {
    const status = await git.getSemanticSyncStatus();
    
    const expectedCount = status.download.newImages + status.download.modifiedImages + status.download.deletedImages;
    assert.strictEqual(status.download.count, expectedCount, 
      'download.count should equal newImages + modifiedImages + deletedImages');
    
    logSuccess('Download count calculation is correct');
  } catch (error) {
    throw new Error(`Count validation failed: ${error.message}`);
  }
});

test('getSemanticSyncStatus - hasChanges matches counts', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  try {
    const status = await git.getSemanticSyncStatus();
    
    const expectedHasChanges = status.upload.count > 0 || status.download.count > 0;
    assert.strictEqual(status.hasChanges, expectedHasChanges, 
      'hasChanges should be true if any upload or download count > 0');
    
    logSuccess('hasChanges flag is correct');
  } catch (error) {
    throw new Error(`hasChanges validation failed: ${error.message}`);
  }
});

// ============================================================================
// Remote Changes Tests (Download/Behind)
// ============================================================================

test('parseImageChanges - remote new image is counted', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  // Simulate files from a remote commit
  const files = [
    { path: 'library/remote-new-image.jpg', status: 'A' }
  ];
  const newImageFiles = ['library/remote-new-image.jpg'];
  
  const result = git.parseImageChanges(files, newImageFiles);
  
  assert.strictEqual(result.newImages, 1, 'Should count remote new image');
  assert.strictEqual(result.modifiedImages, 0, 'Should not count as modified');
  assert.strictEqual(result.deletedImages, 0, 'Should not count as deleted');
  
  logSuccess('Remote new image counted correctly');
});

test('parseImageChanges - remote image modification is counted', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  // Simulate a modified image in a remote commit
  const files = [
    { path: 'library/existing-image.jpg', status: 'M' }
  ];
  
  const result = git.parseImageChanges(files, []);
  
  assert.strictEqual(result.newImages, 0, 'Should not count as new');
  assert.strictEqual(result.modifiedImages, 1, 'Should count remote modification');
  assert.strictEqual(result.deletedImages, 0, 'Should not count as deleted');
  
  logSuccess('Remote image modification counted correctly');
});

test('parseImageChanges - remote changes filter thumbnails and metadata', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  // Simulate a remote commit with image + thumbnail + metadata
  const files = [
    { path: 'library/new-image.jpg', status: 'A' },
    { path: 'thumbs/thumb_new-image.jpg', status: 'A' },
    { path: 'metadata.json', status: 'M' }
  ];
  const newImageFiles = ['library/new-image.jpg'];
  
  const result = git.parseImageChanges(files, newImageFiles);
  
  assert.strictEqual(result.newImages, 1, 'Should count only the image, not thumbnail or metadata');
  assert.strictEqual(result.modifiedImages, 0, 'Should not count metadata as image update');
  assert.strictEqual(result.deletedImages, 0, 'Should not count any deletions');
  
  logSuccess('Remote changes correctly filter thumbnails and metadata');
});

test('parseImageChanges - mixed remote changes (new + modified)', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  // Simulate a remote commit with both new and modified images
  const files = [
    { path: 'library/new-image-1.jpg', status: 'A' },
    { path: 'library/new-image-2.jpg', status: 'A' },
    { path: 'library/modified-image.jpg', status: 'M' },
    { path: 'thumbs/thumb_new-image-1.jpg', status: 'A' },
    { path: 'metadata.json', status: 'M' }
  ];
  const newImageFiles = ['library/new-image-1.jpg', 'library/new-image-2.jpg'];
  
  const result = git.parseImageChanges(files, newImageFiles);
  
  assert.strictEqual(result.newImages, 2, 'Should count 2 new images');
  assert.strictEqual(result.modifiedImages, 1, 'Should count 1 modified image');
  assert.strictEqual(result.deletedImages, 0, 'Should count 0 deleted images');
  
  logSuccess('Mixed remote changes counted correctly');
});

test('parseImageChanges - remote metadata-only change ignored', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  // Simulate a remote commit with only metadata change (no new images)
  const files = [
    { path: 'metadata.json', status: 'M' }
  ];
  
  const result = git.parseImageChanges(files, []);
  
  assert.strictEqual(result.newImages, 0, 'Should not count metadata as new image');
  assert.strictEqual(result.modifiedImages, 0, 'Should not count metadata as image update');
  assert.strictEqual(result.deletedImages, 0, 'Should not count metadata as deletion');
  
  logSuccess('Remote metadata-only change correctly ignored');
});

// ============================================================================
// Integration Tests - Real Git Operations with Temporary Repo
// ============================================================================

test('INTEGRATION: detect remote new image in behind commits', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Get current HEAD to restore later
  const originalHead = await git.git.revparse(['HEAD']);
  
  // Go back 1 commit
  await git.git.reset(['--hard', 'HEAD~1']);
  
  // Check semantic status - should detect images in the ahead commit
  const status = await git.getSemanticSyncStatus();
  
  // Restore to original HEAD
  await git.git.reset(['--hard', originalHead]);
  
  // The commit we were behind should be parsed for images
  assert.ok(status.download, 'Should have download object');
  assert.ok(typeof status.download.count === 'number', 'Should have download count');
  
  logSuccess('Remote commit detection works');
  logInfo(`Found ${status.download.count} image(s) to download`);
});

test('INTEGRATION: local uncommitted new image counted correctly', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Create a new test image (uncommitted)
  const testFilename = `test-new-${Date.now()}.jpg`;
  await createTestImage(testRepoPath, testFilename);
  await createTestThumbnail(testRepoPath, testFilename);
  await updateMetadata(testRepoPath, testFilename);
  
  try {
    // Check semantic status
    const status = await git.getSemanticSyncStatus();
    
    assert.ok(status.upload.count >= 1, 'Should detect at least 1 image to upload');
    assert.ok(status.upload.newImages >= 1, 'Should count new image');
    
    logSuccess('Local uncommitted new image detected');
    logInfo(`Upload: ${status.upload.newImages} new, ${status.upload.modifiedImages} modified, ${status.upload.deletedImages} deleted`);
  } finally {
    // Cleanup - remove test files
    await fs.unlink(path.join(testRepoPath, 'library', testFilename)).catch(() => {});
    await fs.unlink(path.join(testRepoPath, 'thumbs', `thumb_${testFilename}`)).catch(() => {});
    await git.git.checkout(['metadata.json']).catch(() => {});
  }
});

test('INTEGRATION: local uncommitted image modification counted correctly', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Find an existing image in the repo
  const libraryPath = path.join(testRepoPath, 'library');
  const existingFiles = await fs.readdir(libraryPath);
  const existingImage = existingFiles.find(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));
  
  if (!existingImage) {
    logInfo('Skipping - no existing images found in test repo');
    return;
  }
  
  // Modify the existing image
  const imagePath = path.join(libraryPath, existingImage);
  const originalContent = await fs.readFile(imagePath);
  await fs.writeFile(imagePath, Buffer.concat([originalContent, Buffer.from([0x00])]));
  
  try {
    // Check semantic status
    const status = await git.getSemanticSyncStatus();
    
    assert.ok(status.upload.count >= 1, 'Should detect at least 1 image to upload');
    assert.ok(status.upload.modifiedImages >= 1, 'Should count modified image');
    
    logSuccess('Local uncommitted image modification detected');
    logInfo(`Upload: ${status.upload.newImages} new, ${status.upload.modifiedImages} modified, ${status.upload.deletedImages} deleted`);
  } finally {
    // Restore original file
    await fs.writeFile(imagePath, originalContent);
  }
});

test('INTEGRATION: thumbnails are filtered from counts', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Create test files
  const testFilename = `test-thumb-filter-${Date.now()}.jpg`;
  await createTestImage(testRepoPath, testFilename);
  await createTestThumbnail(testRepoPath, testFilename);
  
  try {
    // Get raw git status
    const rawStatus = await git.getStatus();
    const rawFileCount = rawStatus.files.length;
    
    // Get semantic status
    const semanticStatus = await git.getSemanticSyncStatus();
    
    // Raw count should include image + thumbnail (at least 2 files)
    assert.ok(rawFileCount >= 2, `Should have at least 2 uncommitted files (image + thumbnail), got ${rawFileCount}`);
    
    // Semantic count should only count the image (1 file)
    assert.strictEqual(semanticStatus.upload.count, 1, 'Should count only 1 image (filtered thumbnail)');
    
    logSuccess('Thumbnails successfully filtered from semantic counts');
    logInfo(`Raw files: ${rawFileCount}, Semantic images: ${semanticStatus.upload.count}`);
  } finally {
    // Cleanup
    await fs.unlink(path.join(testRepoPath, 'library', testFilename)).catch(() => {});
    await fs.unlink(path.join(testRepoPath, 'thumbs', `thumb_${testFilename}`)).catch(() => {});
  }
});

test('INTEGRATION: metadata-only change ignored when no new images', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Modify only metadata.json (no image changes)
  await updateMetadata(testRepoPath, 'fake-image-entry.jpg');
  
  try {
    // Check semantic status
    const status = await git.getSemanticSyncStatus();
    
    // Should not count metadata change as an image
    assert.strictEqual(status.upload.count, 0, 'Should not count metadata-only change as image');
    
    logSuccess('Metadata-only change correctly ignored');
  } finally {
    // Restore metadata
    await git.git.checkout(['metadata.json']).catch(() => {});
  }
});

test('INTEGRATION: full upload flow - new image with thumbnail and metadata', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Create complete set: image + thumbnail + metadata
  const testFilename = `test-full-upload-${Date.now()}.jpg`;
  await createTestImage(testRepoPath, testFilename);
  await createTestThumbnail(testRepoPath, testFilename);
  await updateMetadata(testRepoPath, testFilename);
  
  try {
    // Get both raw and semantic status
    const rawStatus = await git.getStatus();
    const semanticStatus = await git.getSemanticSyncStatus();
    
    // Raw should show 3 files (image + thumb + metadata)
    assert.ok(rawStatus.files.length >= 3, 'Raw status should show at least 3 files');
    
    // Semantic should show 1 new image
    assert.strictEqual(semanticStatus.upload.count, 1, 'Should count 1 image');
    assert.strictEqual(semanticStatus.upload.newImages, 1, 'Should be categorized as new');
    assert.strictEqual(semanticStatus.upload.modifiedImages, 0, 'Should not be categorized as modified');
    assert.strictEqual(semanticStatus.upload.deletedImages, 0, 'Should not be categorized as deleted');
    
    logSuccess('Full upload flow correctly parsed: 3 raw files → 1 semantic image');
  } finally {
    // Cleanup
    await fs.unlink(path.join(testRepoPath, 'library', testFilename)).catch(() => {});
    await fs.unlink(path.join(testRepoPath, 'thumbs', `thumb_${testFilename}`)).catch(() => {});
    await git.git.checkout(['metadata.json']).catch(() => {});
  }
});

test('INTEGRATION: multiple images counted separately', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Create 3 new images
  const filenames = [
    `test-multi-1-${Date.now()}.jpg`,
    `test-multi-2-${Date.now()}.jpg`,
    `test-multi-3-${Date.now()}.jpg`
  ];
  
  for (const filename of filenames) {
    await createTestImage(testRepoPath, filename);
    await createTestThumbnail(testRepoPath, filename);
    await updateMetadata(testRepoPath, filename);
  }
  
  try {
    // Check semantic status
    const status = await git.getSemanticSyncStatus();
    
    // Should count all 3 images
    assert.strictEqual(status.upload.count, 3, 'Should count 3 images');
    assert.strictEqual(status.upload.newImages, 3, 'All should be new');
    
    logSuccess('Multiple images counted correctly');
    logInfo(`Detected ${status.upload.count} images from ${filenames.length} uploads`);
  } finally {
    // Cleanup
    for (const filename of filenames) {
      await fs.unlink(path.join(testRepoPath, 'library', filename)).catch(() => {});
      await fs.unlink(path.join(testRepoPath, 'thumbs', `thumb_${filename}`)).catch(() => {});
    }
    await git.git.checkout(['metadata.json']).catch(() => {});
  }
});

// ============================================================================
// Real-world Scenario Tests
// ============================================================================

test('Real-world: Current repo status matches expectations', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  
  try {
    // Get actual git status
    const gitStatus = await git.getStatus();
    const semanticStatus = await git.getSemanticSyncStatus();
    
    logInfo('=== Current Repository State ===');
    logInfo(`Uncommitted files: ${gitStatus.files.length}`);
    logInfo(`Commits ahead: ${gitStatus.ahead}`);
    logInfo(`Commits behind: ${gitStatus.behind}`);
    logInfo('');
    logInfo('=== Semantic Counts ===');
    logInfo(`Upload: ${semanticStatus.upload.count} (${semanticStatus.upload.newImages} new, ${semanticStatus.upload.modifiedImages} modified, ${semanticStatus.upload.deletedImages} deleted)`);
    logInfo(`Download: ${semanticStatus.download.count} (${semanticStatus.download.newImages} new, ${semanticStatus.download.modifiedImages} modified, ${semanticStatus.download.deletedImages} deleted)`);
    
    // Validate that semantic counts are never greater than raw counts
    const maxPossibleUpload = gitStatus.files.length + gitStatus.ahead;
    assert.ok(semanticStatus.upload.count <= maxPossibleUpload, 
      `Upload count (${semanticStatus.upload.count}) should not exceed raw file + commit count (${maxPossibleUpload})`);
    
    logSuccess('Semantic counts are within expected bounds');
  } catch (error) {
    throw new Error(`Real-world scenario test failed: ${error.message}`);
  }
});

// ============================================================================
// Test Runner
// ============================================================================

async function runTests() {
  logSection('🧪 Semantic Sync Tests');
  logInfo(`Testing against: ${FRAME_ART_PATH}`);
  
  // Setup test repo for integration tests
  const hasTestRepo = await setupTestRepo();
  
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const { name, fn } of tests) {
    // Skip integration tests if test repo not available
    if (name.startsWith('INTEGRATION:') && !hasTestRepo) {
      logInfo(`⊘ ${name} - (skipped - no test repo)`);
      skipped++;
      continue;
    }
    
    try {
      await fn();
      passed++;
    } catch (error) {
      if (error.message && error.message.includes('Skipping')) {
        logInfo(`⊘ ${name} - ${error.message}`);
        skipped++;
      } else {
        logError(`${name}`);
        console.error(`  ${error.message}`);
        if (error.stack) {
          console.error(`  ${error.stack.split('\n').slice(1, 3).join('\n')}`);
        }
        failed++;
      }
    }
  }
  
  // Cleanup test repo
  await cleanupTestRepo();
  
  logSection('📊 Test Results');
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  if (skipped > 0) {
    console.log(`${colors.yellow}Skipped: ${skipped}${colors.reset}`);
  }
  console.log(`Total: ${tests.length}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
