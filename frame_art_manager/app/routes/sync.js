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
    
    // Get comprehensive status
    const status = await git.getStatus();
    const lastSync = await git.getLastSyncTime();
    const branchInfo = await git.getBranchInfo();
    
    res.json({
      success: true,
      status: {
        unsynced: status.unsynced,
        unsyncedCount: status.files.length + status.ahead,
        ahead: status.ahead,
        behind: status.behind,
        modifiedFiles: status.modified,
        createdFiles: status.created,
        deletedFiles: status.deleted,
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
 * Manual push to remote (if needed)
 */
router.post('/push', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Check if there's anything to push
    const status = await git.getStatus();
    if (!status.unsynced && status.ahead === 0) {
      return res.json({
        success: true,
        message: 'Nothing to push - already in sync'
      });
    }
    
    // Push changes
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
    
    res.json({
      success: true,
      message: pushResult.message
    });
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
 */
async function logSyncOperation(frameArtPath, logEntry) {
  const fs = require('fs').promises;
  const path = require('path');
  const logsPath = path.join(frameArtPath, 'sync_logs.json');
  
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
  const logsPath = path.join(frameArtPath, 'sync_logs.json');
  
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
  const logsPath = path.join(frameArtPath, 'sync_logs.json');
  
  try {
    await fs.writeFile(logsPath, JSON.stringify([], null, 2));
  } catch (error) {
    console.error('Failed to clear sync logs:', error);
    throw error;
  }
}

module.exports = router;
