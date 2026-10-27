const { execFile } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

/**
 * First-run library setup: connect an empty library folder to a GitHub repo.
 *
 * The add-on generates an ssh key (run.sh, /data/ssh/id_ed25519) when no
 * ssh_private_key is configured; the user adds its public half to their repo as a
 * deploy key with write access, then the UI tests the repo and either clones it
 * (remote has commits) or starts a new library and pushes it (remote is empty).
 *
 * Setup can run on a fresh install or later, on a library that has been used
 * without sync for a while. Safety rules: a folder that is already a git repository
 * is never touched; local files are never moved, replaced or deleted, so a library
 * with images can only start a new repository (its images are committed and pushed),
 * and only a folder holding nothing beyond the startup skeleton (empty library/,
 * thumbs/, originals/ and an image-less metadata.json) can receive a clone. User
 * input reaches git only as an argument array, never through a shell.
 */

const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH = 'main';
const SKELETON_DIRS = ['library', 'thumbs', 'originals'];
const METADATA_FILE = 'metadata.json';
const INITIAL_METADATA = { version: '1.0', images: {}, tags: [] };
// Same layout as the existing libraries: images, thumbnails and originals in LFS,
// metadata.json as plain text so it diffs and merges.
const GITATTRIBUTES = [
  'library/** filter=lfs diff=lfs merge=lfs -text',
  'thumbs/** filter=lfs diff=lfs merge=lfs -text',
  'originals/** filter=lfs diff=lfs merge=lfs -text',
  ''
].join('\n');
// Desktop clutter that must not end up in a new library's history.
const GITIGNORE = ['.DS_Store', '._*', 'Thumbs.db', ''].join('\n');
const COMMIT_NAME = 'Frame Art Manager';
const COMMIT_EMAIL = 'frame-art-manager@homeassistant.local';

const REMOTE_TIMEOUT_MS = 60 * 1000;
const CLONE_TIMEOUT_MS = 30 * 60 * 1000;
const LFS_PULL_TIMEOUT_MS = 60 * 60 * 1000;

let setupInProgress = false;

function isSetupInProgress() {
  return setupInProgress;
}

function beginSetup() {
  if (setupInProgress) return false;
  setupInProgress = true;
  return true;
}

function endSetup() {
  setupInProgress = false;
}

/**
 * Validate a GitHub repository given as owner/name.
 * A pasted trailing ".git" is dropped; everything else must match strictly.
 * @returns {{valid: boolean, repo?: string, error?: string}}
 */
function validateRepoName(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Enter the repository as owner/name' };
  }
  const repo = input.trim().replace(/\.git$/, '');
  if (!REPO_PATTERN.test(repo) || repo.includes('..')) {
    return { valid: false, error: 'Enter the repository as owner/name (letters, digits, "-", "_" and ".")' };
  }
  const name = repo.split('/')[1];
  if (name.startsWith('.') || name.startsWith('-')) {
    return { valid: false, error: 'The repository name cannot start with "." or "-"' };
  }
  return { valid: true, repo };
}

function remoteUrlFor(repo) {
  return `git@github.com:${repo}.git`;
}

/** Strip credentials from an https remote before it is shown anywhere. */
function redactRemoteUrl(url) {
  if (!url) return url;
  return url.replace(/^(https?:\/\/)[^@/]+@/i, '$1');
}

async function isEmptyMetadata(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const images = parsed && parsed.images;
    const noImages = !images || (typeof images === 'object' && Object.keys(images).length === 0);
    const noTags = !parsed.tags || (Array.isArray(parsed.tags) && parsed.tags.length === 0);
    return noImages && noTags;
  } catch {
    return false;
  }
}

/**
 * Look at the library folder without changing it.
 * @returns {Promise<{exists: boolean, isRepo: boolean, userFiles: string[], skeleton: string[], imageCount: number}>}
 *   userFiles:  entries that are not part of the app's startup skeleton.
 *   skeleton:   skeleton entries present (safe to remove before a clone).
 *   imageCount: entries in library/.
 */
async function inspectLibraryFolder(frameArtPath) {
  let entries;
  try {
    entries = await fs.readdir(frameArtPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { exists: false, isRepo: false, userFiles: [], skeleton: [], imageCount: 0 };
    }
    throw error;
  }

  const result = { exists: true, isRepo: false, userFiles: [], skeleton: [], imageCount: 0 };
  for (const entry of entries) {
    if (entry.name === '.git') {
      result.isRepo = true;
      continue;
    }
    const fullPath = path.join(frameArtPath, entry.name);
    if (entry.isDirectory() && SKELETON_DIRS.includes(entry.name)) {
      const inner = await fs.readdir(fullPath);
      if (entry.name === 'library') {
        result.imageCount = inner.length;
      }
      if (inner.length === 0) {
        result.skeleton.push(entry.name);
      } else {
        result.userFiles.push(`${entry.name}/ (${inner.length} item${inner.length === 1 ? '' : 's'})`);
      }
      continue;
    }
    if (entry.isFile() && entry.name === METADATA_FILE && await isEmptyMetadata(fullPath)) {
      result.skeleton.push(entry.name);
      continue;
    }
    result.userFiles.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
  }
  return result;
}

/**
 * What the UI should offer for a given folder inspection.
 * hasLocalFiles: the library has been used (images or other files), so only an
 * empty repository can be connected, and the setup screen does not open by itself.
 * @returns {{needsSetup: boolean, canConnect: boolean, hasLocalFiles: boolean}}
 */
function describeSetupState(inspection) {
  if (inspection.isRepo) {
    return { needsSetup: false, canConnect: false, hasLocalFiles: false };
  }
  return { needsSetup: true, canConnect: true, hasLocalFiles: inspection.userFiles.length > 0 };
}

const MERGE_REFUSED = 'This repository already has a library, and this add-on has its own images. ' +
  'Merging two libraries is not supported: connect an empty repository to upload the images here, ' +
  'or empty the library folder to download the repository\'s library instead.';

/**
 * Throws unless setup may connect this folder to a remote in remoteState
 * ('empty' or 'has_content'). error.code: ALREADY_REPO or FOLDER_NOT_EMPTY.
 */
function assertCanConnect(inspection, remoteState) {
  if (inspection.isRepo) {
    const error = new Error('The library folder is already a git repository; setup leaves it untouched.');
    error.code = 'ALREADY_REPO';
    throw error;
  }
  if (remoteState === 'has_content' && inspection.userFiles.length > 0) {
    const error = new Error(MERGE_REFUSED);
    error.code = 'FOLDER_NOT_EMPTY';
    throw error;
  }
}

/**
 * Key the add-on generated, public half only. The path comes from run.sh and is set
 * only when the generated key is the one in use (no ssh_private_key configured).
 */
async function readGeneratedPublicKey(env = process.env) {
  const keyPath = env.FRAME_ART_GENERATED_PUBLIC_KEY;
  if (!keyPath) return null;
  try {
    const key = (await fs.readFile(keyPath, 'utf8')).trim();
    if (!key.startsWith('ssh-') || key.includes('PRIVATE')) return null;
    return key;
  } catch {
    return null;
  }
}

function keySource(env = process.env) {
  const source = env.FRAME_ART_SSH_KEY_SOURCE;
  return source === 'generated' || source === 'config' ? source : 'none';
}

function runGit(args, { cwd, timeout = REMOTE_TIMEOUT_MS, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        error.timedOut = Boolean(error.killed);
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Last lines of git's stderr, for showing next to a failure. */
function gitErrorDetail(error) {
  const text = String((error && (error.stderr || error.message)) || '').trim();
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.slice(-4).join('\n').slice(0, 600);
}

const ERROR_STATES = {
  no_access: 'GitHub rejected the key. Add the public key below to the repository as a deploy key (with "Allow write access" checked), then test again.',
  not_found: 'Repository not found. Check the owner/name, and that the deploy key was added to this repository (not another one).',
  read_only: 'The deploy key is read-only. Delete it on GitHub and add it again with "Allow write access" checked.',
  network: 'Could not reach GitHub. Check the network connection of Home Assistant and try again.',
  error: 'Git could not access the repository.'
};

/** Map a failed git command to one of the ERROR_STATES keys. */
function classifyGitError(error) {
  if (error && error.timedOut) return 'network';
  const text = String((error && (error.stderr || error.message)) || '');
  if (/marked as read only/i.test(text)) return 'read_only';
  if (/Permission denied \(publickey/i.test(text)) return 'no_access';
  if (/Repository not found|does not appear to be a git repository|repository .* does not exist/i.test(text)) return 'not_found';
  if (/Could not resolve hostname|Connection timed out|Operation timed out|Network is unreachable|Connection refused|Connection closed|No route to host|kex_exchange_identification/i.test(text)) return 'network';
  return 'error';
}

function failure(state, error) {
  return { ok: false, state, message: ERROR_STATES[state], detail: gitErrorDetail(error) };
}

/**
 * Dry-run push from a throwaway repo: GitHub answers a read-only deploy key at
 * connect time, before anything would be sent, so nothing lands on the remote.
 */
async function probeWriteAccess(remoteUrl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-art-probe-'));
  try {
    await runGit(['init', '-q'], { cwd: dir });
    await runGit(['-c', `user.name=${COMMIT_NAME}`, '-c', `user.email=${COMMIT_EMAIL}`, '-c', 'commit.gpgsign=false',
      'commit', '-q', '--allow-empty', '-m', 'write access probe'], { cwd: dir });
    await runGit(['push', '--dry-run', '--quiet', remoteUrl, 'HEAD:refs/heads/frame-art-manager-write-probe'], { cwd: dir });
    return { ok: true };
  } catch (error) {
    return failure(classifyGitError(error), error);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Check what the remote holds and whether the key can write to it.
 * @returns {Promise<{ok: boolean, state: string, message: string, detail?: string}>}
 *   state on success: 'empty' (connect starts a new library) or 'has_content' (connect clones).
 */
async function checkRemote(remoteUrl) {
  let refs;
  try {
    const { stdout } = await runGit(['ls-remote', remoteUrl]);
    refs = stdout.split('\n').map(line => line.split('\t')[1]).filter(Boolean);
  } catch (error) {
    return failure(classifyGitError(error), error);
  }

  const write = await probeWriteAccess(remoteUrl);
  if (!write.ok) return write;

  const branches = refs.filter(ref => ref.startsWith('refs/heads/'));
  if (branches.length === 0) {
    return { ok: true, state: 'empty', message: 'Connected. The repository is empty: "Connect library" will start a new library and push it.' };
  }
  if (!branches.includes(`refs/heads/${BRANCH}`)) {
    return {
      ok: false,
      state: 'no_main',
      message: `The repository has commits but no "${BRANCH}" branch. Frame Art Manager syncs the "${BRANCH}" branch only.`
    };
  }
  return { ok: true, state: 'has_content', message: 'Connected. The repository already has a library: "Connect library" will download it.' };
}

/**
 * checkRemote() plus what connecting would do to this folder: an empty remote takes
 * the folder's images, a remote with a library needs a folder without user files.
 */
async function checkConnection(frameArtPath, remoteUrl) {
  const remote = await checkRemote(remoteUrl);
  if (!remote.ok) return remote;
  const inspection = await inspectLibraryFolder(frameArtPath);
  try {
    assertCanConnect(inspection, remote.state);
  } catch (error) {
    return { ok: false, state: error.code === 'FOLDER_NOT_EMPTY' ? 'needs_empty_folder' : error.code, message: error.message };
  }
  if (remote.state === 'empty' && inspection.imageCount > 0) {
    const images = `${inspection.imageCount} image${inspection.imageCount === 1 ? '' : 's'}`;
    return { ...remote, message: `Connected. The repository is empty: "Connect library" will upload this add-on's library (${images}) to it.` };
  }
  return remote;
}

async function ensureCommitIdentity(dir) {
  for (const [key, value] of [['user.name', COMMIT_NAME], ['user.email', COMMIT_EMAIL]]) {
    const configured = await runGit(['config', '--get', key], { cwd: dir }).then(r => r.stdout.trim()).catch(() => '');
    if (!configured) {
      await runGit(['config', key, value], { cwd: dir });
    }
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureLfsUsesSsh(dir) {
  const GitHelper = require('./git_helper');
  await new GitHelper(dir).ensureLfsUsesSsh();
}

async function writeNewFile(filePath, content) {
  try {
    await fs.writeFile(filePath, content, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Remote is empty: turn the folder into a library repo and push it. Whatever the
 * folder already holds (images, thumbnails, originals, metadata.json) becomes the
 * first commit; nothing in it is changed.
 */
async function initializeNewLibrary(frameArtPath, remoteUrl, imageCount, onStep) {
  const gitDir = path.join(frameArtPath, '.git');
  const attributesPath = path.join(frameArtPath, '.gitattributes');
  const ignorePath = path.join(frameArtPath, '.gitignore');
  const metadataPath = path.join(frameArtPath, METADATA_FILE);

  onStep('Creating a new library');
  await fs.mkdir(frameArtPath, { recursive: true });
  for (const dir of SKELETON_DIRS) {
    await fs.mkdir(path.join(frameArtPath, dir), { recursive: true });
  }
  // LFS must be configured before the first `git add`, or images go in as plain blobs.
  if (!await writeNewFile(attributesPath, GITATTRIBUTES)) {
    const error = new Error('The library folder already has a .gitattributes file. Move it out of the folder and run setup again.');
    error.code = 'FOLDER_CONFLICT';
    throw error;
  }
  const createdIgnore = await writeNewFile(ignorePath, GITIGNORE);
  try {
    if (!await pathExists(metadataPath)) {
      await fs.writeFile(metadataPath, JSON.stringify(INITIAL_METADATA, null, 2));
    }
    await runGit(['init', '-q'], { cwd: frameArtPath });
    await runGit(['symbolic-ref', 'HEAD', `refs/heads/${BRANCH}`], { cwd: frameArtPath });
    await ensureCommitIdentity(frameArtPath);
    await runGit(['lfs', 'install', '--local'], { cwd: frameArtPath });
    await runGit(['remote', 'add', 'origin', remoteUrl], { cwd: frameArtPath });
    await ensureLfsUsesSsh(frameArtPath);
    await runGit(['add', '-A'], { cwd: frameArtPath });
    const message = imageCount > 0
      ? `Initialize Frame Art library with ${imageCount} image${imageCount === 1 ? '' : 's'}`
      : 'Initialize Frame Art library';
    await runGit(['commit', '-q', '-m', message], { cwd: frameArtPath });

    onStep(imageCount > 0
      ? `Uploading the library to GitHub (${imageCount} image${imageCount === 1 ? '' : 's'})`
      : 'Pushing the new library to GitHub');
    await runGit(['push', '-u', 'origin', BRANCH], { cwd: frameArtPath, timeout: CLONE_TIMEOUT_MS });
  } catch (error) {
    // Undo only what this function created (never the user's files), so setup can be retried.
    await fs.rm(gitDir, { recursive: true, force: true });
    await fs.rm(attributesPath, { force: true });
    if (createdIgnore) await fs.rm(ignorePath, { force: true });
    throw error;
  }
  return { action: 'initialized' };
}

/** Remote has commits: clone it into the (skeleton-only) folder, then fetch LFS files. */
async function cloneLibrary(frameArtPath, remoteUrl, skeleton, onStep) {
  // Only the app's own startup skeleton is removed: rmdir fails on a non-empty
  // directory, and metadata.json was checked to hold no images or tags.
  for (const entry of skeleton) {
    const target = path.join(frameArtPath, entry);
    if (entry === METADATA_FILE) {
      await fs.unlink(target);
    } else {
      await fs.rmdir(target);
    }
  }

  onStep('Downloading the library from GitHub');
  await fs.mkdir(frameArtPath, { recursive: true });
  // LFS files come after the clone, once LFS is pointed at the ssh endpoint.
  await runGit(['clone', '--quiet', '--branch', BRANCH, '--origin', 'origin', '--', remoteUrl, frameArtPath], {
    timeout: CLONE_TIMEOUT_MS,
    env: { GIT_LFS_SKIP_SMUDGE: '1' }
  });
  await ensureCommitIdentity(frameArtPath);
  await runGit(['lfs', 'install', '--local'], { cwd: frameArtPath });
  await ensureLfsUsesSsh(frameArtPath);

  onStep('Downloading images (Git LFS)');
  try {
    await runGit(['lfs', 'pull'], { cwd: frameArtPath, timeout: LFS_PULL_TIMEOUT_MS });
  } catch (error) {
    return {
      action: 'cloned',
      warning: `The library was cloned, but some images could not be downloaded yet (${gitErrorDetail(error) || error.message}). ` +
        'They are fetched again on the next sync.'
    };
  }
  return { action: 'cloned' };
}

/**
 * Connect the library folder to a remote that checkRemote() reported on.
 * Re-inspects the folder first: an existing repo is refused, and a folder with
 * files can only start a new library in an empty remote.
 * @param {{frameArtPath: string, remoteUrl: string, remoteState: 'empty'|'has_content', onStep?: Function}} options
 * @returns {Promise<{action: 'initialized'|'cloned', warning?: string}>}
 */
async function connectLibrary({ frameArtPath, remoteUrl, remoteState, onStep = () => {} }) {
  const inspection = await inspectLibraryFolder(frameArtPath);
  assertCanConnect(inspection, remoteState);

  if (remoteState === 'empty') {
    return initializeNewLibrary(frameArtPath, remoteUrl, inspection.imageCount, onStep);
  }
  if (remoteState === 'has_content') {
    return cloneLibrary(frameArtPath, remoteUrl, inspection.skeleton, onStep);
  }
  throw new Error(`Cannot connect a repository in state "${remoteState}"`);
}

async function getOriginUrl(frameArtPath) {
  try {
    const { stdout } = await runGit(['remote', 'get-url', 'origin'], { cwd: frameArtPath, timeout: 10000 });
    return redactRemoteUrl(stdout.trim()) || null;
  } catch {
    return null;
  }
}

module.exports = {
  REPO_PATTERN,
  GITATTRIBUTES,
  MERGE_REFUSED,
  validateRepoName,
  remoteUrlFor,
  redactRemoteUrl,
  inspectLibraryFolder,
  describeSetupState,
  assertCanConnect,
  readGeneratedPublicKey,
  keySource,
  classifyGitError,
  checkRemote,
  checkConnection,
  connectLibrary,
  getOriginUrl,
  isSetupInProgress,
  beginSetup,
  endSetup
};
