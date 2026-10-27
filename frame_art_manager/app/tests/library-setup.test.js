const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setup = require('../library_setup');

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  skip  ${name} (${reason})`);
}

const tempDirs = [];

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `frame-art-setup-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The folder the app leaves behind at startup on a fresh install (server.js initializeDirectories). */
function makeSkeleton(dir) {
  for (const sub of ['library', 'thumbs', 'originals']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ version: '1.0', images: {}, tags: [] }, null, 2));
}

function hasGitLfs() {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  console.log('\nTesting library setup...\n');

  // --- repository names -------------------------------------------------------
  await test('accepts owner/name and normalizes whitespace and a trailing .git', () => {
    assert.deepStrictEqual(setup.validateRepoName('octo-cat/frame_art'), { valid: true, repo: 'octo-cat/frame_art' });
    assert.deepStrictEqual(setup.validateRepoName('  someone/art.library  '), { valid: true, repo: 'someone/art.library' });
    assert.deepStrictEqual(setup.validateRepoName('someone/frame_art.git'), { valid: true, repo: 'someone/frame_art' });
  });

  await test('rejects anything that is not a plain owner/name', () => {
    const bad = [
      undefined, null, 42, '', 'frame_art', 'a/b/c', 'owner/', '/name',
      'owner/..', 'owner/a..b', 'own.er/name', 'owner/.hidden', 'owner/-flag',
      'owner/na me', 'owner/name;rm -rf /', 'owner/$(id)', 'owner/name\nother',
      'git@github.com:owner/name', 'https://github.com/owner/name',
      `${'a'.repeat(40)}/name`, `owner/${'n'.repeat(101)}`
    ];
    for (const input of bad) {
      assert.strictEqual(setup.validateRepoName(input).valid, false, `${JSON.stringify(input)} should be rejected`);
    }
  });

  await test('builds the ssh remote from a validated name', () => {
    assert.strictEqual(setup.remoteUrlFor('someone/frame_art'), 'git@github.com:someone/frame_art.git');
  });

  await test('redacts credentials in an https origin', () => {
    assert.strictEqual(setup.redactRemoteUrl('https://user:secret@example.com/a/b.git'), 'https://example.com/a/b.git');
    assert.strictEqual(setup.redactRemoteUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  });

  // --- folder state -----------------------------------------------------------
  await test('a missing folder needs setup and can be connected', async () => {
    const parent = tempDir('missing');
    const inspection = await setup.inspectLibraryFolder(path.join(parent, 'frame_art'));
    assert.strictEqual(inspection.exists, false);
    assert.deepStrictEqual(setup.describeSetupState(inspection), { needsSetup: true, canConnect: true, reason: null });
  });

  await test('an empty folder needs setup and can be connected', async () => {
    const dir = tempDir('empty');
    const inspection = await setup.inspectLibraryFolder(dir);
    assert.deepStrictEqual(inspection.userFiles, []);
    assert.deepStrictEqual(setup.describeSetupState(inspection), { needsSetup: true, canConnect: true, reason: null });
  });

  await test('the startup skeleton counts as empty', async () => {
    const dir = tempDir('skeleton');
    makeSkeleton(dir);
    const inspection = await setup.inspectLibraryFolder(dir);
    assert.deepStrictEqual(inspection.userFiles, []);
    assert.deepStrictEqual(inspection.skeleton.sort(), ['library', 'metadata.json', 'originals', 'thumbs']);
    assert.strictEqual(setup.describeSetupState(inspection).canConnect, true);
  });

  await test('an existing repository never needs setup', async () => {
    const dir = tempDir('repo');
    git(['init', '-q'], dir);
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{"images":{"a.jpg":{}}}');
    const inspection = await setup.inspectLibraryFolder(dir);
    assert.strictEqual(inspection.isRepo, true);
    assert.deepStrictEqual(setup.describeSetupState(inspection), { needsSetup: false, canConnect: false, reason: null });
  });

  await test('a non-empty folder that is not a repository needs setup but cannot be connected', async () => {
    const dir = tempDir('userfiles');
    makeSkeleton(dir);
    fs.writeFileSync(path.join(dir, 'library', 'sunset.jpg'), 'image bytes');
    const inspection = await setup.inspectLibraryFolder(dir);
    assert.strictEqual(inspection.isRepo, false);
    assert.deepStrictEqual(inspection.userFiles, ['library/ (1 item)']);
    const state = setup.describeSetupState(inspection);
    assert.strictEqual(state.needsSetup, true);
    assert.strictEqual(state.canConnect, false);
    assert.ok(state.reason);
  });

  await test('metadata with images or tags, and any other file, are user files', async () => {
    const withImages = tempDir('meta-images');
    fs.writeFileSync(path.join(withImages, 'metadata.json'), JSON.stringify({ version: '1.0', images: { 'a.jpg': {} }, tags: [] }));
    assert.deepStrictEqual((await setup.inspectLibraryFolder(withImages)).userFiles, ['metadata.json']);

    const withTags = tempDir('meta-tags');
    fs.writeFileSync(path.join(withTags, 'metadata.json'), JSON.stringify({ version: '1.0', images: {}, tags: ['beach'] }));
    assert.deepStrictEqual((await setup.inspectLibraryFolder(withTags)).userFiles, ['metadata.json']);

    const broken = tempDir('meta-broken');
    fs.writeFileSync(path.join(broken, 'metadata.json'), '{not json');
    assert.deepStrictEqual((await setup.inspectLibraryFolder(broken)).userFiles, ['metadata.json']);

    const other = tempDir('other');
    fs.writeFileSync(path.join(other, 'notes.txt'), 'hello');
    fs.mkdirSync(path.join(other, 'photos'));
    assert.deepStrictEqual((await setup.inspectLibraryFolder(other)).userFiles.sort(), ['notes.txt', 'photos/']);
  });

  // --- refusal to overwrite ---------------------------------------------------
  await test('assertCanConnect refuses a repository and a non-empty folder', async () => {
    assert.throws(() => setup.assertCanConnect({ isRepo: true, userFiles: [], skeleton: [] }), e => e.code === 'ALREADY_REPO');
    assert.throws(() => setup.assertCanConnect({ isRepo: false, userFiles: ['a.jpg'], skeleton: [] }), e => e.code === 'FOLDER_NOT_EMPTY');
    assert.doesNotThrow(() => setup.assertCanConnect({ isRepo: false, userFiles: [], skeleton: ['library'] }));
  });

  await test('connectLibrary leaves a non-empty folder exactly as it was', async () => {
    const dir = tempDir('refuse-files');
    makeSkeleton(dir);
    fs.writeFileSync(path.join(dir, 'library', 'sunset.jpg'), 'image bytes');
    const before = fs.readdirSync(dir).sort();
    await assert.rejects(
      setup.connectLibrary({ frameArtPath: dir, remoteUrl: path.join(dir, 'nowhere.git'), remoteState: 'has_content' }),
      e => e.code === 'FOLDER_NOT_EMPTY'
    );
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), before);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'library', 'sunset.jpg'), 'utf8'), 'image bytes');
    assert.ok(fs.existsSync(path.join(dir, 'metadata.json')), 'skeleton metadata is not removed when refusing');
  });

  await test('connectLibrary leaves an existing repository untouched', async () => {
    const dir = tempDir('refuse-repo');
    git(['init', '-q'], dir);
    const configBefore = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    await assert.rejects(
      setup.connectLibrary({ frameArtPath: dir, remoteUrl: path.join(dir, 'nowhere.git'), remoteState: 'empty' }),
      e => e.code === 'ALREADY_REPO'
    );
    assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'), configBefore);
    assert.deepStrictEqual(fs.readdirSync(dir), ['.git']);
  });

  // --- git error states -------------------------------------------------------
  await test('git failures map to clear states', () => {
    const err = (stderr, extra = {}) => ({ stderr, ...extra });
    assert.strictEqual(setup.classifyGitError(err('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.')), 'no_access');
    assert.strictEqual(setup.classifyGitError(err('ERROR: Repository not found.\nfatal: Could not read from remote repository.')), 'not_found');
    assert.strictEqual(setup.classifyGitError(err('ERROR: The key you are authenticating with has been marked as read only.')), 'read_only');
    assert.strictEqual(setup.classifyGitError(err('ssh: Could not resolve hostname ssh.github.com: Name does not resolve')), 'network');
    assert.strictEqual(setup.classifyGitError(err('', { timedOut: true })), 'network');
    assert.strictEqual(setup.classifyGitError(err('fatal: something else')), 'error');
  });

  // --- end to end against local bare repositories -----------------------------
  if (!hasGitLfs()) {
    skip('checkRemote and connectLibrary against local repositories', 'git-lfs not installed');
  } else {
    const root = tempDir('e2e');
    const remote = path.join(root, 'remote.git');
    git(['init', '-q', '--bare', remote], root);

    await test('checkRemote reports a missing repository', async () => {
      const result = await setup.checkRemote(path.join(root, 'missing.git'));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.state, 'not_found');
    });

    await test('checkRemote reports an empty repository', async () => {
      const result = await setup.checkRemote(remote);
      assert.strictEqual(result.ok, true, result.detail);
      assert.strictEqual(result.state, 'empty');
    });

    await test('connecting an empty repository starts a new library and pushes it', async () => {
      const dir = path.join(root, 'first');
      fs.mkdirSync(dir);
      makeSkeleton(dir);
      const steps = [];
      const result = await setup.connectLibrary({ frameArtPath: dir, remoteUrl: remote, remoteState: 'empty', onStep: s => steps.push(s) });
      assert.strictEqual(result.action, 'initialized');
      assert.ok(steps.length > 0);
      assert.strictEqual(git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
      assert.strictEqual(git(['remote', 'get-url', 'origin'], dir), remote);
      assert.strictEqual(git(['status', '--porcelain'], dir), '');
      const files = git(['ls-tree', '--name-only', 'main'], remote).split('\n').sort();
      assert.deepStrictEqual(files, ['.gitattributes', 'metadata.json']);
      assert.strictEqual(git(['show', 'main:.gitattributes'], remote), setup.GITATTRIBUTES.trim());
      assert.ok(git(['config', '--get', 'user.email'], dir), 'commit identity configured for later syncs');
      assert.strictEqual(git(['rev-parse', '--abbrev-ref', 'main@{upstream}'], dir), 'origin/main');
    });

    await test('checkRemote reports a repository with a library', async () => {
      const result = await setup.checkRemote(remote);
      assert.strictEqual(result.ok, true, result.detail);
      assert.strictEqual(result.state, 'has_content');
    });

    await test('connecting a repository with a library clones it', async () => {
      const dir = path.join(root, 'second');
      fs.mkdirSync(dir);
      makeSkeleton(dir);
      const result = await setup.connectLibrary({ frameArtPath: dir, remoteUrl: remote, remoteState: 'has_content' });
      assert.strictEqual(result.action, 'cloned');
      assert.strictEqual(git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
      assert.ok(fs.existsSync(path.join(dir, '.gitattributes')));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')).images, {});
      assert.ok(git(['config', '--get', 'user.email'], dir));
    });

    await test('connecting into a folder that does not exist yet clones it', async () => {
      const dir = path.join(root, 'third', 'frame_art');
      const result = await setup.connectLibrary({ frameArtPath: dir, remoteUrl: remote, remoteState: 'has_content' });
      assert.strictEqual(result.action, 'cloned');
      assert.ok(fs.existsSync(path.join(dir, '.git')));
    });

    await test('a failed push leaves no repository behind, so setup can be retried', async () => {
      const dir = path.join(root, 'fourth');
      fs.mkdirSync(dir);
      makeSkeleton(dir);
      await assert.rejects(setup.connectLibrary({ frameArtPath: dir, remoteUrl: path.join(root, 'missing.git'), remoteState: 'empty' }));
      assert.ok(!fs.existsSync(path.join(dir, '.git')));
      assert.ok(!fs.existsSync(path.join(dir, '.gitattributes')));
      assert.strictEqual(setup.describeSetupState(await setup.inspectLibraryFolder(dir)).canConnect, true);
    });

    await test('a repository without a main branch is refused', async () => {
      const other = path.join(root, 'other.git');
      git(['init', '-q', '--bare', other], root);
      const work = path.join(root, 'other-work');
      fs.mkdirSync(work);
      git(['init', '-q'], work);
      git(['symbolic-ref', 'HEAD', 'refs/heads/master'], work);
      git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'x'], work);
      git(['push', '-q', other, 'master'], work);
      const result = await setup.checkRemote(other);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.state, 'no_main');
    });
  }

  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}\n`);
  if (failed > 0) process.exit(1);
}

run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
