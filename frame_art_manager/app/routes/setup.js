const express = require('express');
const router = express.Router();
const GitHelper = require('../git_helper');
const setup = require('../library_setup');

// The one connect job this process runs (clone or new library). Polled through
// GET /status, because a clone with LFS can outlast an ingress request.
let connectJob = null;

function publicJob(job) {
  if (!job) return null;
  const { repo, status, step, message, warning, action, startedAt, finishedAt } = job;
  return { repo, status, step, message, warning, action, startedAt, finishedAt };
}

// GET /api/setup/status - is the library folder connected, and what can setup do
router.get('/status', async (req, res) => {
  try {
    const inspection = await setup.inspectLibraryFolder(req.frameArtPath);
    const state = setup.describeSetupState(inspection);
    const keySource = setup.keySource();
    const origin = inspection.isRepo ? await setup.getOriginUrl(req.frameArtPath) : null;
    res.json({
      success: true,
      frameArtPath: req.frameArtPath,
      isRepo: inspection.isRepo,
      origin,
      repo: setup.repoNameFromUrl(origin),
      needsSetup: state.needsSetup,
      canConnect: state.canConnect,
      hasLocalFiles: state.hasLocalFiles,
      imageCount: inspection.imageCount,
      keySource,
      // Public half of the key the add-on generated; nothing else about keys leaves the server.
      publicKey: keySource === 'generated' ? await setup.readGeneratedPublicKey() : null,
      connectJob: publicJob(connectJob)
    });
  } catch (error) {
    console.error('Setup status failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/setup/test {repo} - can the key reach owner/name, and can this folder connect to it
router.post('/test', async (req, res) => {
  const validation = setup.validateRepoName(req.body && req.body.repo);
  if (!validation.valid) {
    return res.status(400).json({ success: false, state: 'invalid', message: validation.error });
  }
  try {
    const result = await setup.checkConnection(req.frameArtPath, setup.remoteUrlFor(validation.repo));
    res.json({ success: result.ok, repo: validation.repo, ...result });
  } catch (error) {
    console.error('Setup test failed:', error.message);
    res.status(500).json({ success: false, state: 'error', message: error.message });
  }
});

// POST /api/setup/connect {repo} - clone the repo, or start a new library in it
router.post('/connect', async (req, res) => {
  const validation = setup.validateRepoName(req.body && req.body.repo);
  if (!validation.valid) {
    return res.status(400).json({ success: false, state: 'invalid', message: validation.error });
  }
  const repo = validation.repo;
  const frameArtPath = req.frameArtPath;
  const locals = req.app.locals;

  if (!setup.beginSetup()) {
    return res.status(409).json({ success: false, message: 'Library setup is already running.' });
  }
  if (!await GitHelper.acquireSyncLock()) {
    setup.endSetup();
    return res.status(409).json({ success: false, message: 'A sync is running; try again in a moment.' });
  }
  let started = false;
  const release = () => {
    GitHelper.releaseSyncLock();
    setup.endSetup();
  };

  try {
    const remoteUrl = setup.remoteUrlFor(repo);
    const remote = await setup.checkConnection(frameArtPath, remoteUrl);
    if (!remote.ok) {
      const status = ['ALREADY_REPO', 'needs_empty_folder'].includes(remote.state) ? 409 : 400;
      return res.status(status).json({ success: false, repo, ...remote });
    }

    connectJob = { repo, status: 'running', step: 'Starting', startedAt: new Date().toISOString() };
    const job = connectJob;
    started = true;
    res.status(202).json({ success: true, repo, state: remote.state, connectJob: publicJob(job) });

    (async () => {
      try {
        const result = await setup.connectLibrary({
          frameArtPath,
          remoteUrl,
          remoteState: remote.state,
          onStep: (step) => {
            job.step = step;
            console.log(`Library setup (${repo}): ${step}`);
          }
        });
        release();
        job.step = 'Checking the library';
        // Same startup verification and folder init as a restart, so sync works now.
        if (typeof locals.onLibraryConnected === 'function') {
          await locals.onLibraryConnected();
        }
        Object.assign(job, {
          status: 'succeeded',
          step: 'Done',
          action: result.action,
          warning: result.warning || null,
          message: result.action === 'cloned'
            ? `Library downloaded from ${repo}.`
            : `New library created and pushed to ${repo}.`,
          finishedAt: new Date().toISOString()
        });
        console.log(`✅ Library setup: ${job.message}`);
      } catch (error) {
        release();
        console.error(`❌ Library setup failed (${repo}):`, error.message);
        Object.assign(job, {
          status: 'failed',
          message: error.stderr ? (error.stderr.trim().split('\n').slice(-4).join('\n') || error.message) : error.message,
          finishedAt: new Date().toISOString()
        });
        // Put back the folders the app expects, in case a failed clone removed them.
        if (typeof locals.initializeLibraryFolder === 'function') {
          await locals.initializeLibraryFolder().catch(() => {});
        }
      }
    })();
  } catch (error) {
    console.error('Setup connect failed:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  } finally {
    if (!started) release();
  }
});

// POST /api/setup/disconnect {mode: 'keep'|'clear'} - stop syncing with the repository
router.post('/disconnect', async (req, res) => {
  const mode = req.body && req.body.mode;
  if (!setup.beginSetup()) {
    return res.status(409).json({ success: false, message: 'Library setup is running; try again when it finishes.' });
  }
  if (!await GitHelper.acquireSyncLock()) {
    setup.endSetup();
    return res.status(409).json({ success: false, message: 'A sync is running; try again in a moment.' });
  }
  try {
    const repo = setup.repoNameFromUrl(await setup.getOriginUrl(req.frameArtPath));
    await setup.disconnectLibrary({ frameArtPath: req.frameArtPath, mode });
    connectJob = null;
    // Recreate the startup folders (and metadata.json) after a 'clear'.
    if (typeof req.app.locals.initializeLibraryFolder === 'function') {
      await req.app.locals.initializeLibraryFolder();
    }
    console.log(`Library disconnected from ${repo || 'its repository'} (${mode === 'clear' ? 'library files removed' : 'library files kept'})`);
    res.json({
      success: true,
      mode,
      message: mode === 'clear'
        ? `Disconnected from ${repo || 'the repository'} and emptied the library folder.`
        : `Disconnected from ${repo || 'the repository'}. The library stays here, without sync.`
    });
  } catch (error) {
    const known = { NOT_CONNECTED: 409, NOT_BACKED_UP: 409, INVALID_MODE: 400 };
    if (!known[error.code]) console.error('Library disconnect failed:', error.message);
    res.status(known[error.code] || 500).json({ success: false, state: error.code, message: error.message });
  } finally {
    GitHelper.releaseSyncLock();
    setup.endSetup();
  }
});

module.exports = router;
