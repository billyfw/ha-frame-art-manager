# Development Guide

Complete technical reference for Frame Art Manager development.

---

## Table of Contents

1. [Setup](#setup)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
4. [Testing](#testing)
5. [Code Patterns](#code-patterns)

---

## Setup

### Prerequisites
- Node.js 18+
- Git with Git LFS
- SSH keys configured for GitHub

### Installation

```bash
cd frame_art_manager/app
npm install
```

### Configuration

```bash
# Required
export FRAME_ART_PATH="/path/to/frame_art"

# Optional
export PORT=8099
export GIT_AUTO_PULL_ON_STARTUP=true
```

### Running

```bash
npm start          # Run tests, then start server
npm run dev        # Start without tests (faster)
npm test           # Run all tests
```

### Git & LFS configuration (SSH-only)

Frame Art Manager relies on Git LFS over SSH. Both the Home Assistant add-on (`run.sh`) and the server-side helper (`git_helper.js`) normalize any SSH remote into the same base configuration:

- `remote.origin.lfsurl` → `ssh://git@github.com/billyfw/frame_art`
- `lfs.url` → `ssh://git@github.com/billyfw/frame_art`
- `lfs.ssh.endpoint` → `git@github.com:billyfw/frame_art.git`
- Legacy HTTPS access tokens (`lfs.https://github.com/.../info/lfs.access`) are removed automatically

This matches a working macOS setup and ensures the add-on never falls back to HTTPS (which requires credentials the container cannot provide).

To verify the configuration on either environment:

```bash
git remote get-url origin                               # should be git@github.com:billyfw/frame_art.git
git config --get remote.origin.lfsurl                   # ssh://git@github.com/billyfw/frame_art
git config --get lfs.url                                # ssh://git@github.com/billyfw/frame_art
git config --get lfs.ssh.endpoint                       # git@github.com:billyfw/frame_art.git
git config --get lfs.https://github.com/billyfw/frame_art/info/lfs.access || echo "(cleared)"
git config --get lfs.https://github.com/billyfw/frame_art.git/info/lfs.access || echo "(cleared)"
```

If the add-on picked up an older configuration, simply restart it—`run.sh` now rewrites the values on boot before the Node server starts.

---

## Architecture

### Project Structure

```
frame_art_manager/app/
├── server.js                    # Express entry point
├── metadata_helper.js           # Data operations
├── git_helper.js                # Git/LFS operations
├── routes/                      # API endpoints
│   ├── images.js               # Image CRUD
│   ├── tags.js                 # Tag operations
│   └── sync.js                 # Git sync
├── public/                      # Frontend
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── tests/                       # Automated tests
    ├── git-sync.test.js
    ├── metadata-helper.test.js
    └── file-coordination.test.js
```

### Technology Stack

**Backend:**
- Express 4.18+ (web framework)
- multer (file uploads)
- sharp (image processing)
- simple-git (Git operations)

**Frontend:**
- Vanilla JavaScript (no frameworks)
- Fetch API (HTTP requests)
- CSS Grid/Flexbox (layout)

**Storage:**
- JSON file (metadata.json)
- Filesystem (library/ + thumbs/)

### Data Flow

**Image Upload:**
```
User uploads file
  ↓
POST /api/images
  ↓
Multer saves to library/
  ↓
Generate UUID suffix
  ↓
Sharp creates thumbnail
  ↓
MetadataHelper.addImage()
  ↓
Write metadata.json
  ↓
Return success
```

**Image Rename:**
```
User submits new name
  ↓
POST /api/images/:filename/rename
  ↓
Extract UUID from old filename
  ↓
Sanitize new base name
  ↓
git mv (library file)
  ↓
git mv (thumbnail)
  ↓
MetadataHelper.renameImage()
  ↓
git add (metadata.json)
  ↓
Return new filename
```

**Why `git mv` instead of `fs.rename()`:**
- Git recognizes rename as single operation (shows as "R" status)
- Sync badge correctly shows 1 change instead of 2
- Atomic from Git's perspective (no race conditions)
- More reliable with Git LFS
- Prevents orphaned files

### File System Structure

```
FRAME_ART_PATH/
├── library/
│   ├── landscape-a1b2c3d4.jpg    # Original images
│   └── portrait-e5f6g7h8.jpg
├── thumbs/
│   ├── landscape-a1b2c3d4.jpg    # 400x300 thumbnails
│   └── portrait-e5f6g7h8.jpg
└── metadata.json                  # All metadata
```

### metadata.json Schema

```json
{
  "images": {
    "landscape-a1b2c3d4.jpg": {
  "matte": "squares",
  "filter": "None",
      "tags": ["landscape", "nature"],
      "dimensions": {"width": 3840, "height": 2160},
      "aspectRatio": 1.78,
      "added": "2025-10-15T10:30:00.000Z"
    }
  },
  "tags": ["landscape", "portrait", "nature"]
}
```

---

## API Reference

All endpoints return JSON. Base URL: `http://localhost:8099`

### Images

#### Get All Images
```http
GET /api/images
```

**Response:**
```json
{
  "landscape-a1b2.jpg": {
    "matte": "squares",
    "filter": "None",
    "tags": ["landscape"],
    "dimensions": {"width": 3840, "height": 2160},
    "added": "2025-10-15T10:30:00.000Z"
  }
}
```

#### Upload Image
```http
POST /api/images
Content-Type: multipart/form-data

Fields:
  image: <file>
  matte: "none" | "modernthin" | "modern" | "modernwide" | "flexible" | "shadowbox" | "panoramic" | "triptych" | "mix" | "squares"
  filter: "None" | "Aqua" | "ArtDeco" | "Ink" | "Wash" | "Pastel" | "Feuve"
  tags: "landscape,nature" (comma-separated)
  customName: "my-photo" (optional)
```

**Response:**
```json
{
  "success": true,
  "filename": "my-photo-a1b2c3d4.jpg",
  "data": { /* image metadata */ }
}
```

#### Update Image Metadata
```http
PUT /api/images/:filename
Content-Type: application/json

{
  "matte": "mix",
  "filter": "Aqua",
  "tags": ["landscape", "sunset"]
}
```

#### Rename Image
```http
POST /api/images/:filename/rename
Content-Type: application/json

{
  "newBaseName": "sunset-beach"
}
```

**Response:**
```json
{
  "success": true,
  "oldFilename": "photo-a1b2c3d4.jpg",
  "newFilename": "sunset-beach-a1b2c3d4.jpg"
}
```

**Implementation:** Uses `git mv` to rename both the image and thumbnail atomically. This ensures Git recognizes the operation as a rename (shows as "R" status) rather than a delete + add, which means:
- Sync badge shows 1 change instead of 2
- No risk of orphaned files
- Better Git LFS handling
- Cleaner git history

#### Delete Image
```http
DELETE /api/images/:filename
```

Deletes file, thumbnail, and metadata.

#### Bulk Tag
```http
POST /api/images/bulk-tag
Content-Type: application/json

{
  "filenames": ["photo1.jpg", "photo2.jpg"],
  "tags": ["landscape", "nature"]
}
```

#### Get Images by Tag
```http
GET /api/images/tag/:tagName
```

### Tags

#### Get All Tags
```http
GET /api/tags
```

**Response:**
```json
["landscape", "portrait", "nature", "abstract"]
```

#### Add Tag
```http
POST /api/tags
Content-Type: application/json

{
  "tag": "sunset"
}
```

#### Delete Tag
```http
DELETE /api/tags/:tag
```

Removes tag from library AND all images.

### Sync

#### Check and Pull
```http
GET /api/sync/check
```

Checks if behind remote, pulls if clean working tree.

**Response:**
```json
{
  "success": true,
  "synced": true,
  "pulledChanges": true,
  "commitsReceived": 2,
  "message": "Pulled 2 commits"
}
```

#### Get Sync Status
```http
GET /api/sync/status
```

Returns semantic breakdown of changes to upload/download.

**Response:**
```json
{
  "upload": {
    "count": 3,
    "newImages": 1,
    "modifiedImages": 1,
    "deletedImages": 0,
    "renamedImages": 1
  },
  "download": {
    "count": 0,
    "newImages": 0,
    "modifiedImages": 0,
    "deletedImages": 0,
    "renamedImages": 0
  }
}
```

**Note:** Renames are detected by Git's "R" status code and counted as 1 change (not 2).

### Static Files

```http
GET /library/:filename        # Original images
GET /thumbs/:filename         # Thumbnails
GET /                         # index.html (SPA)
```

---

## Testing

### Test Architecture

We use a **minimal test framework** built on Node.js `assert` module:
- Zero external dependencies
- Fast execution (~15 seconds)
- Isolated test environments in `/tmp`
- Exit code 0 on success, 1 on failure

### Test Suites

**1. Git Sync (27 tests)**
- Location: `tests/git-sync.test.js`
- Tests Git/LFS operations
- Uses isolated repo in `/tmp/frame-art-test-{timestamp}`
- Clones from GitHub with `--depth 5`
- Verifies SSH remote normalization, LFS URL cleanup, and removal of stale HTTPS credentials

**2. Metadata Helper (16 tests)**
- Location: `tests/metadata-helper.test.js`
- Tests CRUD operations
- Uses `/tmp/frame-art-metadata-test-{timestamp}`
- Creates dummy 1x1 PNG images

**3. File Coordination (12 tests)**
- Location: `tests/file-coordination.test.js`
- Tests rename/delete coordination
- Verifies file + thumbnail + metadata sync
- Uses `git mv` for rename operations
- Uses `/tmp/frame-art-coord-test-{timestamp}`
- Initializes git repo in test environment

### Running Tests

```bash
# All tests
npm test

# Individual suites
npm run test:git
npm run test:metadata
npm run test:coordination

# With verbose output
npm run test:verbose
```

### Test Output

```
🧪 Running Git Sync Tests...
✓ GitHelper can be instantiated
✓ verifyConfiguration returns valid structure
✓ INTEGRATION: pull when 1 commit behind
...
27 passed, 0 failed

🧪 Running Metadata Helper Tests...
✓ MetadataHelper can be instantiated
✓ addImage stores metadata correctly
...
16 passed, 0 failed

🧪 Running File Coordination Tests...
✓ rename updates all three resources
✓ delete removes all three resources
...
9 passed, 0 failed
```

### Writing Tests

**Pattern:**
```javascript
const assert = require('assert');

test('descriptive test name', async () => {
  // Arrange
  const input = 'test data';
  
  // Act
  const result = await functionUnderTest(input);
  
  // Assert
  assert.strictEqual(result, expected);
});
```

**Guidelines:**
- Use descriptive test names
- Prefix integration tests with "INTEGRATION:"
- Test exact values, not fuzzy matches
- Guarantee cleanup with try-finally
- Suppress expected console errors

---

## Code Patterns

### Backend Error Handling

```javascript
try {
  const result = await operation();
  res.json({ success: true, data: result });
} catch (error) {
  console.error('Operation failed:', error);
  res.status(500).json({ error: error.message });
}
```

### Frontend Fetch Pattern

```javascript
async function apiCall() {
  try {
    const response = await fetch('/api/endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Handle success
    }
  } catch (error) {
    console.error('Request failed:', error);
    alert('Operation failed');
  }
}
```

### MetadataHelper Usage

```javascript
const helper = new MetadataHelper(frameArtPath);

// Add image
await helper.addImage(filename, matte, filter, tags);

// Update image
await helper.updateImage(filename, { matte: 'mix' });

// Rename image
await helper.renameImage(oldFilename, newFilename);

// Delete image
await helper.deleteImage(filename);

// Get all images
const images = await helper.getAllImages(); // Returns object

// Get by tag
const filtered = await helper.getImagesByTag('landscape'); // Returns object
```

### GitHelper Usage

```javascript
const git = new GitHelper(frameArtPath);

// Verify configuration
const config = await git.verifyConfiguration();
// Returns: { isValid, hasRemote, hasLFS, remoteName, remoteUrl }

// Check status
const status = await git.getStatus();
// Returns: { isClean, hasChanges, uncommittedFiles }

// Pull if behind
const result = await git.checkAndPullIfBehind();
// Returns: { success, synced, pulledChanges, commitsReceived, skipped, reason }

// Rename files (for image rename operations)
await git.git.mv('library/old.jpg', 'library/new.jpg');
await git.git.mv('thumbs/thumb_old.jpg', 'thumbs/thumb_new.jpg');
await git.git.add('metadata.json');
// Git recognizes this as a rename, shows as "R" status, counts as 1 change
```

### Rename Implementation Pattern

When renaming images, use `git mv` instead of `fs.rename()`:

```javascript
// Get GitHelper instance
const git = new GitHelper(frameArtPath);

// 1. Move the image file
await git.git.mv('library/oldname.jpg', 'library/newname.jpg');

// 2. Move the thumbnail
await git.git.mv('thumbs/thumb_oldname.jpg', 'thumbs/thumb_newname.jpg');

// 3. Update metadata
await helper.renameImage('oldname.jpg', 'newname.jpg');

// 4. Stage the metadata change
await git.git.add('metadata.json');
```

**Why `git mv`?**
- Git recognizes as single rename operation (shows as "R" status)
- Sync status correctly shows 1 change instead of 2 (delete + add)
- Atomic from Git's perspective (no race conditions)
- More reliable with Git LFS
- Prevents orphaned files from incomplete operations
- Cleaner git history

### Modal Pattern

```javascript
// HTML
<div id="myModal" class="modal">
  <div class="modal-content">
    <!-- Content -->
  </div>
</div>

// JavaScript
function openModal() {
  document.getElementById('myModal').classList.add('active');
}

function closeModal() {
  document.getElementById('myModal').classList.remove('active');
}

// Click outside to close
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    closeModal();
  }
});
```

### State Management

```javascript
// Global state
let allImages = [];
let allTags = [];
let allTVs = [];
let selectedImages = new Set();

// Load data
async function loadGallery() {
  const response = await fetch('/api/images');
  allImages = Object.entries(await response.json())
    .map(([filename, data]) => ({ filename, ...data }));
  renderGallery();
}

// Update UI
function renderGallery() {
  const container = document.getElementById('gallery');
  container.innerHTML = allImages
    .map(img => `<div class="card">${img.filename}</div>`)
    .join('');
}
```

---

## Development Workflow

### Making Changes

1. Make changes in `frame_art_manager/app/`
2. Write/update tests if needed
3. Run `npm test` to verify
4. Update docs if adding features
5. Commit with clear message

### Adding API Endpoints

1. Create route handler in `routes/`
2. Register in `server.js`
3. Document in this file (API Reference section)
4. Write tests if complex logic

### Adding UI Features

1. Update `public/index.html` (markup)
2. Update `public/css/style.css` (styles)
3. Update `public/js/app.js` (logic)
4. Document in `FEATURES.md`

### Debugging

```bash
# Check logs
tail -f /var/log/frame-art.log

# Inspect metadata
cat $FRAME_ART_PATH/metadata.json | jq

# Test API manually
curl http://localhost:8099/api/images

# Check Git status
cd $FRAME_ART_PATH && git status
```

---

## Performance Considerations

### Current Optimizations
- Thumbnail generation (reduces gallery load time)
- Client-side filtering/sorting (no server round-trips)
- Sharp library (fast image processing)
- Static file serving (efficient)

### Future Optimizations
- Lazy loading (load images as user scrolls)
- Image caching (browser cache headers)
- Pagination (limit initial data load)
- Web Workers (offload heavy operations)
- Compression (gzip/brotli middleware)

---

## Security Considerations

### Current Implementation
- Filename sanitization (alphanumeric + hyphens)
- MIME type validation (images only)
- Path traversal prevention (path.basename)
- File size limits (50MB)

### Future Enhancements
- Authentication middleware
- Rate limiting
- HTTPS support
- Home Assistant OAuth integration

---

## Browser Compatibility

**Target:**
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS 14+, Android Chrome)

**Required Features:**
- Fetch API
- ES6 (arrow functions, const/let, template literals)
- CSS Flexbox/Grid
- File API

---

## Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.0",
    "simple-git": "^3.28.0",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

## Deployment

### Development
```bash
npm run dev    # Hot reload with nodemon
```

### Production (Future)
```bash
npm start      # Tests + server
```

### Docker (Future)
```bash
docker build -t frame-art-manager .
docker run -p 8099:8099 -v /path/to/frame_art:/data frame-art-manager
```

---

## Troubleshooting

**Tests failing?**
- Check SSH keys: `ssh -T git@github.com`
- Verify Git LFS: `git lfs version`
- Check `/tmp` is writable

**Server won't start?**
- Verify `FRAME_ART_PATH` is set
- Check port 8099 isn't in use
- Ensure dependencies installed: `npm install`

**Images not uploading?**
- Check disk space
- Verify sharp can process image
- Check `library/` directory exists and is writable

**Git sync not working?**
- Verify Git repo is clean: `git status`
- Check remote configured: `git remote -v`
- Test SSH access: `git fetch --dry-run`

---

For user-facing features, see [FEATURES.md](FEATURES.md).  
For progress tracking, see [STATUS.md](STATUS.md).
