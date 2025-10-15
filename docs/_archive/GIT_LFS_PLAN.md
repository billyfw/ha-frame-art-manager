# Git LFS Integration Plan - Review & Implementation Roadmap

**Status:** ✅ APPROVED - Ready to Implement  
**Created:** October 15, 2025  
**Last Updated:** October 15, 2025  
**Decisions Finalized:** October 15, 2025

---

## 🎯 **Core Requirements (From Original Proposal)**

### 1. **Repository Verification**
- ✅ Verify path points to `billyfw/frame_art` Git LFS repo
- ✅ Check on application load
- ✅ Check on path change (if FRAME_ART_PATH becomes configurable)
- ✅ Alert user if not the correct repo

### 2. **Sync UI Component**
- ✅ Add "Sync Cloud" button next to gear icon in gallery toolbar
- ✅ Trigger manual sync on demand
- ✅ Show sync status/progress

### 3. **Automatic Sync on Changes**
- ✅ Auto-commit on image upload
- ✅ Auto-commit on metadata changes (rename, tags, matte, filter)
- ✅ Auto-commit on image deletion
- ✅ Include descriptive commit messages noting "committed automatically from ha-frame-art-manager add-on"
- ✅ Auto-push changes to remote

### 4. **Sync Logging Tab**
- ✅ Add "Sync Logging" tab to Advanced section
- ✅ Display sync operation logs
- ✅ Show error messages if sync fails
- ✅ Timestamp each operation

### 5. **Unsynced Visual Indicators**
- ✅ Flag unsynced images with red border in gallery
- ✅ Track which images/metadata haven't been pushed
- ✅ Handle offline/no connection scenarios

---

## 📋 **Detailed Implementation Tasks**

### **A. Backend Infrastructure**

#### **A1. Git LFS Library Integration**
- [ ] Install `simple-git` npm package for Git operations
- [ ] Create `git_helper.js` module for Git LFS operations
- [ ] Implement methods:
  - `async verifyGitRepo()` - Check if path is a git repo
  - `async verifyRemoteRepo()` - Verify remote is `billyfw/frame_art`
  - `async checkGitLFSInstalled()` - Verify Git LFS is available
  - `async pullLatest()` - Pull latest changes from remote
  - `async commitChanges(message, files)` - Stage and commit specific files
  - `async pushChanges()` - Push to remote
  - `async getStatus()` - Get current repo status (modified, staged, unsynced)
  - `async getLastSyncTime()` - Get timestamp of last successful push
  - `async getBranchInfo()` - Get current branch and ahead/behind status

#### **A2. Sync State Tracking**
- [ ] Add to `metadata.json` schema:
  ```json
  {
    "sync": {
      "lastPull": "2025-10-15T10:30:00.000Z",
      "lastPush": "2025-10-15T10:32:00.000Z",
      "unsyncedImages": ["image1.jpg", "image2.jpg"],
      "pendingOperations": []
    }
  }
  ```
- [ ] Track unsynced changes per image
- [ ] Track metadata.json sync state separately

#### **A3. New API Endpoints**
- [ ] `GET /api/sync/status` - Get current sync status
  - Remote repo verification
  - Unsynced file count
  - Last sync times
  - Git repo health check
- [ ] `POST /api/sync/pull` - Manual pull from remote
  - Pull latest changes
  - Update local files
  - Return updated file list
- [ ] `POST /api/sync/push` - Manual push to remote (if needed)
  - Push all unsynced changes
  - Return success/failure
- [ ] `GET /api/sync/logs` - Get sync operation logs
  - Return recent sync operations with timestamps
  - Include success/error messages
- [ ] `POST /api/sync/verify` - Verify repo configuration
  - Check Git repo validity
  - Check Git LFS configuration
  - Check remote configuration

#### **A4. Background Sync Integration**
- [ ] Modify existing endpoints to trigger auto-commit/push:
  - `POST /api/images` (upload) → commit + push new image + metadata
  - `PUT /api/images/:filename` (update) → commit + push metadata
  - `POST /api/images/:filename/rename` → commit + push renamed files + metadata
  - `DELETE /api/images/:filename` → commit + push deletion + metadata
  - `POST /api/images/bulk-tag` → commit + push metadata
- [ ] Add commit message template: `"Auto-commit from ha-frame-art-manager: [operation] [files]"`
- [ ] Implement error handling for failed sync (mark as unsynced, continue operation)

#### **A5. Sync Logging System**
- [ ] Create `sync_logs.json` or append to metadata
- [ ] Log structure:
  ```json
  {
    "timestamp": "2025-10-15T10:30:00.000Z",
    "operation": "pull|push|commit",
    "status": "success|failure",
    "message": "Pulled 3 new images from remote",
    "error": null,
    "files": ["image1.jpg", "image2.jpg"]
  }
  ```
- [ ] Rotate logs (keep last 100 entries)

---

### **B. Frontend Implementation**

#### **B1. Gallery Toolbar Sync Button**
- [ ] Add "Sync Cloud" button next to gear icon (⚙️ → ☁️)
- [ ] Button states:
  - Default: "Sync Cloud" (blue)
  - Syncing: "Syncing..." (gray, disabled)
  - Error: "Sync Failed" (red)
  - Unsynced changes: Badge showing count (e.g., "3")
- [ ] Click handler:
  - Trigger pull operation
  - Show progress indicator
  - Update gallery if new images pulled
  - Show notification on completion

#### **B2. Sync Status Indicator**
- [ ] Add sync status to top-right toolbar area
- [ ] Display states:
  - ✅ "Synced" (green) - all up to date
  - ⚠️ "Unsynced (3)" (orange) - changes not pushed
  - ❌ "Offline" (red) - no connection
  - 🔄 "Syncing..." (blue) - operation in progress

#### **B3. Unsynced Image Visual Indicator**
- [ ] Add CSS class `image-unsynced` for red border
- [ ] Apply to gallery cards with unsynced status
- [ ] Add tooltip: "Not synced to cloud"
- [ ] Clear indicator after successful push

#### **B4. Sync Logging Tab (Advanced Section)**
- [ ] Add "Sync Logging" subtab to Advanced tab
- [ ] UI components:
  - Log viewer (scrollable list, newest first)
  - Auto-refresh toggle
  - Clear logs button
  - Export logs button
- [ ] Display format:
  ```
  [2025-10-15 10:30:00] ✅ PULL SUCCESS
  Pulled 3 new images from remote
  Files: image1.jpg, image2.jpg, image3.jpg
  
  [2025-10-15 10:28:00] ⚠️ PUSH FAILED
  Failed to push changes: Network error
  Error: connect ETIMEDOUT
  ```

#### **B5. Initial Repository Verification Alert**
- [ ] On page load, call `/api/sync/verify`
- [ ] If not `billyfw/frame_art` repo, show modal alert:
  - "Warning: Frame Art Path Not Configured Correctly"
  - "Expected: billyfw/frame_art Git LFS repository"
  - "Current: [detected path/repo]"
  - "Sync operations disabled until corrected"
- [ ] Disable sync button if repo invalid

---

### **C. Startup & Configuration**

#### **C1. Startup Verification Sequence**
1. [ ] Check if `FRAME_ART_PATH` is set
2. [ ] Check if path is a Git repository
3. [ ] Check if Git LFS is installed and configured
4. [ ] Check if remote is `billyfw/frame_art`
5. [ ] Check if credentials are configured (SSH keys or Git credentials)
6. [ ] Auto-pull latest on startup (configurable?)
7. [ ] Log startup verification results

#### **C2. Environment Variables**
- [ ] Add to `.env`:
  ```
  GIT_AUTO_PULL_ON_STARTUP=true
  GIT_AUTO_PUSH_ON_CHANGE=true
  GIT_SYNC_INTERVAL=0  # 0 = disabled, >0 = minutes
  GIT_COMMIT_USER_NAME="Frame Art Manager"
  GIT_COMMIT_USER_EMAIL="frame-art@homeassistant.local"
  ```

---

## 🤔 **Questions & Design Decisions**

### **Q1. Pull Strategy**
**Question:** Should we auto-pull on startup, or require manual pull?
- **Option A:** Auto-pull on every startup (ensures latest, but slower startup)
- **Option B:** Manual pull only (user controls when to sync)
- **Option C:** Auto-pull on startup + periodic background pulls (e.g., every 30 min)

**My Recommendation:** Option B (manual only) for now, with Option C as future enhancement.

**DECISION:** ✅ **Option A** - Auto-pull on startup
- **Addition:** Add tooltip to sync button showing "Last synced: X minutes ago" on hover

---

### **Q2. Conflict Resolution**
**Question:** What happens if pull conflicts with local changes?
- **Option A:** Reject pull, show error, require user to resolve manually
- **Option B:** Auto-stash local changes, pull, then pop stash
- **Option C:** Use "theirs" strategy (remote wins)

**My Recommendation:** Option A for safety, with clear error message and instructions.

**DECISION:** ✅ **Option A** - Reject pull and show error
- **Error Handling:** Display full-screen error state on gallery view (no images shown)
- **Error Title:** "Billy needs to examine and fix -- git pull had conflicts!"
- **Error Content:** Show logs/debugging information to help resolve the conflict
- **User Action:** Manual resolution required before gallery can be used again

---

### **Q3. Push Frequency**
**Question:** Should every change immediately push, or batch pushes?
- **Option A:** Immediate push on every change (safest, but high network usage)
- **Option B:** Debounced push (e.g., 30 seconds after last change)
- **Option C:** Manual push only after auto-commit

**My Recommendation:** Option A for simplicity and "always live" experience you described. Add Option B as setting for users with slow connections.

**DECISION:** ✅ **Option A** - Immediate push on every change
- Provides true "always live" experience
- Changes are immediately synced to cloud

---

### **Q4. Offline Handling**
**Question:** How should we handle offline/failed push scenarios?
- **Option A:** Queue operations, retry later automatically
- **Option B:** Mark as unsynced, require manual sync
- **Option C:** Show error, block further operations until synced

**My Recommendation:** Option B (mark unsynced, allow continued use), with automatic retry on next network activity.

**DECISION:** ✅ **Option B** - Mark as unsynced, allow continued use
- **Automatic Resolution:** Each new change triggers a push attempt that includes all prior unsynced changes
- If network comes back or issue resolves, subsequent operations will automatically sync everything
- Visual indicator (red border) shows which images are not yet synced

---

### **Q5. Git Authentication**
**Question:** How should users authenticate with GitHub?
- **Option A:** Assume SSH keys already configured on host system
- **Option B:** Support personal access tokens in config
- **Option C:** Add UI for credential configuration

**My Recommendation:** Option A initially (simplest for Home Assistant add-on context), document SSH key setup requirements.

**DECISION:** ✅ **Option A** - Assume SSH keys configured on host
- **Note:** SSH keys should already exist at user level on Home Assistant host
- **Add-on Setup:** Handle SSH key configuration automatically during add-on deployment OR ensure clear documentation
- **Documentation Priority:** Make SSH key setup easy and foolproof in deployment docs
- **Action Item:** Add to containerization/deployment planning documentation

---

### **Q6. Multi-User Scenarios**
**Question:** What if multiple Home Assistant instances edit the same repo?
- **Option A:** Treat as normal Git collaboration, handle merge conflicts
- **Option B:** Add locking mechanism (e.g., file-based lock)
- **Option C:** Warn users this is single-instance only

**My Recommendation:** Option A with Option C documentation (warn in README that concurrent editing requires Git knowledge).

**DECISION:** ✅ **Option A** - Treat as normal Git collaboration
- Our Q2 error handling (full-screen "Billy needs to examine and fix" error) covers conflict scenarios
- If multiple instances cause conflicts, the aggressive error state will catch it
- **Question from Billy:** Are there other failure modes not covered by Q2's conflict handling that we should plan for?

---

### **Q7. Metadata Sync Granularity**
**Question:** Should commit messages be specific or generic when committing metadata changes?
- **Option A:** Generic commit messages (e.g., "updated metadata")
- **Option B:** Batch metadata commits (e.g., every 5 minutes)
- **Option C:** Specific commit messages that describe what changed (e.g., "updated tags for image1.jpg")

**Note:** Options A and C have identical behavior (commit on every change), but differ in commit message detail.

**My Recommendation:** Option C for better Git history and debugging.

**DECISION:** ✅ **Option C** - Specific, descriptive commit messages
- Every metadata change commits + pushes immediately (aligns with Q3)
- Commit messages should describe the operation and affected images
- **Examples:**
  - `"Auto-commit from ha-frame-art-manager: uploaded image1.jpg"`
  - `"Auto-commit from ha-frame-art-manager: updated tags for image1.jpg"`
  - `"Auto-commit from ha-frame-art-manager: updated matte for image1.jpg"`
  - `"Auto-commit from ha-frame-art-manager: renamed image2.jpg to sunset.jpg"`
  - `"Auto-commit from ha-frame-art-manager: deleted image3.jpg"`
  - `"Auto-commit from ha-frame-art-manager: bulk tagged 5 images"`
- **Implementation Note:** Each API endpoint should construct a descriptive commit message based on the operation and affected files

---

### **Q8. Sync Status Persistence**
**Question:** Where should we track which files are unsynced?
- **Option A:** In `metadata.json` (simple, single source of truth)
- **Option B:** In separate `sync_state.json` (cleaner separation)
- **Option C:** Check Git status dynamically each time (no tracking needed)

**My Recommendation:** Option C with Option A fallback (use `git status`, but cache in metadata for performance).

**DECISION:** ✅ **Option C** - Use Git status dynamically (no fallback)
- Git is the source of truth for sync state
- Call `git status` when needed to determine unsynced files
- No additional tracking or caching needed initially
- Can optimize later if performance becomes an issue

---

### **Q9. Repository Branch**
**Question:** Should we enforce a specific branch (e.g., `main`)?
- **Option A:** Enforce `main` branch only
- **Option B:** Support any branch, show in UI
- **Option C:** Allow branch switching in UI

**My Recommendation:** Option A (enforce `main`) for simplicity and safety.

**DECISION:** ✅ **Option A** - Enforce `main` branch only
- System only works with `main` branch
- Simplifies implementation and reduces edge cases
- Safer for users unfamiliar with Git workflows

---

### **Q10. Sync Failure Recovery**
**Question:** If auto-push fails, how should we recover?
- **Option A:** Keep trying on every subsequent operation
- **Option B:** Exponential backoff retry (immediate, 1min, 5min, 30min)
- **Option C:** Only retry on manual sync button

**My Recommendation:** Option B (smart retry) with Option C fallback (manual sync always available).

**DECISION:** ✅ **Option A with Option C fallback** - Retry on every operation + manual sync
- Each new change/operation attempts to push all unsynced changes
- Manual "Sync Cloud" button is always available for user-initiated retry
- Simple, predictable behavior: every action tries to sync everything
- User can force sync at any time via manual button

---

## 💡 **Additional Suggestions (Not in Original Proposal)**

### **S1. Sync Settings Tab**
- Add "Sync Settings" section to Advanced tab:
  - Toggle auto-pull on startup
  - Toggle auto-push on change
  - Set push debounce delay
  - View SSH key fingerprint
  - Test connection button

**INCLUDE THIS?** ❌ **No - Not initially**
- Can add to Sync Management tab later if needed
- Focus on core functionality first

---

### **S2. Sync History Visualization**
- Show timeline of recent commits in Sync Logging tab
- Display commit graph (who committed, when, what changed)
- Link to GitHub commit page

**INCLUDE THIS?** ✅ **Yes - Add to Sync Management tab**
- **Consolidation:** Combine original "Sync Logging" and this feature into single "Sync Management" tab in Advanced
- **Tab Contents:**
  - Sync operation logs (as originally planned)
  - Recent commits visualization/timeline
  - Link to GitHub repository
  - Combined UI for all sync-related information and monitoring

---

### **S3. Bandwidth Optimization**
- Option to disable auto-push on metered connections
- Compress metadata before commit
- Batch multiple rapid changes into single commit

**INCLUDE THIS?** ❌ **No**

---

### **S4. Notifications**
- Browser notification when pull brings new images
- Toast notification on successful push
- Alert notification on sync errors

**INCLUDE THIS?** ❌ **No**

---

### **S5. Dry Run Mode**
- Add "Preview Changes" before pull/push
- Show what will be added/modified/deleted
- Require confirmation for large operations

**INCLUDE THIS?** ❌ **No**

---

### **S6. Backup Before Pull**
- Optional: Create local backup before pulling changes
- Restore option if pull breaks something
- Safety net for important workflows

**INCLUDE THIS?** ❌ **No**

---

### **S7. Git Ignore Management**
- Ensure `.DS_Store`, `Thumbs.db`, temp files aren't committed
- Auto-generate `.gitignore` if missing
- Respect existing `.gitignore`

**INCLUDE THIS?** ❌ **No - Should already be set up in repo**
- **Alternative:** Include warning banner on top of gallery page if Git setup of repo path is not what we expect
- Verify `.gitignore` exists and has appropriate entries during repo validation

---

### **S8. Two-Way Sync Conflict Warning**
- If remote has changes AND local has uncommitted changes
- Show warning modal before pull
- Offer: "Commit local first" or "Discard local" or "Cancel"

**INCLUDE THIS?** ❌ **No**
- Q2 conflict handling covers this scenario

---

## 🔧 **Technical Considerations**

### **T1. Git LFS Gotchas**
- Git LFS requires `git lfs install` to be run once per system
- LFS files may not be fully downloaded on clone (use `git lfs pull`)
- Verify `.gitattributes` has `*.jpg filter=lfs` etc.

**Implementation:** Should be set up already in the repo. Include warning banner on gallery page if Git/LFS setup is not as expected (same as S7).

### **T2. Performance**
- Git operations can be slow on large repos
- Show loading indicators for all sync operations
- Consider running Git operations in worker thread (future)

**Implementation:** 
- Add loading badge/indicator on sync button in gallery view when Git operations are in progress
- Include operation details in tooltip (e.g., "Syncing... Pushing 3 files")
- Visual feedback keeps user informed during longer operations

### **T3. Error Messages**
- Provide helpful, actionable error messages
- Example: "Git LFS not installed. Run: git lfs install"
- Example: "SSH key not configured. See: [link to docs]"

**Implementation:** Covered by Sync Management tab logs - detailed error messages will appear in sync logs with context and debugging information.

### **T4. Testing**
- Mock Git operations for unit tests
- Integration tests with test Git repo
- Test offline scenarios thoroughly

---

## 📦 **Dependencies to Add**
- `simple-git` (^3.x) - Git operations
- _(Git and Git LFS must be installed on host system)_

---

## 🚀 **Recommended Implementation Order**

### **Phase 1: Core Infrastructure** (Most Critical)
1. Install `simple-git`, create `git_helper.js`
2. Implement repository verification on startup
3. Add `/api/sync/verify` and `/api/sync/status` endpoints
4. Add startup alert if repo is incorrect

### **Phase 2: Manual Sync** (User Control)
5. Implement pull/push functions in `git_helper.js`
6. Add `/api/sync/pull` and `/api/sync/push` endpoints
7. Add Sync Cloud button to gallery toolbar
8. Add basic sync status indicator

### **Phase 3: Automatic Sync** (Transparency)
9. Integrate auto-commit/push into existing image endpoints
10. Track unsynced state in metadata
11. Add red border indicator for unsynced images
12. Implement offline detection and queuing

### **Phase 4: Logging & Monitoring** (Observability)
13. Create sync logging system
14. Add Sync Logging tab to Advanced
15. Implement log viewing UI
16. Add export/clear logs functions

### **Phase 5: Polish & Optimization** (Refinement)
17. Add debounced push option
18. Implement smart retry on failures
19. Add sync settings to Advanced tab
20. Add notifications and toast messages

---

## 📝 **Documentation to Create**
- `docs/GIT_SYNC.md` - Complete Git LFS sync documentation (user-facing)
- Update `docs/API.md` with new `/api/sync/*` endpoints
- Update `docs/ARCHITECTURE.md` with Git integration details
- Update `docs/QUICK_REFERENCE.md` with sync operations
- Create setup guide for SSH keys / Git credentials

---

## ⚠️ **Potential Challenges**

1. **SSH Key Management** - Users must have GitHub SSH keys configured
2. **Git LFS Installation** - Must be installed on host system
3. **Network Reliability** - Handle flaky connections gracefully
4. **Merge Conflicts** - Rare but possible with multi-instance usage
5. **Large Files** - Git LFS operations can be slow on large images
6. **Credentials Storage** - Securely store Git credentials if not using SSH

---

## ✅ **Success Criteria**

- ✅ System verifies correct repo on startup
- ✅ User can manually trigger pull from UI
- ✅ All image operations auto-commit and push
- ✅ Unsynced images clearly marked
- ✅ Sync logs visible and helpful
- ✅ Works offline (queues changes)
- ✅ No data loss even with failed syncs
- ✅ Clear error messages for common issues

---

## 📋 **Review Checklist**

Before implementation begins, please review and provide decisions for:

- [x] **Q1-Q10**: All design decision questions answered ✅
- [x] **S1-S8**: Additional suggestions approved/rejected/modified ✅
- [x] **Implementation Order**: Phase sequence approved ✅
- [x] **Dependencies**: Confirm `simple-git` is acceptable ✅
- [x] **Environment Setup**: Confirm SSH key approach is acceptable ✅
- [x] **Documentation Plan**: Review doc updates needed ✅

**ALL DECISIONS FINALIZED - READY TO IMPLEMENT** 🚀

---

## 🔄 **Change Log**

### October 15, 2025 - Initial Draft
- Created comprehensive implementation plan
- Identified 10 key design questions
- Proposed 8 additional feature suggestions
- Outlined 5-phase implementation approach
- Documented technical considerations and challenges

### October 15, 2025 - Decisions Finalized
- All Q1-Q10 questions answered and documented
- Additional suggestions (S1-S8) reviewed and decided
- Technical considerations (T1-T3) addressed with implementation notes
- Plan status updated to "Ready to Implement"
- Implementation phases approved

---

## 🎯 **Quick Reference: Final Decisions**

### **Approved Features:**
✅ Auto-pull on startup with tooltip showing last sync time  
✅ Full-screen error on conflicts with detailed debug info  
✅ Immediate push on every change (true "always live")  
✅ Mark unsynced files, retry on each operation  
✅ SSH key authentication (already configured)  
✅ Specific, descriptive commit messages  
✅ Dynamic Git status checking (no caching)  
✅ Enforce `main` branch only  
✅ Manual sync button always available  
✅ Unified "Sync Management" tab with logs + commit history + GitHub link  
✅ Loading indicator on sync button with detailed tooltip  
✅ Warning banner if Git/LFS setup incorrect  

### **Not Included (Scope Reduction):**
❌ Sync settings UI (can add later if needed)  
❌ Bandwidth optimization  
❌ Browser notifications  
❌ Dry run mode  
❌ Backup before pull  
❌ Two-way conflict warnings (covered by Q2)  

---

**Status:** ✅ **READY TO IMPLEMENT**  
**Next Step:** Begin Phase 1 - Core Infrastructure  
**Implementation Guide:** Follow 5-phase roadmap above
