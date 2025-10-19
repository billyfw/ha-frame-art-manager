/**
 * Upload Validation Tests
 * Ensures sync guardrails prevent invalid uploads from being committed
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const simpleGit = require('simple-git');
const syncRouter = require('../routes/sync');

const SYNC_LOG_PATH = path.join(__dirname, '..', 'sync_logs.json');

// Locate the /full route handler from the Express router
const fullSyncLayer = syncRouter.stack.find(layer => layer.route && layer.route.path === '/full');
const fullSyncHandler = fullSyncLayer?.route?.stack?.[0]?.handle;

if (typeof fullSyncHandler !== 'function') {
  throw new Error('Could not locate /api/sync/full handler for tests');
}

// Color helpers for pretty output
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

function logSection(message) {
  console.log(`\n${colors.blue}${message}${colors.reset}`);
}

// Minimal test harness
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('\n🧪 Running Upload Validation Tests...\n');

  process.env.NODE_ENV = 'test';

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      logSuccess(name);
      passed++;
    } catch (error) {
      logError(`${name}\n   ${error.message}`);
      failed++;
    }
  }

  logSection('📊 Test Results');
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  console.log(`Total: ${tests.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupTestRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-art-upload-test-'));
  await fs.mkdir(path.join(repoPath, 'library'), { recursive: true });
  await fs.mkdir(path.join(repoPath, 'thumbs'), { recursive: true });

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.name', 'Upload Guardrail Tests');
  await git.addConfig('user.email', 'upload-tests@example.com');

  const baseMetadata = {
    version: '1.0',
    images: {},
    tvs: [],
    tags: []
  };

  await fs.writeFile(
    path.join(repoPath, 'metadata.json'),
    JSON.stringify(baseMetadata, null, 2) + '\n'
  );

  await git.add(['metadata.json']);
  await git.commit('Initial metadata');

  return { repoPath, git };
}

async function cleanupRepo(repoPath) {
  await fs.rm(repoPath, { recursive: true, force: true });
}

async function readMetadata(repoPath) {
  const metadataPath = path.join(repoPath, 'metadata.json');
  const raw = await fs.readFile(metadataPath, 'utf8');
  return JSON.parse(raw);
}

async function addMetadataEntry(repoPath, imageName) {
  const metadataPath = path.join(repoPath, 'metadata.json');
  const metadata = await readMetadata(repoPath);
  metadata.images[imageName] = {
    matte: 'none',
    filter: 'none',
    tags: [],
    dimensions: { width: 100, height: 100 },
    aspectRatio: 1,
    added: new Date().toISOString()
  };

  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
}

async function readSyncLogs() {
  try {
    const raw = await fs.readFile(SYNC_LOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeSyncLogs(logs) {
  await fs.writeFile(SYNC_LOG_PATH, JSON.stringify(logs, null, 2) + '\n');
}

async function snapshotSyncLogs() {
  try {
    const raw = await fs.readFile(SYNC_LOG_PATH, 'utf8');
    return {
      existed: true,
      logs: JSON.parse(raw)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        existed: false,
        logs: []
      };
    }
    throw error;
  }
}

async function restoreSyncLogs(snapshot) {
  if (!snapshot) {
    return;
  }

  if (!snapshot.existed) {
    await fs.rm(SYNC_LOG_PATH, { force: true });
    return;
  }

  await writeSyncLogs(snapshot.logs);
}

async function invokeFullSync(frameArtPath) {
  const req = {
    method: 'POST',
    url: '/full',
    frameArtPath,
    body: {},
    headers: {},
    query: {},
    params: {},
    get() {
      return undefined;
    }
  };

  return new Promise(async (resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      jsonPayload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      set(field, value) {
        this.headers[field.toLowerCase()] = value;
        return this;
      },
      json(payload) {
        this.jsonPayload = payload;
        resolve({ statusCode: this.statusCode, body: payload });
        return this;
      }
    };

    try {
      await fullSyncHandler(req, res, (err) => {
        if (err) {
          reject(err);
        } else if (!res.jsonPayload) {
          resolve({ statusCode: res.statusCode, body: undefined });
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function expectFileMissing(filePath) {
  try {
    await fs.stat(filePath);
    throw new Error(`Expected ${filePath} to be removed`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function formatPointerContent(oid, size) {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('INTEGRATION: sync rejects empty uploaded image and cleans up', async () => {
  const { repoPath, git } = await setupTestRepo();
  const imageName = 'test-empty.jpg';
  const libraryPath = path.join(repoPath, 'library', imageName);
  const thumbPath = path.join(repoPath, 'thumbs', `thumb_${imageName}`);

  await fs.writeFile(libraryPath, '');
  await fs.writeFile(thumbPath, '');
  await addMetadataEntry(repoPath, imageName);

  const logSnapshot = await snapshotSyncLogs();

  try {
    const response = await invokeFullSync(repoPath);

    assert.strictEqual(response.statusCode, 400, 'Should respond with HTTP 400');
    assert.strictEqual(response.body.success, false, 'Response should indicate failure');
    assert.ok(
      response.body.error.includes('File is empty after upload.'),
      'Error message should include reason'
    );
    assert.ok(Array.isArray(response.body.validationErrors), 'validationErrors should be array');
    const libraryError = response.body.validationErrors.find(err => err.file === `library/${imageName}`);
    assert.ok(libraryError, 'Validation errors should include the library image');
    assert.strictEqual(
      libraryError.reason,
      'File is empty after upload.',
      'Validation reason should explain the failure'
    );
    assert.ok(
      Array.isArray(response.body.cleanedUpImages) &&
        response.body.cleanedUpImages.includes(imageName),
      'Cleaned up images should include the failed upload'
    );

    await expectFileMissing(libraryPath);
    await expectFileMissing(thumbPath);

    const metadata = await readMetadata(repoPath);
    assert.ok(!metadata.images[imageName], 'Metadata entry should be removed');

    const status = await git.status();
    const lingeringUploads = status.files.filter(file =>
      file.path.startsWith('library/') || file.path.startsWith('thumbs/')
    );
    assert.strictEqual(lingeringUploads.length, 0, 'No library or thumbnail files should remain after cleanup');

    const logs = await readSyncLogs();
    assert.ok(Array.isArray(logs) && logs.length > 0, 'Sync logs should contain an entry');
    const latestLog = logs[0];
    assert.ok(
      latestLog.message.includes('File is empty after upload.'),
      'Sync history message should include validation reason'
    );
    assert.ok(
      Array.isArray(latestLog.lostChanges) &&
        latestLog.lostChanges.some(entry => entry.includes('File is empty after upload.')),
      'Sync history details should list validation reason'
    );
  } finally {
    await restoreSyncLogs(logSnapshot);
    await cleanupRepo(repoPath);
  }
});

test('INTEGRATION: sync rejects Git LFS pointer uploads and cleans up', async () => {
  const { repoPath, git } = await setupTestRepo();
  const imageName = 'test-pointer.jpg';
  const libraryPath = path.join(repoPath, 'library', imageName);
  const thumbPath = path.join(repoPath, 'thumbs', `thumb_${imageName}`);

  const pointerContent = formatPointerContent('a'.repeat(64), 123456);
  await fs.writeFile(libraryPath, pointerContent);
  await fs.writeFile(thumbPath, 'thumbnail');
  await addMetadataEntry(repoPath, imageName);

  const logSnapshot = await snapshotSyncLogs();

  try {
    const response = await invokeFullSync(repoPath);

    assert.strictEqual(response.statusCode, 400, 'Should respond with HTTP 400');
    assert.strictEqual(response.body.success, false, 'Response should indicate failure');
    assert.ok(
      response.body.error.includes('Git LFS pointer'),
      'Error message should mention Git LFS pointer'
    );
    assert.ok(Array.isArray(response.body.validationErrors), 'validationErrors should be array');
    const libraryError = response.body.validationErrors.find(err => err.file === `library/${imageName}`);
    assert.ok(libraryError, 'Validation errors should include the library image');
    assert.strictEqual(
      libraryError.reason,
      'File appears to be a Git LFS pointer and was not hydrated.',
      'Validation reason should detect pointer files'
    );
    assert.ok(
      Array.isArray(response.body.cleanedUpImages) &&
        response.body.cleanedUpImages.includes(imageName),
      'Cleaned up images should include the failed upload'
    );

    await expectFileMissing(libraryPath);
    await expectFileMissing(thumbPath);

    const metadata = await readMetadata(repoPath);
    assert.ok(!metadata.images[imageName], 'Metadata entry should be removed');

    const status = await git.status();
    const lingeringUploads = status.files.filter(file =>
      file.path.startsWith('library/') || file.path.startsWith('thumbs/')
    );
    assert.strictEqual(lingeringUploads.length, 0, 'No library or thumbnail files should remain after cleanup');

    const logs = await readSyncLogs();
    assert.ok(Array.isArray(logs) && logs.length > 0, 'Sync logs should contain an entry');
    const latestLog = logs[0];
    assert.ok(
      latestLog.message.includes('Git LFS pointer'),
      'Sync history message should include pointer reason'
    );
    assert.ok(
      Array.isArray(latestLog.lostChanges) &&
        latestLog.lostChanges.some(entry => entry.includes('Git LFS pointer')),
      'Sync history details should list pointer reason'
    );
  } finally {
    await restoreSyncLogs(logSnapshot);
    await cleanupRepo(repoPath);
  }
});

runTests().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
