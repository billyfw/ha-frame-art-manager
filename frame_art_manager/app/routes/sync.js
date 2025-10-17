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
    
    // Check for conflicts first
    const conflictCheck = await git.checkForConflicts();
    
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
        lastSync: lastSync,
        hasConflicts: conflictCheck.hasConflicts,
        conflictType: conflictCheck.conflictType,
        conflictedFiles: conflictCheck.conflictedFiles
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
 * POST /api/sync/full
 * Complete sync operation: commit → pull → push (atomic, holds lock for entire operation)
 * This prevents race conditions from multiple sequential API calls
 */
router.post('/full', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`\n🔵 [${requestId}] /api/sync/full request received`);
  
  // Acquire sync lock for the entire operation
  if (!await GitHelper.acquireSyncLock()) {
    console.log(`⛔ [${requestId}] Sync lock already held, rejecting request`);
    return res.status(409).json({
      success: false,
      error: 'Another sync operation is already in progress. Please wait and try again.',
      syncInProgress: true
    });
  }

  console.log(`✅ [${requestId}] Sync lock acquired successfully`);

  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Step 1: Commit any uncommitted changes
    console.log(`📝 [${requestId}] Step 1: Checking for uncommitted changes...`);
    const status = await git.getStatus();
    const hasUncommittedChanges = status.files.length > 0;
    console.log(`   [${requestId}] Uncommitted changes: ${hasUncommittedChanges ? 'YES (' + status.files.length + ' files)' : 'NO'}`);
    
    if (hasUncommittedChanges) {
      console.log(`   [${requestId}] Committing ${status.files.length} uncommitted file(s)...`);
      const commitMessage = await git.generateCommitMessage(status.files);
      console.log(`   [${requestId}] Commit message: ${commitMessage}`);
      
      const commitResult = await git.commitChanges(commitMessage);
      
      if (!commitResult.success) {
        console.log(`❌ [${requestId}] Commit failed: ${commitResult.error}`);
        await logSyncOperation(req.frameArtPath, {
          operation: 'full-sync',
          status: 'failure',
          message: `Commit failed: ${commitResult.error}`
        });
        
        return res.status(500).json({
          success: false,
          error: `Commit failed: ${commitResult.error}`
        });
      }
      
      console.log(`   [${requestId}] ✅ Commit successful`);
    } else {
      console.log(`   [${requestId}] No uncommitted changes to commit`);
    }
    
    // Step 2: Pull from remote (now that changes are committed)
    console.log(`⬇️  [${requestId}] Step 2: Pulling from remote...`);
    const pullResult = await git.pullLatest();
    
    if (!pullResult.success) {
      console.log(`❌ [${requestId}] Pull failed: ${pullResult.error}`);
      
      // Enhanced conflict logging
      if (pullResult.hasConflicts) {
        console.log(`⚠️  [${requestId}] CONFLICT DETECTED: ${pullResult.conflictType} conflict`);
        if (pullResult.conflictedFiles) {
          console.log(`   [${requestId}] Conflicted files:`, pullResult.conflictedFiles);
        }
      }
      
      await logSyncOperation(req.frameArtPath, {
        operation: 'full-sync',
        status: 'failure',
        message: `Pull failed: ${pullResult.error}`,
        hasConflicts: pullResult.hasConflicts,
        conflictType: pullResult.conflictType,
        conflictedFiles: pullResult.conflictedFiles
      });
      
      return res.status(pullResult.hasConflicts ? 409 : 500).json({
        success: false,
        error: pullResult.error,
        hasConflicts: pullResult.hasConflicts,
        conflictType: pullResult.conflictType,
        conflictedFiles: pullResult.conflictedFiles,
        message: pullResult.hasConflicts 
          ? `Sync conflict detected. Please resolve conflicts in the Sync tab.`
          : undefined
      });
    }
    
    console.log(`   [${requestId}] ✅ Pull successful`);
    
    // Step 3: Push to remote
    console.log(`⬆️  [${requestId}] Step 3: Pushing to remote...`);
    const pushResult = await git.pushChanges();
    
    if (!pushResult.success) {
      console.log(`❌ [${requestId}] Push failed: ${pushResult.error}`);
      await logSyncOperation(req.frameArtPath, {
        operation: 'full-sync',
        status: 'failure',
        message: `Push failed: ${pushResult.error}`
      });
      
      return res.status(500).json({
        success: false,
        error: pushResult.error
      });
    }
    
    console.log(`   [${requestId}] ✅ Push successful`);
    
    // Log successful full sync
    await logSyncOperation(req.frameArtPath, {
      operation: 'full-sync',
      status: 'success',
      message: 'Successfully completed full sync (commit → pull → push)'
    });
    
    console.log(`🎉 [${requestId}] Full sync completed successfully\n`);
    
    res.json({
      success: true,
      message: 'Successfully completed full sync',
      committed: hasUncommittedChanges
    });
    
  } catch (error) {
    console.error(`💥 [${requestId}] Full sync error:`, error);
    await logSyncOperation(req.frameArtPath, {
      operation: 'full-sync',
      status: 'failure',
      message: error.message
    });
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    // Always release the lock
    console.log(`🔓 [${requestId}] Releasing sync lock\n`);
    GitHelper.releaseSyncLock();
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
 * GET /api/sync/git-status
 * Get detailed git status for diagnostics
 */
router.get('/git-status', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const status = await git.getStatus();
    const branchInfo = await git.getBranchInfo();
    
    // Get last commit info
    let lastCommit = null;
    try {
      const log = await git.git.log({ maxCount: 1 });
      if (log.latest) {
        // Get the full commit message including body
        const fullMessage = log.latest.body ? 
          `${log.latest.message}\n\n${log.latest.body}` : 
          log.latest.message;
        
        lastCommit = {
          hash: log.latest.hash.substring(0, 7),
          message: fullMessage,
          date: log.latest.date,
          author: log.latest.author_name
        };
      }
    } catch (logError) {
      console.warn('Could not get commit log:', logError.message);
    }
    
    // Check for conflicts
    const hasConflicts = status.conflicted && status.conflicted.length > 0;
    
    res.json({
      success: true,
      gitStatus: {
        branch: branchInfo.branch,
        isMainBranch: branchInfo.branch === 'main',
        ahead: status.ahead,
        behind: status.behind,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        renamed: status.renamed,
        conflicted: status.conflicted || [],
        staged: status.staged,
        hasConflicts,
        lastCommit
      }
    });
  } catch (error) {
    console.error('Git status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/sync/abort-merge
 * Abort an in-progress merge or rebase
 */
router.post('/abort-merge', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Try to abort merge first
    try {
      await git.git.raw(['merge', '--abort']);
      await logSyncOperation(req.frameArtPath, {
        operation: 'abort-merge',
        status: 'success',
        message: 'Successfully aborted merge'
      });
      return res.json({
        success: true,
        message: 'Successfully aborted merge'
      });
    } catch (mergeError) {
      // If merge abort failed, try rebase abort
      try {
        await git.git.raw(['rebase', '--abort']);
        await logSyncOperation(req.frameArtPath, {
          operation: 'abort-rebase',
          status: 'success',
          message: 'Successfully aborted rebase'
        });
        return res.json({
          success: true,
          message: 'Successfully aborted rebase'
        });
      } catch (rebaseError) {
        throw new Error('No merge or rebase in progress');
      }
    }
  } catch (error) {
    console.error('Abort merge error:', error);
    await logSyncOperation(req.frameArtPath, {
      operation: 'abort-merge',
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
 * POST /api/sync/reset-to-remote
 * Hard reset to remote origin/main (DESTRUCTIVE)
 */
router.post('/reset-to-remote', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    
    // Fetch first to ensure we have latest remote state
    await git.git.fetch('origin', 'main');
    
    // Hard reset to origin/main
    await git.git.reset(['--hard', 'origin/main']);
    
    // Clean untracked files
    await git.git.clean('f', ['-d']);
    
    await logSyncOperation(req.frameArtPath, {
      operation: 'reset-to-remote',
      status: 'success',
      message: 'Successfully reset to remote state'
    });
    
    res.json({
      success: true,
      message: 'Successfully reset to remote state'
    });
  } catch (error) {
    console.error('Reset to remote error:', error);
    await logSyncOperation(req.frameArtPath, {
      operation: 'reset-to-remote',
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
 * GET /api/sync/conflicts
 * Get detailed conflict information
 */
router.get('/conflicts', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const conflictDetails = await git.getConflictDetails();
    
    res.json({
      success: true,
      ...conflictDetails
    });
  } catch (error) {
    console.error('Get conflicts error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/sync/abort-rebase
 * Abort an in-progress rebase
 */
router.post('/abort-rebase', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const result = await git.abortRebase();
    
    if (result.success) {
      await logSyncOperation(req.frameArtPath, {
        operation: 'abort-rebase',
        status: 'success',
        message: result.message
      });
      
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Abort rebase error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/sync/reset-to-remote
 * Reset repository to match remote exactly (USE WITH CAUTION)
 * This discards all local changes and unpushed commits
 */
router.post('/reset-to-remote', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const result = await git.resetToRemote();
    
    if (result.success) {
      await logSyncOperation(req.frameArtPath, {
        operation: 'reset-to-remote',
        status: 'success',
        message: result.message
      });
      
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Reset to remote error:', error);
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
