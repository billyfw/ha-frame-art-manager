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
    res.json({
      success: true,
      frameArtPath: req.frameArtPath,
      isRepo: inspection.isRepo,
      origin: inspection.isRepo ? await setup.getOriginUrl(req.frameArtPath) : null,
      needsSetup: state.needsSetup,
      canConnect: state.canConnect,
      reason: state.reason,
      userFiles: inspection.userFiles.slice(0, 10),
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

// POST /api/setup/test {repo} - can the key reach owner/name, and is it empty
router.post('/test', async (req, res) => {
  const validation = setup.validateRepoName(req.body && req.body.repo);
  if (!validation.valid) {
    return res.status(400).json({ success: false, state: 'invalid', message: validation.error });
  }
  try {
    const result = await setup.checkRemote(setup.remoteUrlFor(validation.repo));
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
    const inspection = await setup.inspectLibraryFolder(frameArtPath);
    try {
      setup.assertCanConnect(inspection);
    } catch (error) {
      return res.status(409).json({ success: false, state: error.code, message: error.message });
    }

    const remoteUrl = setup.remoteUrlFor(repo);
    const remote = await setup.checkRemote(remoteUrl);
    if (!remote.ok) {
      return res.status(400).json({ success: false, repo, ...remote });
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

module.exports = router;
