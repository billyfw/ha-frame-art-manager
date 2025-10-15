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
