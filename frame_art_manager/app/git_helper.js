const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;

// Global sync lock to prevent concurrent git operations
let syncInProgress = false;

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
   * Acquire sync lock - prevents concurrent git operations
   * Returns true if lock acquired, false if sync already in progress
   */
  static async acquireSyncLock() {
    if (syncInProgress) {
      console.log('⚠️  Sync already in progress, rejecting concurrent request');
      return false;
    }
    syncInProgress = true;
    console.log('🔒 Sync lock acquired');
    return true;
  }

  /**
   * Release sync lock
   */
  static releaseSyncLock() {
    syncInProgress = false;
    console.log('🔓 Sync lock released');
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
   * Pull latest changes from remote with autostash
   * Automatically stashes uncommitted changes before rebasing and reapplies them after
   * @returns {Promise<{success: boolean, summary?: object, error?: string, hasConflicts?: boolean, conflictType?: string}>}
   */
  async pullLatest() {
    try {
      // Pull with rebase and autostash to handle concurrent modifications
      // --autostash: Automatically stash uncommitted changes before rebase, then pop after
      // This prevents "cannot rebase: you have unstaged changes" errors
      const pullResult = await this.git.raw(['pull', '--rebase', '--autostash', 'origin', 'main']);
      
      // Also pull LFS files explicitly
      await this.git.raw(['lfs', 'pull']);

      // Check if we're in a conflict state after pull
      const conflictCheck = await this.checkForConflicts();
      if (conflictCheck.hasConflicts) {
        return {
          success: false,
          error: `${conflictCheck.conflictType} conflict detected`,
          hasConflicts: true,
          conflictType: conflictCheck.conflictType,
          conflictedFiles: conflictCheck.conflictedFiles
        };
      }

      return {
        success: true,
        summary: pullResult,
        message: 'Successfully pulled latest changes'
      };
    } catch (error) {
      // Check for network/connectivity issues first
      const isNetworkError = error.message.includes('Could not read from remote repository') ||
                            error.message.includes('unable to access') ||
                            error.message.includes('Failed to connect') ||
                            error.message.includes('Could not resolve host') ||
                            error.message.includes('Connection refused') ||
                            error.message.includes('Network is unreachable');
      
      if (isNetworkError) {
        return {
          success: false,
          error: 'Unable to reach remote repository. Changes saved locally but not synced. Check your network connection.',
          isNetworkError: true
        };
      }
      
      // Check if it's a merge/rebase conflict
      const hasConflicts = error.message.includes('conflict') || 
                          error.message.includes('CONFLICT') ||
                          error.message.includes('Merge conflict');
      
      // Try to determine conflict type
      let conflictType = 'unknown';
      if (error.message.includes('CONFLICT')) {
        if (error.message.includes('content')) {
          conflictType = 'rebase';
        } else if (error.message.includes('stash')) {
          conflictType = 'stash';
        }
      }
      
      return {
        success: false,
        error: error.message,
        hasConflicts,
        conflictType: hasConflicts ? conflictType : undefined
      };
    }
  }

  /**
   * Check if repository is in a conflict state
   * @returns {Promise<{hasConflicts: boolean, conflictType?: string, conflictedFiles?: string[]}>}
   */
  async checkForConflicts() {
    try {
      const status = await this.git.status();
      
      // Check for rebase in progress
      const rebaseInProgress = status.files.some(file => file.index === 'U' || file.working_dir === 'U');
      
      // Check for conflicted files
      const conflictedFiles = status.files
        .filter(file => file.index === 'U' || file.working_dir === 'U')
        .map(file => file.path);
      
      if (rebaseInProgress || conflictedFiles.length > 0) {
        return {
          hasConflicts: true,
          conflictType: 'rebase',
          conflictedFiles
        };
      }
      
      // Check if there are stash conflicts (git will leave files with conflict markers)
      // After autostash pop failure, files will show as modified with conflicts
      const filesWithConflicts = status.files.filter(file => 
        file.working_dir === 'M' && file.index === ' '
      );
      
      if (filesWithConflicts.length > 0) {
        // Check if any of these files have conflict markers
        for (const file of filesWithConflicts) {
          try {
            const content = await this.git.show(['HEAD:' + file.path]);
            const workingContent = await require('fs').promises.readFile(
              require('path').join(this.frameArtPath, file.path), 
              'utf-8'
            );
            
            // Check for conflict markers
            if (workingContent.includes('<<<<<<<') || 
                workingContent.includes('=======') || 
                workingContent.includes('>>>>>>>')) {
              return {
                hasConflicts: true,
                conflictType: 'stash',
                conflictedFiles: [file.path]
              };
            }
          } catch (err) {
            // Ignore errors reading files
          }
        }
      }
      
      return { hasConflicts: false };
    } catch (error) {
      console.error('Error checking for conflicts:', error);
      return { hasConflicts: false };
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
      // Check for network/connectivity issues
      const isNetworkError = error.message.includes('Could not read from remote repository') ||
                            error.message.includes('unable to access') ||
                            error.message.includes('Failed to connect') ||
                            error.message.includes('Could not resolve host') ||
                            error.message.includes('Connection refused') ||
                            error.message.includes('Network is unreachable');
      
      return {
        success: false,
        error: isNetworkError 
          ? 'Unable to reach remote repository. Changes saved locally but not synced. Check your network connection.'
          : error.message,
        isNetworkError
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
    
    // Filter to only library files (ignore thumbs and metadata.json)
    const imageFiles = files.filter(file => {
      const filePath = file.path || file;
      return filePath.startsWith('library/') && 
             !filePath.startsWith('thumbs/') &&
             filePath !== 'metadata.json';
    });
    
    // Categorize each image file
    imageFiles.forEach(file => {
      const filePath = file.path || file;
      // Check both index and working_dir status
      const indexStatus = file.index || '';
      const workingDirStatus = file.working_dir || '';
      const commitStatus = file.status || ''; // For commit diffs (from git show)
      // Prefer index status if present and not empty/space, otherwise use working_dir or status
      const status = (indexStatus && indexStatus !== ' ') ? indexStatus : (workingDirStatus || commitStatus);
      
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
    
    // Check if metadata.json is modified (indicates image metadata changes like tags)
    // Only count metadata changes if there are ONLY metadata changes (no image file operations)
    const metadataFile = files.find(file => {
      const filePath = file.path || file;
      return filePath === 'metadata.json';
    });
    
    if (metadataFile && imageFiles.length === 0) {
      const indexStatus = metadataFile.index || '';
      const workingDirStatus = metadataFile.working_dir || '';
      const commitStatus = metadataFile.status || ''; // For commit diffs (from git show)
      // Prefer index status if present and not empty/space, otherwise use working_dir or status
      const status = (indexStatus && indexStatus !== ' ') ? indexStatus : (workingDirStatus || commitStatus);
      
      // Only count as modified if it's M (modified), not A (added) or D (deleted)
      if (status === 'M') {
        modifiedImages++;
      }
    }
    
    return { newImages, modifiedImages, deletedImages, renamedImages };
  }

  /**
   * Generate a detailed commit message based on file changes
   * @param {Array} files - Array of file objects from git status
   * @returns {Promise<string>} - Detailed commit message with specific file changes
   */
  async generateCommitMessage(files) {
    const allDetails = [];
    
    // Get metadata changes if metadata.json was modified
    let metadataChanges = null;
    const metadataFile = files.find(file => {
      const filePath = file.path || file;
      return filePath === 'metadata.json';
    });
    
    if (metadataFile) {
      metadataChanges = await this.getMetadataChanges();
    }
    
    // Process image files
    const imageFiles = files.filter(file => {
      const filePath = file.path || file;
      return filePath.startsWith('library/') && !filePath.startsWith('thumbs/');
    });
    
    imageFiles.forEach(file => {
      const filePath = file.path || file;
      const fileName = filePath.split('/').pop();
      // Extract base name without UUID and extension
      const withoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
      const baseName = withoutExt.replace(/-[a-f0-9]+$/i, '');
      const indexStatus = file.index || '';
      const workingDirStatus = file.working_dir || '';
      const status = (indexStatus && indexStatus !== ' ') ? indexStatus : workingDirStatus;
      
      if (status === 'R' || status.startsWith('R')) {
        // Renamed file
        const from = file.from || 'unknown';
        const to = file.to || fileName;
        const fromName = from.split('/').pop();
        const toName = to.split('/').pop();
        const fromWithoutExt = fromName.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
        const toWithoutExt = toName.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
        const fromBase = fromWithoutExt.replace(/-[a-f0-9]+$/i, '');
        const toBase = toWithoutExt.replace(/-[a-f0-9]+$/i, '');
        allDetails.push(`renamed: ${fromBase} → ${toBase} (${fromName} → ${toName})`);
      } else if (status === 'A' || status === '?') {
        // New file
        allDetails.push(`added: ${baseName} (${fileName})`);
      } else if (status === 'D') {
        // Deleted file
        allDetails.push(`deleted: ${baseName} (${fileName})`);
      } else if (status === 'M') {
        // Modified file (binary change)
        allDetails.push(`modified: ${baseName} (${fileName})`);
      }
    });
    
    // Add metadata-only changes with details
    if (metadataChanges && metadataChanges.length > 0) {
      metadataChanges.forEach(change => {
        allDetails.push(change);
      });
    } else if (metadataFile && imageFiles.length === 0) {
      // Metadata changed but we couldn't determine what
      allDetails.push('metadata: property updates');
    }
    
    // Return everything on one line separated by --
    if (allDetails.length > 0) {
      return allDetails.join(' -- ');
    }
    
    return 'Sync: Auto-commit from manual sync';
  }

  /**
   * Detect what changed in metadata.json by comparing unstaged or staged changes
   * @returns {Promise<Array<string>>} - Array of change descriptions
   */
  async getMetadataChanges() {
    try {
      // First check working directory (unstaged changes)
      // Use -U10 to get 10 lines of context so we can see the image filename
      const workingDiff = await this.git.diff(['-U10', 'metadata.json']);
      
      console.log('Working diff length:', workingDiff ? workingDiff.length : 0);
      
      if (workingDiff) {
        const changes = this.parseMetadataDiff(workingDiff);
        console.log('Parsed changes from working diff:', changes);
        return changes;
      }
      
      // If no unstaged changes, check staged changes
      const cachedDiff = await this.git.diff(['-U10', '--cached', 'metadata.json']);
      
      console.log('Cached diff length:', cachedDiff ? cachedDiff.length : 0);
      
      if (cachedDiff) {
        const changes = this.parseMetadataDiff(cachedDiff);
        console.log('Parsed changes from cached diff:', changes);
        return changes;
      }
      
      console.log('No diff found for metadata.json');
      return [];
    } catch (error) {
      console.warn('Could not get metadata changes:', error.message);
      return [];
    }
  }

  /**
   * Parse metadata.json diff to extract meaningful changes
   * @param {string} diff - Git diff output
   * @returns {Array<string>} - Array of human-readable changes
   */
  parseMetadataDiff(diff) {
    const changes = [];
    const lines = diff.split('\n');
    
    let currentImage = null;
    let addedTags = [];
    let removedTags = [];
    let propertyChanges = [];
    let inTagsArray = false;
    let imageHasActualChanges = false; // Track if current image has real changes (+ or - lines)
    let inImagesSection = false; // Track if we're in the "images" section
    let hasSeenImagesSection = false; // Track if we've explicitly seen the "images" section header
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Detect when we enter the "images" section
      if (trimmed.match(/^"images"\s*:\s*\{/)) {
        inImagesSection = true;
        hasSeenImagesSection = true;
        continue;
      }
      
      // Detect when we exit the "images" section (entering "tvs" or "tags" section at root level)
      // We can tell it's root level if:
      // 1. We've seen the images section
      // 2. We see a closing brace for images: },
      // 3. Followed by "tvs" or "tags"
      if (hasSeenImagesSection && trimmed === '},') {
        // This might be the closing of the images section
        // Check if the next non-empty line is "tvs" or "tags"
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].trim();
          if (nextTrimmed === '') continue;
          if (nextTrimmed.match(/^"tvs"\s*:\s*\[/) || nextTrimmed.match(/^"tags"\s*:\s*\[/)) {
            // Save the last image's changes before leaving images section
            if (currentImage && imageHasActualChanges && 
                (addedTags.length > 0 || removedTags.length > 0 || propertyChanges.length > 0)) {
              changes.push(...this.formatImageChanges(currentImage, addedTags, removedTags, propertyChanges));
            }
            inImagesSection = false;
            currentImage = null;
          }
          break; // Only check the next non-empty line
        }
        continue;
      }
      
      // Detect which image is being modified - look for lines like: "book1-2a.jpg": {
      // Image names have pattern: quote, filename with extension, quote, colon, brace
      // Use trimmed line to handle any leading whitespace
      const imageMatch = trimmed.match(/^"([^"]+\.(jpg|jpeg|png|gif|webp))"\s*:\s*\{/i);
      if (imageMatch) {
        // If we haven't seen the "images" section header yet, assume we're in it
        // (for partial diffs that don't include the full JSON structure)
        if (!hasSeenImagesSection) {
          inImagesSection = true;
        }
        
        // Only process if we're in the images section
        if (!inImagesSection) {
          continue;
        }
        
        // Save previous image changes if it had ACTUAL changes (not just context lines)
        if (currentImage && imageHasActualChanges && 
            (addedTags.length > 0 || removedTags.length > 0 || propertyChanges.length > 0)) {
          changes.push(...this.formatImageChanges(currentImage, addedTags, removedTags, propertyChanges));
        }
        
        currentImage = imageMatch[1];
        addedTags = [];
        removedTags = [];
        propertyChanges = [];
        inTagsArray = false;
        imageHasActualChanges = false; // Reset for new image
        continue;
      }
      
      // Track when we're in the tags array (within an image entry)
      // Only process if we have a current image set
      if (currentImage && line.includes('"tags"')) {
        inTagsArray = true;
      }
      
      // Detect tag changes within the tags array
      // Only process if we have a current image set
      if (currentImage && inTagsArray) {
        // Look for removed tags: lines starting with - and containing a quoted string
        if (line.match(/^\s*-\s*"([^"]+)"/)) {
          imageHasActualChanges = true; // Mark that this image has real changes
          const match = line.match(/"([^"]+)"/);
          if (match && match[1] !== 'tags') {
            removedTags.push(match[1]);
          }
        }
        // Look for added tags: lines starting with + and containing a quoted string
        else if (line.match(/^\s*\+\s*"([^"]+)"/)) {
          imageHasActualChanges = true; // Mark that this image has real changes
          const match = line.match(/"([^"]+)"/);
          if (match && match[1] !== 'tags') {
            addedTags.push(match[1]);
          }
        }
        
        // Exit tags array when we hit the closing bracket
        if (line.includes(']')) {
          inTagsArray = false;
        }
      }
      
      // Detect other property changes (matte, filter, etc.)
      // Check if line starts with - or + (after optional whitespace from diff)
      if (currentImage && !inTagsArray && (line.includes('"matte"') || line.includes('"filter"'))) {
        const startsWithDiffMarker = /^\s*[-+]/.test(line);
        if (startsWithDiffMarker) {
          imageHasActualChanges = true; // Mark that this image has real changes
          const match = line.match(/"([^"]+)":\s*"([^"]+)"/);
          if (match && match[1] !== 'updated') {
            propertyChanges.push(match[1]);
          }
        }
      }
    }
    
    // Don't forget the last image - but only if it had actual changes
    if (currentImage && imageHasActualChanges && 
        (addedTags.length > 0 || removedTags.length > 0 || propertyChanges.length > 0)) {
      changes.push(...this.formatImageChanges(currentImage, addedTags, removedTags, propertyChanges));
    }
    
    return changes;
  }

  /**
   * Format image changes into readable strings
   * @param {string} imageName - Name of the image file
   * @param {Array<string>} addedTags - Tags that were added
   * @param {Array<string>} removedTags - Tags that were removed
   * @param {Array<string>} propertyChanges - Properties that changed
   * @returns {Array<string>} - Formatted change descriptions
   */
  formatImageChanges(imageName, addedTags, removedTags, propertyChanges) {
    const changes = [];
    const fileName = imageName.split('/').pop();
    // Extract base name without UUID and extension
    // Remove extension first, then remove UUID (last hyphen and everything after)
    const withoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
    const baseName = withoutExt.replace(/-[a-f0-9]+$/i, '');
    
    // Filter out tags that appear in both added and removed (these are just comma changes)
    // Only tags that were truly added or removed should be reported
  const actuallyRemoved = removedTags.filter(tag => !addedTags.includes(tag));
  const actuallyAdded = addedTags.filter(tag => !removedTags.includes(tag));

  // Deduplicate tags to avoid reporting the same tag multiple times when
  // the diff contains duplicate + lines (can happen with unstable formatting)
  const uniqueRemoved = [...new Set(actuallyRemoved)];
  const uniqueAdded = [...new Set(actuallyAdded)];
    
    if (uniqueRemoved.length > 0) {
      changes.push(`  ${baseName}: removed tag${uniqueRemoved.length > 1 ? 's' : ''}: ${uniqueRemoved.join(', ')} (${fileName})`);
    }
    
    if (uniqueAdded.length > 0) {
      changes.push(`  ${baseName}: added tag${uniqueAdded.length > 1 ? 's' : ''}: ${uniqueAdded.join(', ')} (${fileName})`);
    }
    
    if (propertyChanges.length > 0) {
      const uniqueProps = [...new Set(propertyChanges)];
      changes.push(`  ${baseName}: updated ${uniqueProps.join(', ')} (${fileName})`);
    }
    
    return changes;
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
   * Abort rebase and return to pre-rebase state
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async abortRebase() {
    try {
      await this.git.rebase(['--abort']);
      return {
        success: true,
        message: 'Rebase aborted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Reset repository to match remote exactly (discards all local changes)
   * USE WITH CAUTION - this will lose all uncommitted and unpushed changes
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async resetToRemote() {
    try {
      // Fetch latest from remote
      await this.git.fetch('origin', 'main');
      
      // Abort any rebase in progress
      try {
        await this.git.rebase(['--abort']);
      } catch (err) {
        // Ignore if no rebase in progress
      }
      
      // Reset to remote state
      await this.git.reset(['--hard', 'origin/main']);
      
      // Clean any untracked files
      await this.git.clean('f', ['-d']);
      
      return {
        success: true,
        message: 'Repository reset to remote state'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get detailed conflict information
   * @returns {Promise<{hasConflicts: boolean, conflicts?: Array}>}
   */
  async getConflictDetails() {
    try {
      const conflictCheck = await this.checkForConflicts();
      
      if (!conflictCheck.hasConflicts) {
        return { hasConflicts: false };
      }
      
      const conflicts = [];
      
      for (const filePath of conflictCheck.conflictedFiles) {
        try {
          const fullPath = require('path').join(this.frameArtPath, filePath);
          const content = await require('fs').promises.readFile(fullPath, 'utf-8');
          
          // Extract conflict sections
          const conflictRegex = /<<<<<<< .*?\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> .*?\n/g;
          const matches = [...content.matchAll(conflictRegex)];
          
          conflicts.push({
            file: filePath,
            conflictCount: matches.length,
            hasConflictMarkers: matches.length > 0
          });
        } catch (err) {
          conflicts.push({
            file: filePath,
            error: 'Could not read file'
          });
        }
      }
      
      return {
        hasConflicts: true,
        conflictType: conflictCheck.conflictType,
        conflicts
      };
    } catch (error) {
      return {
        hasConflicts: false,
        error: error.message
      };
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
