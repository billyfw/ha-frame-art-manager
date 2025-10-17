# Sync Detail Tab - Phase 1 Implementation

## Overview
Added a comprehensive "Sync Detail" tab to the Advanced settings page to help users diagnose and recover from sync errors.

## Features Implemented

### 1. **Git Status Viewer** ✅
Shows real-time Git repository status including:
- Current branch name with warning if not on `main`
- Commits ahead/behind remote
- Clean/dirty working tree status  
- Visual badges for sync state (ahead↑, behind↓, conflicts⚠)
- Last commit hash and message
- List of uncommitted files with status icons:
  - `M` - Modified (orange)
  - `+` - Added/New (green)
  - `−` - Deleted (red)
  - `→` - Renamed (blue)

**API Endpoint:** `GET /api/sync/git-status`

### 2. **Automatic Conflict Handling** ✅
- Detects merge/rebase conflicts during pulls
- Automatically resolves them by keeping the cloud (remote) version
- Prevents the repository from remaining in a conflicted state
- Captures discarded local changes for user-facing notifications

### 3. **Automatic Change Summaries** ✅
- When conflicts occur, the backend records which local changes were discarded during the sync attempt
- Summaries surface in the UI as real-time alerts so users know what was lost
- Data is returned in the sync API response and not persisted to disk; users can rely on Git history for longer-term audits

## File Changes

### Backend
1. **`routes/sync.js`**
   - Added `GET /api/sync/git-status` endpoint
  - Integrated automatic conflict-resolution support for `/api/sync/full`

### Frontend
2. **`public/index.html`**
   - Added "Sync Detail" tab button (already existed)
   - Added sync detail content sections (already existed)

3. **`public/css/style.css`**
   - Sync log styling (already existed)
   - Git status grid layout (already existed)
   - File status icons and badges (already existed)

4. **`public/js/app.js`**
  - `initSyncDetail()` - Initialize Sync tab data
  - `loadSyncStatus()` - Fetch and display git status
  - Helper functions for formatting and notifications

## User Experience

### Normal State
```
Git Status
├─ Branch: main
├─ Sync Status: ✓ Clean
└─ Last Commit: a67e0d4 - Load UI before background sync

Uncommitted Files: (none)
```

### Conflict Detected (Auto-Resolved)
```
⚠️ Conflict Detected During Pull
• Local metadata tag updates conflicted with cloud changes

Action Taken Automatically:
• Kept cloud version
• Alerted user with human-readable summary of discarded local changes

Repository returns to a clean state without user intervention.
```

### Diverged State
```
Git Status
├─ Branch: main  
├─ Sync Status: ↑ 1 ahead ↓ 1 behind
└─ Last Commit: 5155c3b - Remove test6 tag

Uncommitted Files:
  M metadata.json

Conflicts:
Automatically resolved using cloud version; discarded changes listed in alert.
```

## Code Improvements

### Pull with Rebase
Updated `git_helper.js` `pullLatest()` to use `--rebase`:
```javascript
const pullResult = await this.git.pull('origin', 'main', {'--rebase': 'true'});
```

**Benefits:**
- Cleaner linear history
- Fewer merge conflicts
- Better for automated sync workflow

**Correct Workflow for Rebase:**
The manual sync button now follows the proper Git rebase workflow:
1. **Commit** (stage and commit any uncommitted changes, but don't push yet)
2. **Pull with rebase** (fetch and rebase your commits on top of remote changes)
3. **Push** (send everything to remote)

This three-step process ensures:
- You can't push if you're behind (step 2 pulls first)
- You can't pull with unstaged changes (step 1 commits first)
- Your commits are always rebased on top of the latest remote state
- The push includes both your original commits and any rebased commits

**Visual Example:**

Before sync (you're behind remote AND have uncommitted changes):
```
Remote:  A---B---C---D (origin/main)
Local:   A---B---C (HEAD)
             uncommitted: metadata.json modified
```

After Step 1 (Commit):
```
Remote:  A---B---C---D (origin/main)
Local:   A---B---C---E (HEAD) "your commit"
```

After Step 2 (Pull with rebase):
```
Remote:  A---B---C---D (origin/main)
Local:   A---B---C---D---E' (HEAD) "your commit rebased"
```

After Step 3 (Push):
```
Remote:  A---B---C---D---E' (origin/main)
Local:   A---B---C---D---E' (HEAD)
             ✅ In sync!
```

**Why This Matters:**
Without this workflow, you'd get merge commits:
```
Bad (merge):  A---B---C---E---M (merge commit)
                       \   /
                        D
                        
Good (rebase): A---B---C---D---E' (linear!)
```

**New API Endpoint:**
- `POST /api/sync/commit` - Commits changes without pushing (for the rebase workflow)

### Detailed Commit Messages  
Added `generateCommitMessage()` function to create descriptive commit messages:

**Before:**
```
Sync: Auto-commit 3 file(s) from manual sync
```

**After:**
```
Sync: 1 renamed, 1 modified

  renamed: image1baaa99x00-7a2e17fa.jpeg
  metadata: tag/property updates
```

## Next Steps (Phase 2 & 3)

### Phase 2 - Helpful Diagnostics
- [ ] Network connectivity test
- [ ] Git LFS status check
- [ ] Remote URL display
- [ ] Disk space available
- [ ] Git version info
- [ ] Last successful sync time

### Phase 3 - Advanced Tools
- [ ] Real-time sync progress monitor
- [ ] Stash/unstash changes
- [ ] View file diffs
- [ ] Export/import metadata backup
- [ ] Prune old LFS files
- [ ] Re-initialize repository (with safety checks)

## Testing

To test the Sync Detail tab:

1. Open Advanced Settings (gear icon ⚙)
2. Click "Sync Detail" tab
3. View current Git status
4. Trigger a sync with conflicting local changes to confirm the automatic alert shows discarded updates

## Safety Features

- Conflicts are resolved automatically to avoid destructive manual steps
- Discarded local changes are summarized and shown to the user immediately
- Errors are displayed clearly to user
- Gallery automatically reloads after major changes

## API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync/git-status` | GET | Get detailed Git status |
| `/api/sync/full` | POST | Commit → pull → push (auto conflict resolution) |

---

**Status:** Phase 1 Complete ✅  
**Date:** October 16, 2025
