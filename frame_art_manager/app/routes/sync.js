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
      
      return res.status(pullResult.hasConflicts ? 409 : (pullResult.isNetworkError ? 503 : 500)).json({
        success: false,
        error: pullResult.error,
        hasConflicts: pullResult.hasConflicts || false,
        conflictType: pullResult.conflictType,
        conflictedFiles: pullResult.conflictedFiles
      });
    }

    const autoResolvedConflict = Boolean(pullResult.autoResolvedConflict);
    const lostChangesSummary = pullResult.lostChangesSummary || [];
    const conflictType = pullResult.conflictType;
    const conflictedFiles = pullResult.conflictedFiles;

    if (autoResolvedConflict) {
      console.log(`⚠️  [${requestId}] Conflicts detected and automatically resolved using cloud version`);
      if (lostChangesSummary.length > 0) {
        console.log(`   [${requestId}] Local changes replaced:`, lostChangesSummary);
      }
    } else {
      console.log(`   [${requestId}] ✅ Pull successful`);
    }
    
    // Step 3: Push to remote
    console.log(`⬆️  [${requestId}] Step 3: Pushing to remote...`);
    const pushResult = await git.pushChanges();
    
    if (!pushResult.success) {
      console.log(`❌ [${requestId}] Push failed: ${pushResult.error}`);
      
      return res.status(500).json({
        success: false,
        error: pushResult.error
      });
    }
    
    console.log(`   [${requestId}] ✅ Push successful`);
    console.log(`🎉 [${requestId}] Full sync completed successfully\n`);
    
    res.json({
      success: true,
      message: autoResolvedConflict
        ? 'Conflicts detected during sync. Local changes were replaced with the cloud version.'
        : 'Successfully completed full sync',
      committed: hasUncommittedChanges,
      autoResolvedConflict,
      lostChangesSummary,
      conflictType,
      conflictedFiles
    });
    
  } catch (error) {
    console.error(`💥 [${requestId}] Full sync error:`, error);
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
 * GET /api/sync/git-status
 * Get detailed git status for diagnostics
 */
router.get('/git-status', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const status = await git.getStatus();
    const branchInfo = await git.getBranchInfo();
    
    // Get recent commits info (last 50)
    let recentCommits = [];
    try {
      const log = await git.git.log({ maxCount: 50 });
      if (log.all && log.all.length > 0) {
        recentCommits = log.all.map(commit => {
          // Get the full commit message including body
          const fullMessage = commit.body ? 
            `${commit.message}\n\n${commit.body}` : 
            commit.message;
          
          return {
            hash: commit.hash.substring(0, 7),
            message: fullMessage,
            date: commit.date,
            author: commit.author_name
          };
        });
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
        recentCommits
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
 * GET /api/sync/uncommitted-details
 * Get detailed description of uncommitted changes (parsed from metadata.json diff)
 */
router.get('/uncommitted-details', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    const status = await git.getStatus();
    
    let detailedChanges = [];
    
    // If metadata.json is modified, parse the diff to get detailed changes
    if (status.modified.includes('metadata.json')) {
      detailedChanges = await git.getMetadataChanges();
    }
    
    res.json({
      success: true,
      changes: detailedChanges,
      hasChanges: detailedChanges.length > 0
    });
  } catch (error) {
    console.error('Uncommitted details error:', error);
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

module.exports = router;
