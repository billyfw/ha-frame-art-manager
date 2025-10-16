const express = require('express');
const router = express.Router();
const GitHelper = require('../git_helper');

/**
 * GET /api/sync/status
 * Get current sync status including repo verification and unsynced file count
 */
router.get('/status', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Try to fetch from remote first to get latest commit info
    // If this fails (network down), continue anyway with local status
    try {
      await git.git.fetch('origin', 'main');
    } catch (fetchError) {
      console.warn('Could not fetch from remote (network may be down):', fetchError.message);
      // Continue with local status
    }
    
    // Get semantic sync status
    const semanticStatus = await git.getSemanticSyncStatus();
    const lastSync = await git.getLastSyncTime();
    const branchInfo = await git.getBranchInfo();
    
    res.json({
      success: true,
      status: {
        upload: semanticStatus.upload,
        download: semanticStatus.download,
        hasChanges: semanticStatus.hasChanges,
        branch: branchInfo.branch,
        isMainBranch: branchInfo.branch === 'main',
        lastSync: lastSync
      }
    });
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/sync/check
 * Check if we're behind remote and auto-pull if needed (for page load)
 * This is a lightweight endpoint designed to be called on every page load
 */
router.get('/check', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const result = await git.checkAndPullIfBehind();
    
    // Return the result directly - it has all the info we need
    res.json(result);
    
  } catch (error) {
    console.error('Sync check error:', error);
    res.status(500).json({ 
      success: false, 
      synced: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/sync/verify
 * Verify repo configuration (Git, LFS, remote, branch)
 */
router.post('/verify', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const verification = await git.verifyConfiguration();
    
    res.json({
      success: verification.isValid,
      verification
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/sync/pull
 * Manual pull from remote (includes LFS files)
 */
router.post('/pull', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Pull latest changes
    const pullResult = await git.pullLatest();
    
    if (!pullResult.success) {
      // Log the pull failure
      await logSyncOperation(req.frameArtPath, {
        operation: 'pull',
        status: 'failure',
        message: pullResult.error,
        hasConflicts: pullResult.hasConflicts
      });
      
      return res.status(pullResult.hasConflicts ? 409 : 500).json({
        success: false,
        error: pullResult.error,
        hasConflicts: pullResult.hasConflicts
      });
    }
    
    // Log successful pull
    await logSyncOperation(req.frameArtPath, {
      operation: 'pull',
      status: 'success',
      message: pullResult.message
    });
    
    res.json({
      success: true,
      message: pullResult.message,
      summary: pullResult.summary
    });
  } catch (error) {
    console.error('Pull error:', error);
    await logSyncOperation(req.frameArtPath, {
      operation: 'pull',
      status: 'failure',
      message: error.message
    });
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/sync/push
 * Manual push to remote (commits uncommitted changes first, then pushes)
 */
router.post('/push', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Check if there's anything to sync
    const status = await git.getStatus();
    const hasUncommittedChanges = status.files.length > 0;
    const hasUnpushedCommits = status.ahead > 0;
    
    if (!hasUncommittedChanges && !hasUnpushedCommits) {
      return res.json({
        success: true,
        message: 'Nothing to push - already in sync'
      });
    }
    
    // If there are uncommitted changes, commit them first
    if (hasUncommittedChanges) {
      console.log(`Committing ${status.files.length} uncommitted file(s)...`);
      console.log('Files to commit:', status.files);
      const commitResult = await git.autoCommitAndPush(
        `Sync: Auto-commit ${status.files.length} file(s) from manual sync`
      );
      
      console.log('autoCommitAndPush result:', JSON.stringify(commitResult, null, 2));
      
      if (!commitResult.success) {
        await logSyncOperation(req.frameArtPath, {
          operation: 'push',
          status: 'failure',
          message: `Commit failed: ${commitResult.error}`
        });
        
        return res.status(500).json({
          success: false,
          error: `Commit failed: ${commitResult.error}`
        });
      }
      
      console.log('✅ Auto-commit successful - committed:', commitResult.committed, 'pushed:', commitResult.pushed);
      
      // autoCommitAndPush already pushed, so we're done
      await logSyncOperation(req.frameArtPath, {
        operation: 'push',
        status: 'success',
        message: 'Successfully committed and pushed changes'
      });
      
      return res.json({
        success: true,
        message: 'Successfully committed and pushed changes'
      });
    }
    
    // Only push if there are unpushed commits (but no uncommitted files)
    if (hasUnpushedCommits) {
      const pushResult = await git.pushChanges();
    
      if (!pushResult.success) {
        await logSyncOperation(req.frameArtPath, {
          operation: 'push',
          status: 'failure',
          message: pushResult.error
        });
        
        return res.status(500).json({
          success: false,
          error: pushResult.error
        });
      }
      
      // Log successful push
      await logSyncOperation(req.frameArtPath, {
        operation: 'push',
        status: 'success',
        message: pushResult.message
      });
      
      return res.json({
        success: true,
        message: pushResult.message
      });
    }
  } catch (error) {
    console.error('Push error:', error);
    await logSyncOperation(req.frameArtPath, {
      operation: 'push',
      status: 'failure',
      message: error.message
    });
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/sync/logs
 * Get sync operation logs
 */
router.get('/logs', async (req, res) => {
  try {
    const logs = await getSyncLogs(req.frameArtPath);
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * DELETE /api/sync/logs
 * Clear sync logs
 */
router.delete('/logs', async (req, res) => {
  try {
    await clearSyncLogs(req.frameArtPath);
    res.json({
      success: true,
      message: 'Sync logs cleared'
    });
  } catch (error) {
    console.error('Clear logs error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Helper: Log sync operation to sync_logs.json
 * Stores logs in the app directory, not the art library
 */
async function logSyncOperation(frameArtPath, logEntry) {
  const fs = require('fs').promises;
  const path = require('path');
  // Store logs in app directory, not in the art library
  const logsPath = path.join(__dirname, '..', 'sync_logs.json');
  
  try {
    // Read existing logs
    let logs = [];
    try {
      const data = await fs.readFile(logsPath, 'utf8');
      logs = JSON.parse(data);
    } catch {
      // File doesn't exist yet, start with empty array
    }
    
    // Add new log entry
    logs.unshift({
      timestamp: new Date().toISOString(),
      operation: logEntry.operation,
      status: logEntry.status,
      message: logEntry.message,
      error: logEntry.error || null,
      hasConflicts: logEntry.hasConflicts || false,
      files: logEntry.files || []
    });
    
    // Keep only last 100 entries
    logs = logs.slice(0, 100);
    
    // Write back
    await fs.writeFile(logsPath, JSON.stringify(logs, null, 2));
  } catch (error) {
    console.error('Failed to log sync operation:', error);
  }
}

/**
 * Helper: Get sync logs
 */
async function getSyncLogs(frameArtPath) {
  const fs = require('fs').promises;
  const path = require('path');
  // Read logs from app directory
  const logsPath = path.join(__dirname, '..', 'sync_logs.json');
  
  try {
    const data = await fs.readFile(logsPath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Helper: Clear sync logs
 */
async function clearSyncLogs(frameArtPath) {
  const fs = require('fs').promises;
  const path = require('path');
  // Clear logs in app directory
  const logsPath = path.join(__dirname, '..', 'sync_logs.json');
  
  try {
    await fs.writeFile(logsPath, JSON.stringify([], null, 2));
  } catch (error) {
    console.error('Failed to clear sync logs:', error);
    throw error;
  }
}

module.exports = router;
