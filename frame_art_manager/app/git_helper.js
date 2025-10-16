const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;

/**
 * GitHelper - Manages Git LFS operations for the Frame Art repository
 * Handles verification, pull, commit, push, and status tracking
 */
class GitHelper {
  constructor(frameArtPath) {
    this.frameArtPath = frameArtPath;
    this.git = simpleGit(frameArtPath);
    this.expectedRemote = 'billyfw/frame_art';
  }

  /**
   * Verify if the path is a Git repository
   * @returns {Promise<{isValid: boolean, error?: string}>}
   */
  async verifyGitRepo() {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        return { isValid: false, error: 'Path is not a Git repository' };
      }
      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Verify if the remote repository is the expected one (billyfw/frame_art)
   * @returns {Promise<{isValid: boolean, remote?: string, error?: string}>}
   */
  async verifyRemoteRepo() {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      
      if (!origin) {
        return { isValid: false, error: 'No origin remote configured' };
      }

      // Check if remote URL contains expected repo name
      const remoteUrl = origin.refs.fetch || origin.refs.push;
      const isValid = remoteUrl.includes(this.expectedRemote);

      return {
        isValid,
        remote: remoteUrl,
        error: isValid ? null : `Expected ${this.expectedRemote}, found ${remoteUrl}`
      };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Check if Git LFS is installed and configured
   * @returns {Promise<{isInstalled: boolean, error?: string}>}
   */
  async checkGitLFSInstalled() {
    try {
      // Check if git-lfs is installed by running git lfs version
      await this.git.raw(['lfs', 'version']);
      
      // Check if .gitattributes exists
      const gitAttributesPath = path.join(this.frameArtPath, '.gitattributes');
      try {
        await fs.access(gitAttributesPath);
        return { isInstalled: true };
      } catch {
        return { 
          isInstalled: false, 
          error: '.gitattributes file not found - LFS may not be configured' 
        };
      }
    } catch (error) {
      return { 
        isInstalled: false, 
        error: 'Git LFS not installed. Run: git lfs install' 
      };
    }
  }

  /**
   * Check if behind remote and auto-pull if needed
   * This is the main sync logic used by both startup and page load
   * @returns {Promise<{success: boolean, synced: boolean, pulledChanges?: boolean, skipped?: boolean, reason?: string, error?: string}>}
   */
  async checkAndPullIfBehind() {
    try {
      // First verify git configuration
      const verification = await this.verifyConfiguration();
      if (!verification.isValid) {
        return {
          success: false,
          synced: false,
          error: 'Git configuration invalid',
          errors: verification.errors
        };
      }
      
      // Check if we have uncommitted local changes (before fetching)
      const statusBefore = await this.getStatus();
      if (statusBefore.files.length > 0) {
        // Don't auto-pull if there are local changes
        return {
          success: true,
          synced: false,
          skipped: true,
          reason: 'Uncommitted local changes detected',
          uncommittedFiles: statusBefore.files.map(f => f.path)
        };
      }
      
      // CRITICAL: Fetch from remote to get latest commit info
      if (process.env.NODE_ENV !== 'test') {
        console.log('Fetching from remote to check for updates...');
      }
      await this.git.fetch('origin', 'main');
      
      // Now check if we're behind remote (after fetch)
      const status = await this.getStatus();
      const behind = status.behind || 0;
      
      if (behind > 0) {
        // We're behind, attempt to pull
        if (process.env.NODE_ENV !== 'test') {
          console.log(`Behind remote by ${behind} commit${behind !== 1 ? 's' : ''}, pulling...`);
        }
        const pullResult = await this.pullLatest();
        
        if (pullResult.success) {
          return {
            success: true,
            synced: true,
            pulledChanges: true,
            commitsReceived: behind,
            message: `Pulled ${behind} commit${behind !== 1 ? 's' : ''} from remote`
          };
        } else {
          return {
            success: false,
            synced: false,
            error: pullResult.error,
            hasConflicts: pullResult.hasConflicts
          };
        }
      }
      
      // Already up to date
      return {
        success: true,
        synced: true,
        pulledChanges: false,
        message: 'Already up to date'
      };
      
    } catch (error) {
      return {
        success: false,
        synced: false,
        error: error.message
      };
    }
  }

  /**
   * Pull latest changes from remote
   * @returns {Promise<{success: boolean, summary?: object, error?: string}>}
   */
  async pullLatest() {
    try {
      // Pull with LFS
      const pullResult = await this.git.pull('origin', 'main');
      
      // Also pull LFS files explicitly
      await this.git.raw(['lfs', 'pull']);

      return {
        success: true,
        summary: pullResult,
        message: 'Successfully pulled latest changes'
      };
    } catch (error) {
      // Check if it's a merge conflict
      const hasConflicts = error.message.includes('conflict') || 
                          error.message.includes('CONFLICT') ||
                          error.message.includes('Merge conflict');
      
      return {
        success: false,
        error: error.message,
        hasConflicts
      };
    }
  }

  /**
   * Commit changes with a descriptive message
   * @param {string} message - Commit message
   * @param {string[]} files - Array of file paths to commit
   * @returns {Promise<{success: boolean, commit?: string, error?: string}>}
   */
  async commitChanges(message, files) {
    try {
      // Add files
      if (files && files.length > 0) {
        await this.git.add(files);
      } else {
        await this.git.add('.');
      }

      // Commit
      const commitResult = await this.git.commit(message);

      return {
        success: true,
        commit: commitResult.commit,
        message: `Committed: ${message}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Push changes to remote
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async pushChanges() {
    try {
      await this.git.push('origin', 'main');
      return {
        success: true,
        message: 'Successfully pushed changes to remote'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current repository status (modified, staged, unsynced files)
   * @returns {Promise<{files: object[], modified: string[], staged: string[], unsynced: boolean}>}
   */
  async getStatus() {
    try {
      const status = await this.git.status();
      
      return {
        files: status.files,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        ahead: status.ahead,
        behind: status.behind,
        unsynced: status.ahead > 0 || status.files.length > 0
      };
    } catch (error) {
      throw new Error(`Failed to get status: ${error.message}`);
    }
  }

  /**
   * Parse file list to extract semantic image counts (ignoring thumbnails and metadata)
   * Handles renames as a single operation, not as delete + add
   * @param {Array} files - Array of file paths or file objects
   * @param {Array} newImageFiles - Array of new image file paths to check against
   * @returns {Object} - {newImages: number, modifiedImages: number, deletedImages: number, renamedImages: number}
   */
  parseImageChanges(files, newImageFiles = []) {
    let newImages = 0;
    let modifiedImages = 0;
    let deletedImages = 0;
    let renamedImages = 0;
    
    // Check if metadata.json is modified (indicates image metadata changes like tags)
    const metadataFile = files.find(file => {
      const filePath = file.path || file;
      return filePath === 'metadata.json';
    });
    
    if (metadataFile) {
      const indexStatus = metadataFile.index || '';
      const workingDirStatus = metadataFile.working_dir || '';
      const status = indexStatus !== ' ' ? indexStatus : workingDirStatus;
      
      // Only count as modified if it's M (modified), not A (added) or D (deleted)
      if (status === 'M') {
        modifiedImages++;
      }
    }
    
    // Filter to only library files (ignore thumbs)
    const imageFiles = files.filter(file => {
      const filePath = file.path || file;
      return filePath.startsWith('library/') && 
             !filePath.startsWith('thumbs/');
    });
    
    // Categorize each image file
    imageFiles.forEach(file => {
      const filePath = file.path || file;
      // Check both index and working_dir status
      const indexStatus = file.index || '';
      const workingDirStatus = file.working_dir || '';
      const status = indexStatus !== ' ' ? indexStatus : workingDirStatus;
      
      // Check if this is a rename (R or R100 for 100% similarity)
      // Note: git shows renames as 'R' in the index when staged
      if (status === 'R' || status.startsWith('R')) {
        renamedImages++;
      }
      // Check if this is a new file (added) or if it's in the newImageFiles list
      else if (status === 'A' || status === '?' || newImageFiles.includes(filePath)) {
        newImages++;
      } 
      // Check if deleted
      else if (status === 'D') {
        deletedImages++;
      } 
      // Otherwise it's modified
      else if (status === 'M') {
        modifiedImages++;
      }
    });
    
    return { newImages, modifiedImages, deletedImages, renamedImages };
  }

  /**
   * Get semantic sync status with upload/download counts
   * @returns {Promise<Object>}
   */
  async getSemanticSyncStatus() {
    try {
      const status = await this.git.status();
      
      // Parse local uncommitted changes
      const localChanges = this.parseImageChanges(status.files);
      
      // Get list of new image files from local changes (for cross-referencing with commits)
      const newImageFiles = status.files
        .filter(file => {
          const filePath = file.path || file;
          const fileStatus = file.working_dir || file.index;
          return (fileStatus === 'A' || fileStatus === '?') && 
                 filePath.startsWith('library/') && 
                 !filePath.startsWith('thumbs/');
        })
        .map(file => file.path || file);
      
      // Parse unpushed commits (ahead)
      let unpushedChanges = { newImages: 0, modifiedImages: 0, deletedImages: 0, renamedImages: 0 };
      if (status.ahead > 0) {
        try {
          // Get diff of commits ahead
          const log = await this.git.log({
            from: status.tracking,
            to: 'HEAD'
          });
          
          // Collect all files from these commits
          const commitFiles = [];
          for (const commit of log.all) {
            const diff = await this.git.show([commit.hash, '--name-status', '--format=']);
            const lines = diff.split('\n').filter(line => line.trim());
            lines.forEach(line => {
              const [statusCode, ...pathParts] = line.split('\t');
              const path = pathParts.join('\t');
              if (path) {
                commitFiles.push({ path, status: statusCode });
              }
            });
          }
          
          unpushedChanges = this.parseImageChanges(commitFiles, newImageFiles);
        } catch (err) {
          console.error('Error parsing unpushed commits:', err);
        }
      }
      
      // Parse unpulled commits (behind)
      let unpulledChanges = { newImages: 0, modifiedImages: 0, deletedImages: 0, renamedImages: 0 };
      if (status.behind > 0) {
        try {
          // Get diff of commits behind
          const log = await this.git.log({
            from: 'HEAD',
            to: status.tracking
          });
          
          // Collect all files from these commits
          const commitFiles = [];
          for (const commit of log.all) {
            const diff = await this.git.show([commit.hash, '--name-status', '--format=']);
            const lines = diff.split('\n').filter(line => line.trim());
            lines.forEach(line => {
              const [statusCode, ...pathParts] = line.split('\t');
              const path = pathParts.join('\t');
              if (path) {
                commitFiles.push({ path, status: statusCode });
              }
            });
          }
          
          unpulledChanges = this.parseImageChanges(commitFiles);
        } catch (err) {
          console.error('Error parsing unpulled commits:', err);
        }
      }
      
      // Combine upload counts (local + unpushed)
      // Count renames as 1 change each, not 2
      const uploadCount = localChanges.newImages + localChanges.modifiedImages + localChanges.deletedImages + localChanges.renamedImages +
                         unpushedChanges.newImages + unpushedChanges.modifiedImages + unpushedChanges.deletedImages + unpushedChanges.renamedImages;
      
      const downloadCount = unpulledChanges.newImages + unpulledChanges.modifiedImages + unpulledChanges.deletedImages + unpulledChanges.renamedImages;
      
      return {
        upload: {
          count: uploadCount,
          newImages: localChanges.newImages + unpushedChanges.newImages,
          modifiedImages: localChanges.modifiedImages + unpushedChanges.modifiedImages,
          deletedImages: localChanges.deletedImages + unpushedChanges.deletedImages,
          renamedImages: localChanges.renamedImages + unpushedChanges.renamedImages
        },
        download: {
          count: downloadCount,
          newImages: unpulledChanges.newImages,
          modifiedImages: unpulledChanges.modifiedImages,
          deletedImages: unpulledChanges.deletedImages,
          renamedImages: unpulledChanges.renamedImages
        },
        hasChanges: uploadCount > 0 || downloadCount > 0
      };
    } catch (error) {
      throw new Error(`Failed to get semantic sync status: ${error.message}`);
    }
  }

  /**
   * Get timestamp of last successful push
   * @returns {Promise<{timestamp: string, commit: string}>}
   */
  async getLastSyncTime() {
    try {
      const log = await this.git.log({ maxCount: 1 });
      if (log.latest) {
        return {
          timestamp: log.latest.date,
          commit: log.latest.hash,
          message: log.latest.message
        };
      }
      return null;
    } catch (error) {
      throw new Error(`Failed to get last sync time: ${error.message}`);
    }
  }

  /**
   * Get current branch and ahead/behind status
   * @returns {Promise<{branch: string, ahead: number, behind: number}>}
   */
  async getBranchInfo() {
    try {
      const status = await this.git.status();
      return {
        branch: status.current,
        ahead: status.ahead,
        behind: status.behind,
        tracking: status.tracking
      };
    } catch (error) {
      throw new Error(`Failed to get branch info: ${error.message}`);
    }
  }

  /**
   * Verify all Git/LFS configuration is correct
   * @returns {Promise<{isValid: boolean, checks: object, errors: string[]}>}
   */
  async verifyConfiguration() {
    const checks = {};
    const errors = [];

    // Check if it's a Git repo
    const repoCheck = await this.verifyGitRepo();
    checks.isGitRepo = repoCheck.isValid;
    if (!repoCheck.isValid) errors.push(repoCheck.error);

    // Check remote
    const remoteCheck = await this.verifyRemoteRepo();
    checks.isCorrectRemote = remoteCheck.isValid;
    checks.remoteUrl = remoteCheck.remote;
    if (!remoteCheck.isValid) errors.push(remoteCheck.error);

    // Check Git LFS
    const lfsCheck = await this.checkGitLFSInstalled();
    checks.isLFSConfigured = lfsCheck.isInstalled;
    if (!lfsCheck.isInstalled) errors.push(lfsCheck.error);

    // Check branch
    try {
      const branchInfo = await this.getBranchInfo();
      checks.currentBranch = branchInfo.branch;
      checks.isMainBranch = branchInfo.branch === 'main';
      if (branchInfo.branch !== 'main') {
        errors.push(`Not on main branch (currently on: ${branchInfo.branch})`);
      }
    } catch (error) {
      checks.isMainBranch = false;
      errors.push('Could not determine current branch');
    }

    return {
      isValid: errors.length === 0,
      checks,
      errors
    };
  }

  /**
   * Auto-commit and push changes
   * @param {string} message - Commit message
   * @param {string[]} files - Files to commit
   * @returns {Promise<{success: boolean, committed: boolean, pushed: boolean, error?: string}>}
   */
  async autoCommitAndPush(message, files) {
    const result = {
      success: false,
      committed: false,
      pushed: false
    };

    try {
      // First, check if there are any changes to commit
      const status = await this.getStatus();
      
      if (status.files.length === 0 && status.ahead === 0) {
        // Nothing to commit or push
        return {
          success: true,
          committed: false,
          pushed: false,
          message: 'No changes to sync'
        };
      }

      // Commit if there are local changes
      if (status.files.length > 0) {
        const commitResult = await this.commitChanges(message, files);
        if (!commitResult.success) {
          result.error = `Commit failed: ${commitResult.error}`;
          return result;
        }
        result.committed = true;
      }

      // Push (includes any previously committed but unpushed changes)
      const pushResult = await this.pushChanges();
      if (!pushResult.success) {
        result.error = `Push failed: ${pushResult.error}`;
        return result;
      }
      result.pushed = true;
      result.success = true;

      return result;
    } catch (error) {
      result.error = error.message;
      return result;
    }
  }
}

module.exports = GitHelper;
