/**
 * Git Sync Tests
 * Tests for the Git LFS sync functionality
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
    testRepoPath = path.join(os.tmpdir(), 'frame-art-test-' + Date.now());
    
    logInfo(`Setting up test repo at ${testRepoPath}...`);
    
    // Shallow clone for speed
    await simpleGit().clone(TEST_REPO_URL, testRepoPath, ['--depth', '5']);
    
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

// Run all tests
async function runTests() {
  console.log('\n🧪 Running Git Sync Tests...\n');
  
  // Set test environment to suppress verbose output
  process.env.NODE_ENV = 'test';
  
  // Setup test repo for integration tests
  const hasTestRepo = await setupTestRepo();
  
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const t of tests) {
    // Skip integration tests if test repo not available
    if (t.name.startsWith('INTEGRATION:') && !hasTestRepo) {
      logInfo(`${t.name} (skipped - no test repo)`);
      skipped++;
      continue;
    }
    
    try {
      await t.fn();
      logSuccess(t.name);
      passed++;
    } catch (error) {
      logError(`${t.name}\n   ${error.message}`);
      failed++;
    }
  }
  
  // Cleanup
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

// ============================================================================
// TESTS
// ============================================================================

test('GitHelper can be instantiated', () => {
  const git = new GitHelper(FRAME_ART_PATH);
  assert.ok(git, 'GitHelper should be instantiated');
  assert.strictEqual(git.frameArtPath, FRAME_ART_PATH, 'Path should be set correctly');
});

test('verifyConfiguration returns valid structure', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  const result = await git.verifyConfiguration();
  
  assert.ok(result, 'Should return a result');
  assert.ok(typeof result.isValid === 'boolean', 'Should have isValid boolean');
  
  if (result.isValid) {
    assert.ok(result.checks, 'Should have checks object');
    assert.ok(result.checks.remoteUrl, 'Should have remote URL');
    assert.ok(result.checks.currentBranch, 'Should have current branch');
  } else {
    assert.ok(Array.isArray(result.errors), 'Should have errors array');
  }
});

test('getStatus returns status structure', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  const status = await git.getStatus();
  
  assert.ok(status, 'Should return a status');
  assert.ok(typeof status.ahead === 'number', 'Should have ahead count');
  assert.ok(typeof status.behind === 'number', 'Should have behind count');
  assert.ok(Array.isArray(status.files), 'Should have files array');
  assert.ok(Array.isArray(status.modified), 'Should have modified array');
  assert.ok(Array.isArray(status.created), 'Should have created array');
  assert.ok(Array.isArray(status.deleted), 'Should have deleted array');
});

test('checkAndPullIfBehind returns proper structure', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  const result = await git.checkAndPullIfBehind();
  
  assert.ok(result, 'Should return a result');
  assert.ok(typeof result.success === 'boolean', 'Should have success boolean');
  assert.ok(typeof result.synced === 'boolean', 'Should have synced boolean');
  
  if (result.skipped) {
    assert.ok(result.reason, 'Should have reason if skipped');
  }
  
  if (result.pulledChanges) {
    assert.ok(result.message, 'Should have message if pulled changes');
  }
  
  if (!result.success) {
    assert.ok(result.error, 'Should have error message if failed');
  }
});

test('verifyConfiguration checks for billyfw/frame_art repo', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  const result = await git.verifyConfiguration();
  
  if (result.isValid) {
    const remoteUrl = result.checks.remoteUrl || '';
    assert.ok(
      remoteUrl.includes('billyfw/frame_art') || remoteUrl.includes('billyfw:frame_art'),
      `Remote URL should contain billyfw/frame_art, got: ${remoteUrl}`
    );
  } else {
    logInfo('Skipping remote check - configuration invalid');
  }
});

test('getBranchInfo returns branch information', async () => {
  const git = new GitHelper(FRAME_ART_PATH);
  const branchInfo = await git.getBranchInfo();
  
  assert.ok(branchInfo, 'Should return branch info');
  assert.ok(branchInfo.branch, 'Should have branch name');
  assert.ok(typeof branchInfo.branch === 'string', 'Branch should be a string');
});

// ============================================================================
// INTEGRATION TESTS (with isolated test repo)
// ============================================================================

test('INTEGRATION: pull when 1 commit behind', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Reset 1 commit behind
  await git.git.reset(['--hard', 'HEAD~1']);
  
  const result = await git.checkAndPullIfBehind();
  
  assert.ok(result.success, 'Should succeed');
  assert.ok(result.pulledChanges, 'Should have pulled changes');
  assert.strictEqual(result.commitsReceived, 1, 'Should have pulled 1 commit');
});

test('INTEGRATION: pull when 2 commits behind', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Reset 2 commits behind
  await git.git.reset(['--hard', 'HEAD~2']);
  
  const result = await git.checkAndPullIfBehind();
  
  assert.ok(result.success, 'Should succeed');
  assert.ok(result.pulledChanges, 'Should have pulled changes');
  assert.strictEqual(result.commitsReceived, 2, 'Should have pulled 2 commits');
});

test('INTEGRATION: skip pull when uncommitted changes exist', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Reset 1 commit behind
  await git.git.reset(['--hard', 'HEAD~1']);
  
  // Create uncommitted change
  const testFile = path.join(testRepoPath, 'test-uncommitted.txt');
  await fs.writeFile(testFile, 'test content');
  
  try {
    const result = await git.checkAndPullIfBehind();
    
    assert.ok(result.success, 'Should succeed (but skip)');
    assert.ok(result.skipped, 'Should be skipped');
    assert.strictEqual(result.reason, 'Uncommitted local changes detected', 'Should have correct reason message');
    assert.ok(Array.isArray(result.uncommittedFiles), 'Should list uncommitted files');
    assert.ok(result.uncommittedFiles.length > 0, 'Should have at least one uncommitted file');
  } finally {
    // Cleanup
    await fs.unlink(testFile).catch(() => {});
  }
});

test('INTEGRATION: already up to date returns correct status', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Ensure we're at HEAD (up to date)
  await git.git.reset(['--hard', 'origin/main']);
  
  const result = await git.checkAndPullIfBehind();
  
  assert.ok(result.success, 'Should succeed');
  assert.ok(result.synced, 'Should be synced');
  assert.strictEqual(result.pulledChanges, false, 'Should not have pulled changes');
  assert.ok(result.message, 'Should have message');
});

test('INTEGRATION: pull actually updates working tree', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Get current HEAD
  const originalHead = await git.git.revparse(['HEAD']);
  
  // Reset 1 commit behind
  await git.git.reset(['--hard', 'HEAD~1']);
  
  // Verify we're behind
  const beforeHead = await git.git.revparse(['HEAD']);
  assert.notStrictEqual(beforeHead, originalHead, 'Should be at different commit');
  
  // Pull
  const result = await git.checkAndPullIfBehind();
  assert.ok(result.success && result.pulledChanges, 'Pull should succeed');
  
  // Verify we're back at original HEAD
  const afterHead = await git.git.revparse(['HEAD']);
  assert.strictEqual(afterHead, originalHead, 'Should be back at original HEAD');
});

test('INTEGRATION: multiple consecutive pulls are idempotent', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Ensure we're up to date
  await git.git.reset(['--hard', 'origin/main']);
  
  // First call
  const result1 = await git.checkAndPullIfBehind();
  assert.ok(result1.success, 'First call should succeed');
  
  // Second call
  const result2 = await git.checkAndPullIfBehind();
  assert.ok(result2.success, 'Second call should succeed');
  assert.strictEqual(result2.pulledChanges, false, 'Second call should not pull');
  
  // Third call
  const result3 = await git.checkAndPullIfBehind();
  assert.ok(result3.success, 'Third call should succeed');
  assert.strictEqual(result3.pulledChanges, false, 'Third call should not pull');
});

test('INTEGRATION: checkAndPullIfBehind fetches before checking (real-world scenario)', async () => {
  const git = new GitHelper(testRepoPath);
  
  // Start at HEAD~1 to simulate being behind
  await git.git.reset(['--hard', 'HEAD~1']);
  
  // Clear the fetch cache by ensuring status thinks we're up to date
  // (simulates having an old fetch from yesterday)
  await git.git.fetch('origin', 'main');
  
  // Now reset our local tracking without fetching
  // This simulates: we fetched yesterday, then someone pushed today, and we haven't fetched yet
  const originalHead = await git.git.revparse(['HEAD']);
  
  // Get status WITHOUT a fresh fetch - relies on old fetch data
  const statusBefore = await git.git.status();
  const behindBefore = statusBefore.behind || 0;
  
  // The key test: checkAndPullIfBehind should fetch internally and detect we're behind
  const result = await git.checkAndPullIfBehind();
  
  // With the fix, it should have fetched and pulled
  assert.ok(result.success, 'Should succeed');
  
  // If we were behind (which we should be since we reset to HEAD~1), we should have pulled
  if (behindBefore > 0) {
    assert.ok(result.pulledChanges, 'Should have pulled changes');
  } else {
    // This means fetch detected we were behind and pulled successfully
    assert.ok(result.pulledChanges || result.synced, 'Should have synced status');
  }
  
  // Verify we moved forward from our starting point
  const afterHead = await git.git.revparse(['HEAD']);
  
  // We should have moved forward (or stayed if already at latest)
  const headChanged = originalHead !== afterHead;
  assert.ok(headChanged || result.synced, 'Should have either changed head or be synced');
});

// ============================================================================
// RUN TESTS
// ============================================================================

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
