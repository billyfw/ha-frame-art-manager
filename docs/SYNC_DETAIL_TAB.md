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

### 2. **Conflict Detection & Resolution** ✅
- Automatically detects merge/rebase conflicts
- Shows warning box with list of conflicted files
- One-click "Abort Merge/Rebase" button to safely cancel conflicts
- Returns repository to previous clean state

**API Endpoint:** `POST /api/sync/abort-merge`

### 3. **Sync History/Logs** ✅  
- Displays last 100 sync operations
- Color-coded status:
  - Green border: Success
  - Red border: Failure  
  - Orange border: Warning
- Shows for each log entry:
  - Operation type (pull, push, commit, etc.)
  - Timestamp (relative: "5 minutes ago")
  - Message
  - Error details (if failed)
- Refresh and Clear buttons

**API Endpoints:**
- `GET /api/sync/logs` - Retrieve logs
- `DELETE /api/sync/logs` - Clear all logs

### 4. **Recovery Actions** ✅

#### Force Pull (Discard Local)
- Discards all local uncommitted changes
- Resets to remote `origin/main` state
- Cleans untracked files
- **Warning:** Requires confirmation

#### Reset to Remote (DESTRUCTIVE)
- Hard reset to remote state
- **Double confirmation required** (must type "RESET")
- Nuclear option for when everything is broken
- Immediately reloads gallery after reset

**API Endpoint:** `POST /api/sync/reset-to-remote`

## File Changes

### Backend
1. **`routes/sync.js`**
   - Added `GET /api/sync/git-status` endpoint
   - Added `POST /api/sync/abort-merge` endpoint  
   - Added `POST /api/sync/reset-to-remote` endpoint

### Frontend
2. **`public/index.html`**
   - Added "Sync Detail" tab button (already existed)
   - Added sync detail content sections (already existed)

3. **`public/css/style.css`**
   - Sync log styling (already existed)
   - Git status grid layout (already existed)
   - File status icons and badges (already existed)

4. **`public/js/app.js`**
   - `initSyncDetail()` - Initialize event listeners
   - `loadSyncStatus()` - Fetch and display git status
   - `loadSyncLogs()` - Fetch and display sync logs
   - `clearSyncLogs()` - Clear log history
   - `abortConflict()` - Abort merge/rebase
   - `forcePull()` - Force pull from remote
   - `resetToRemote()` - Hard reset to remote
   - Helper functions for formatting

## User Experience

### Normal State
```
Git Status
├─ Branch: main
├─ Sync Status: ✓ Clean
└─ Last Commit: a67e0d4 - Load UI before background sync

Uncommitted Files: (none)

Sync History
├─ push - success - 5 minutes ago
└─ pull - success - 1 hour ago
```

### Error State with Conflict
```
⚠️ Merge Conflict Detected
The following files have conflicts:
  • metadata.json

[Abort Merge/Rebase] ← One-click fix

Git Status  
├─ Branch: main
├─ Sync Status: ⚠ Conflicts
└─ Conflicted Files: metadata.json
```

### Diverged State
```
Git Status
├─ Branch: main  
├─ Sync Status: ↑ 1 ahead ↓ 1 behind
└─ Last Commit: 5155c3b - Remove test6 tag

Uncommitted Files:
  M metadata.json

Recovery Actions:
[📥 Force Pull (Discard Local)] [⚠️ Reset to Remote]
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
4. Check sync logs
5. Test recovery actions (be careful with destructive operations!)

## Safety Features

- All destructive operations require confirmation
- Reset to Remote requires typing "RESET" to confirm
- All operations are logged
- Errors are displayed clearly to user
- Gallery automatically reloads after major changes

## API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync/git-status` | GET | Get detailed Git status |
| `/api/sync/logs` | GET | Retrieve sync logs |
| `/api/sync/logs` | DELETE | Clear sync logs |
| `/api/sync/abort-merge` | POST | Abort merge/rebase |
| `/api/sync/reset-to-remote` | POST | Hard reset to remote |

---

**Status:** Phase 1 Complete ✅  
**Date:** October 16, 2025
