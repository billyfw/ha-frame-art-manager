const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();
const GitHelper = require('../git_helper');
const MetadataHelper = require('../metadata_helper');

const LFS_POINTER_SIGNATURE = 'version https://git-lfs.github.com/spec/v1';

function isNewFileStatus(file) {
  const indexStatus = file.index || '';
  const workingStatus = file.working_dir || '';
  return indexStatus === 'A' || workingStatus === 'A' || indexStatus === '?' || workingStatus === '?';
}

async function isGitLFSPointer(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (!bytesRead) {
      return false;
    }
    const header = buffer.slice(0, bytesRead).toString('utf8');
    return header.startsWith(LFS_POINTER_SIGNATURE);
  } catch (error) {
    return false;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function validateNewUploads(frameArtPath, statusFiles) {
  const errors = [];
  const imagesToCleanup = new Set();
  let checkedFiles = 0;

  for (const file of statusFiles) {
    const filePath = file.path || file;
    if (!filePath || (!filePath.startsWith('library/') && !filePath.startsWith('thumbs/'))) {
      continue;
    }

    if (!isNewFileStatus(file)) {
      continue;
    }

    checkedFiles++;
    const absolutePath = path.join(frameArtPath, filePath);
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.size === 0) {
        errors.push({
          file: filePath,
          reason: 'File is empty after upload.'
        });
        if (filePath.startsWith('library/')) {
          imagesToCleanup.add(path.basename(filePath));
        }
        continue;
      }

      if (filePath.startsWith('library/')) {
        const pointer = await isGitLFSPointer(absolutePath);
        if (pointer) {
          errors.push({
            file: filePath,
            reason: 'File appears to be a Git LFS pointer and was not hydrated.'
          });
          imagesToCleanup.add(path.basename(filePath));
        }
      }
    } catch (error) {
      errors.push({
        file: filePath,
        reason: `File could not be accessed: ${error.message}`
      });
      if (filePath.startsWith('library/')) {
        imagesToCleanup.add(path.basename(filePath));
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    imagesToCleanup: Array.from(imagesToCleanup),
    checkedFiles
  };
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to remove file ${filePath}:`, error.message);
    }
  }
}

async function cleanupFailedUploads(frameArtPath, imageFilenames) {
  if (!imageFilenames || imageFilenames.length === 0) {
    return;
  }

  const helper = new MetadataHelper(frameArtPath);

  for (const filename of imageFilenames) {
    await removeFileIfExists(path.join(frameArtPath, 'library', filename));
    await removeFileIfExists(path.join(frameArtPath, 'thumbs', `thumb_${filename}`));
    try {
      await helper.deleteImage(filename);
    } catch (error) {
      if (!error.message.includes('not found')) {
        console.warn(`Failed to remove metadata for ${filename}:`, error.message);
      }
    }
  }
}

/**
 * GET /api/sync/status
 * Get current sync status including repo verification and unsynced file count
 */
router.get('/status', async (req, res) => {
  try {
    const git = new GitHelper(req.frameArtPath);
    let syncBusy = false;
    
    // Check for and clear any stale Git lock files
    await git.checkAndClearStaleLock();
    
    // Check for conflicts first
    const conflictCheck = await git.checkForConflicts();
    
    // Try to fetch from remote first to get latest commit info (with retries)
    // If this fails (network down), continue anyway with local status
    try {
      const lockAcquired = await GitHelper.acquireSyncLock();
      if (!lockAcquired) {
        syncBusy = true;
      } else {
        try {
          await GitHelper.retryWithBackoff(
            () => git.git.fetch('origin', 'main'),
            3,
            2000,
            'git fetch'
          );
        } finally {
          GitHelper.releaseSyncLock();
        }
      }
    } catch (fetchError) {
      console.warn('Could not fetch from remote after retries (network may be down):', fetchError.message);
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
        conflictedFiles: conflictCheck.conflictedFiles,
        syncInProgress: syncBusy
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
  // console.log(`\n🔵 [${requestId}] /api/sync/full request received`);
  
  // Acquire sync lock for the entire operation
  if (!await GitHelper.acquireSyncLock()) {
    // console.log(`⛔ [${requestId}] Sync lock already held, rejecting request`);
    return res.status(409).json({
      success: false,
      error: 'Another sync operation is already in progress. Please wait and try again.',
      syncInProgress: true
    });
  }

  // console.log(`✅ [${requestId}] Sync lock acquired successfully`);

  let git = null;
  let branchName = 'unknown';
  let resolveHeadCommit = async () => null;

  try {
    git = new GitHelper(req.frameArtPath);
    
    // Check for and clear any stale Git lock files before starting
    // Feature: Auto-recovery from stale Git lock files (v1.22.2 + dfc7d24)
    const lockCheck = await git.checkAndClearStaleLock();
    if (lockCheck.cleared) {
      console.log(`🔓 [${requestId}] Cleared stale ${lockCheck.lockFile} before sync`);
    }
    resolveHeadCommit = async () => {
      if (!git) return null;
      try {
        return await git.git.revparse(['HEAD']);
      } catch (headError) {
        console.warn(`   [${requestId}] Could not determine HEAD commit:`, headError.message);
        return null;
      }
    };
    try {
      const branchInfo = await git.getBranchInfo();
      branchName = branchInfo?.branch || 'unknown';
    } catch (branchError) {
      console.warn(`   [${requestId}] Could not determine branch name:`, branchError.message);
    }
    
    // Step 1: Commit any uncommitted changes
    // console.log(`📝 [${requestId}] Step 1: Checking for uncommitted changes...`);
    const status = await git.getStatus();
    const hasUncommittedChanges = status.files.length > 0;
    // console.log(`   [${requestId}] Uncommitted changes: ${hasUncommittedChanges ? 'YES (' + status.files.length + ' files)' : 'NO'}`);
    
    // Capture what changes we're about to commit (in case they get lost in a conflict)
    let preCommitChangesSummary = [];
    if (hasUncommittedChanges) {
      const validationResult = await validateNewUploads(req.frameArtPath, status.files);

      if (!validationResult.valid && validationResult.checkedFiles > 0) {
        await cleanupFailedUploads(req.frameArtPath, validationResult.imagesToCleanup);

        const validationMessages = validationResult.errors.map(err => `${err.file}: ${err.reason}`);
        const validationSummary = validationMessages.join(' | ');
        const headCommit = await resolveHeadCommit();
        await logSyncOperation(req.frameArtPath, {
          operation: 'full-sync',
          status: 'failure',
          message: `Sync aborted - uploaded files failed validation: ${validationSummary}`,
          error: 'Upload validation failed',
          lostChanges: validationMessages,
          branch: branchName,
          remoteCommit: headCommit
        });

        return res.status(400).json({
          success: false,
          error: `Uploaded files failed validation and were removed: ${validationSummary}`,
          validationErrors: validationResult.errors,
          cleanedUpImages: validationResult.imagesToCleanup
        });
      }

      preCommitChangesSummary = await git.describeUncommittedChanges();
      // console.log(`   [${requestId}] Pre-commit changes captured:`, preCommitChangesSummary);
      // console.log(`   [${requestId}] Committing ${status.files.length} uncommitted file(s)...`);
      const commitMessage = await git.generateCommitMessage(status.files);
      // console.log(`   [${requestId}] Commit message: ${commitMessage}`);
      
      const commitResult = await git.commitChanges(commitMessage);
      
      if (!commitResult.success) {
        console.error(`❌ [${requestId}] Commit failed: ${commitResult.error}`);
        await logSyncOperation(req.frameArtPath, {
          operation: 'full-sync',
          status: 'failure',
          message: `Commit failed: ${commitResult.error}`,
          error: commitResult.error,
          branch: branchName,
          remoteCommit: await resolveHeadCommit(),
          lostChanges: []
        });
        
        return res.status(500).json({
          success: false,
          error: `Commit failed: ${commitResult.error}`
        });
      }
      
      // console.log(`   [${requestId}] ✅ Commit successful`);
    } else {
      // console.log(`   [${requestId}] No uncommitted changes to commit`);
    }
    
    // Step 2: Pull from remote (now that changes are committed)
    // console.log(`⬇️  [${requestId}] Step 2: Pulling from remote...`);
    const pullResult = await git.pullLatest(preCommitChangesSummary);
    const remoteChangesSummary = Array.isArray(pullResult.remoteChangesSummary) ? pullResult.remoteChangesSummary : [];
    
    if (!pullResult.success) {
      console.error(`❌ [${requestId}] Pull failed: ${pullResult.error}`);
      await logSyncOperation(req.frameArtPath, {
        operation: 'full-sync',
        status: 'failure',
        message: `Pull failed: ${pullResult.error}`,
        error: pullResult.error,
        hasConflicts: pullResult.hasConflicts || false,
        conflictType: pullResult.conflictType,
        conflictedFiles: pullResult.conflictedFiles || [],
        branch: branchName,
        remoteCommit: await resolveHeadCommit(),
        lostChanges: Array.isArray(pullResult.lostChangesSummary) ? pullResult.lostChangesSummary : [],
        remoteChanges: remoteChangesSummary
      });
      
      return res.status(pullResult.hasConflicts ? 409 : (pullResult.isNetworkError ? 503 : 500)).json({
        success: false,
        error: pullResult.error,
        hasConflicts: pullResult.hasConflicts || false,
        conflictType: pullResult.conflictType,
        conflictedFiles: pullResult.conflictedFiles,
        remoteChangesSummary
      });
    }

    const autoResolvedConflict = Boolean(pullResult.autoResolvedConflict);
    const lostChangesSummary = Array.isArray(pullResult.lostChangesSummary) ? pullResult.lostChangesSummary : [];
    const conflictType = pullResult.conflictType || null;
    const conflictedFiles = Array.isArray(pullResult.conflictedFiles) ? pullResult.conflictedFiles : [];

    if (autoResolvedConflict) {
      console.log(`⚠️  [${requestId}] Conflicts detected and automatically resolved using cloud version`);
      if (lostChangesSummary.length > 0) {
        console.log(`   [${requestId}] Local changes replaced:`, lostChangesSummary);
      }
    } else {
      // console.log(`   [${requestId}] ✅ Pull successful`);
    }
    
    // Step 3: Push to remote
    // console.log(`⬆️  [${requestId}] Step 3: Pushing to remote...`);
    const pushResult = await git.pushChanges();
    
    if (!pushResult.success) {
      console.error(`❌ [${requestId}] Push failed: ${pushResult.error}`);
      await logSyncOperation(req.frameArtPath, {
        operation: 'full-sync',
        status: 'failure',
        message: `Push failed: ${pushResult.error}`,
        error: pushResult.error,
        branch: branchName,
        remoteCommit: await resolveHeadCommit(),
        lostChanges: []
      });
      
      return res.status(500).json({
        success: false,
        error: pushResult.error
      });
    }
    
    // console.log(`   [${requestId}] ✅ Push successful`);
    const headCommit = await resolveHeadCommit();
    await logSyncOperation(req.frameArtPath, {
      operation: 'full-sync',
      status: autoResolvedConflict ? 'warning' : 'success',
      message: autoResolvedConflict
        ? 'Conflicts detected during sync. Local changes were replaced with the cloud version.'
        : 'Successfully completed full sync (commit → pull → push)',
      hasConflicts: autoResolvedConflict,
      conflictType,
      conflictedFiles,
      lostChanges: lostChangesSummary,
      remoteChanges: remoteChangesSummary,
      branch: branchName,
      remoteCommit: headCommit
    });
    // console.log(`🎉 [${requestId}] Full sync completed successfully\n`);
    
    res.json({
      success: true,
      message: autoResolvedConflict
        ? 'Conflicts detected during sync. Local changes were replaced with the cloud version.'
        : 'Successfully completed full sync',
      committed: hasUncommittedChanges,
      autoResolvedConflict,
      lostChangesSummary,
      conflictType,
      conflictedFiles,
      remoteChangesSummary
    });
    
  } catch (error) {
    console.error(`💥 [${requestId}] Full sync error:`, error);
    
    // Check if this is a lock file error and try to recover with auto-retry
    if (GitHelper.isLockFileError(error) && git) {
      console.log(`🔒 [${requestId}] Lock file error detected, attempting recovery...`);
      const lockResult = await git.checkAndClearStaleLock();
      if (lockResult.cleared) {
        console.log(`🔄 [${requestId}] Stale lock cleared, auto-retrying sync...`);
        try {
          await logSyncOperation(req.frameArtPath, {
            operation: 'full-sync',
            status: 'recovery',
            message: `Cleared stale ${lockResult.lockFile} (was ${Math.round(lockResult.age / 1000)}s old), retrying...`,
            branch: branchName,
            remoteCommit: await resolveHeadCommit(),
            lostChanges: []
          });
        } catch (logError) {
          console.warn(`⚠️  [${requestId}] Failed to log recovery:`, logError.message);
        }
        
        // Release the current lock and re-acquire for retry
        GitHelper.releaseSyncLock();
        
        // Auto-retry the sync
        try {
          if (!await GitHelper.acquireSyncLock()) {
            return res.status(409).json({
              success: false,
              error: 'Could not re-acquire sync lock after recovery. Please try again.',
              syncInProgress: true
            });
          }
          
          const retryGit = new GitHelper(req.frameArtPath);
          const retryStatus = await retryGit.getStatus();
          const retryHasChanges = retryStatus.files.length > 0;
          
          if (retryHasChanges) {
            await retryGit.commitChanges();
          }
          
          const retryPull = await retryGit.pullLatest();
          if (!retryPull.success) {
            throw new Error(retryPull.error);
          }
          
          const retryPush = await retryGit.pushChanges();
          if (!retryPush.success) {
            throw new Error(retryPush.error);
          }
          
          console.log(`✅ [${requestId}] Auto-retry successful after lock recovery`);
          return res.json({
            success: true,
            message: 'Sync completed successfully (recovered from stale lock)',
            recoveredFromLock: true,
            committed: retryHasChanges,
            autoResolvedConflict: retryPull.autoResolvedConflict || false,
            lostChangesSummary: retryPull.lostChangesSummary || [],
            remoteChangesSummary: retryPull.remoteChangesSummary || []
          });
        } catch (retryError) {
          console.error(`💥 [${requestId}] Auto-retry failed:`, retryError.message);
          try {
            await logSyncOperation(req.frameArtPath, {
              operation: 'full-sync',
              status: 'failure',
              message: `Auto-retry after lock recovery failed: ${retryError.message}`,
              error: retryError.message,
              branch: branchName,
              remoteCommit: await resolveHeadCommit(),
              lostChanges: []
            });
          } catch (logError) {
            console.warn(`⚠️  [${requestId}] Failed to log retry error:`, logError.message);
          }
          return res.status(500).json({
            success: false,
            error: `Sync failed after lock recovery: ${retryError.message}`,
            recoveredFromLock: true
          });
        } finally {
          GitHelper.releaseSyncLock();
        }
      } else if (lockResult.lockFile) {
        // Lock exists but isn't stale enough
        const errorMessage = `Git lock file (${lockResult.lockFile}) is blocking the operation. ` +
          `It's only ${Math.round(lockResult.age / 1000)}s old, which may indicate another operation is in progress. Please wait and try again.`;
        try {
          await logSyncOperation(req.frameArtPath, {
            operation: 'full-sync',
            status: 'failure',
            message: errorMessage,
            error: errorMessage,
            branch: branchName,
            remoteCommit: await resolveHeadCommit(),
            lostChanges: []
          });
        } catch (logError) {
          console.warn(`⚠️  [${requestId}] Failed to log sync error:`, logError.message);
        }
        return res.status(500).json({
          success: false,
          error: errorMessage
        });
      }
    }
    
    // Non-lock error or no lock file found
    try {
      await logSyncOperation(req.frameArtPath, {
        operation: 'full-sync',
        status: 'failure',
        message: error.message,
        error: error.message,
        branch: branchName,
        remoteCommit: await resolveHeadCommit(),
        lostChanges: []
      });
    } catch (logError) {
      console.warn(`⚠️  [${requestId}] Failed to log sync error:`, logError.message);
    }
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    // Always release the lock
    // console.log(`🔓 [${requestId}] Releasing sync lock\n`);
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
    
    // Log check failures to sync logs so they appear in the Advanced page
    if (!result.success && result.error) {
      try {
        await logSyncOperation(req.frameArtPath, {
          operation: 'sync-check',
          status: 'failure',
          message: `Sync check failed: ${result.error}`,
          error: result.error,
          branch: 'main'
        });
      } catch (logError) {
        console.warn('Failed to log sync check error:', logError.message);
      }
    }
    
    // Return the result directly - it has all the info we need
    res.json(result);
    
  } catch (error) {
    console.error('Sync check error:', error);
    
    // Log the exception to sync logs
    try {
      await logSyncOperation(req.frameArtPath, {
        operation: 'sync-check',
        status: 'failure',
        message: `Sync check failed: ${error.message}`,
        error: error.message,
        branch: 'main'
      });
    } catch (logError) {
      console.warn('Failed to log sync check error:', logError.message);
    }
    
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
 * Retrieve recent sync operation logs with conflict summaries
 */
router.get('/logs', async (req, res) => {
  try {
    const logs = await getSyncLogs();
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Get sync logs error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/sync/logs
 * Clear stored sync logs
 */
router.delete('/logs', async (_req, res) => {
  try {
    await clearSyncLogs();
    res.json({
      success: true,
      message: 'Sync logs cleared'
    });
  } catch (error) {
    console.error('Clear sync logs error:', error);
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

const SYNC_LOG_PATH = path.join(__dirname, '..', 'sync_logs.json');
const SYNC_LOG_LIMIT = 200;

async function readSyncLogsFile() {
  try {
    const data = await fs.readFile(SYNC_LOG_PATH, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    console.warn('Failed to read sync logs, resetting file:', error.message);
    return [];
  }
}

async function writeSyncLogsFile(entries) {
  const payload = JSON.stringify(entries, null, 2);
  await fs.writeFile(SYNC_LOG_PATH, payload);
}

async function logSyncOperation(_frameArtPath, logEntry = {}) {
  try {
    const logs = await readSyncLogsFile();
    const entry = {
      timestamp: new Date().toISOString(),
      operation: logEntry.operation || 'full-sync',
      status: logEntry.status || 'info',
      message: logEntry.message || '',
      error: logEntry.error || null,
      hasConflicts: Boolean(logEntry.hasConflicts),
      conflictType: logEntry.conflictType || null,
      conflictedFiles: Array.isArray(logEntry.conflictedFiles) ? logEntry.conflictedFiles : [],
      lostChanges: Array.isArray(logEntry.lostChanges) ? logEntry.lostChanges : [],
      remoteChanges: Array.isArray(logEntry.remoteChanges) ? logEntry.remoteChanges : [],
      branch: logEntry.branch || 'unknown',
      remoteCommit: logEntry.remoteCommit || null
    };
    logs.unshift(entry);
    const trimmed = logs.slice(0, SYNC_LOG_LIMIT);
    await writeSyncLogsFile(trimmed);
  } catch (error) {
    console.warn('Failed to log sync operation:', error.message);
  }
}

async function getSyncLogs() {
  return readSyncLogsFile();
}

async function clearSyncLogs() {
  await writeSyncLogsFile([]);
}

module.exports = router;
