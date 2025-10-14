# Frame Art Manager Add-on - Development Plan

## Phase 2: Frame Art Manager Add-on Implementation

### Overview
Home Assistant add-on that provides a web interface for managing Samsung Frame TV artwork library.

### Repository Structure
```
ha-frame-art-manager/
├── README.md                    # Main repository README
├── frame_art_manager/           # The actual add-on folder
│   ├── config.yaml             # Add-on configuration (required by HA)
│   ├── Dockerfile              # Container definition
│   ├── build.yaml              # Build configuration for multiple architectures
│   ├── README.md               # Add-on documentation (shows in HA UI)
│   ├── CHANGELOG.md            # Version history
│   ├── icon.png                # Add-on icon (108x108px)
│   ├── logo.png                # Add-on logo (optional, for docs)
│   ├── rootfs/                 # Root filesystem for the container
│   │   └── usr/
│   │       └── bin/
│   │           └── run.sh      # Startup script
│   └── app/                    # Our Node.js application
│       ├── package.json
│       ├── server.js           # Main Express server
│       ├── metadata_helper.js  # Metadata operations
│       ├── public/             # Static web files
│       │   ├── index.html
│       │   ├── css/
│       │   │   └── style.css
│       │   └── js/
│       │       └── app.js
│       └── routes/             # API endpoints
│           ├── images.js
│           ├── tvs.js
│           └── tags.js
└── repository.json              # HACS repository metadata
```

### Implementation Steps

#### Step 2: Initialize new repo ✅
- [x] Created GitHub repository: `ha-frame-art-manager`
- [x] Cloned to `/Users/ownerOWNER/devprojects/ha-frame-art-manager`

#### Step 3: Build web interface features ✅
- [x] Image upload with drag & drop
- [x] Tag management (add/remove tags per image)
- [x] Matte/filter selection per image
- [x] TV management with detail modal
- [x] TV tag filtering (assign tags to TVs to control which images display)
- [x] Image gallery with thumbnails
- [x] Image detail modal with rename functionality
- [x] Image delete
- [x] Bulk tagging operations (select multiple images, apply tags)
- [x] Multi-tag filtering with checkbox dropdown
- [x] Sort by name/date with direction toggle
- [x] Search functionality
- [x] Compact toolbar with icons and professional UI
- [ ] Git LFS sync management (auto/manual?)

#### Step 4: Add API endpoints ✅
- [x] `GET /api/images` - Get all images with metadata
- [x] `POST /api/images` - Upload new image
- [x] `GET /api/images/:filename` - Get single image metadata
- [x] `PUT /api/images/:filename` - Update image metadata
- [x] `POST /api/images/:filename/rename` - Rename image (preserving UUID)
- [x] `DELETE /api/images/:filename` - Delete image
- [x] `POST /api/images/bulk-tag` - Add tags to multiple images
- [x] `GET /api/tvs` - Get all TVs
- [x] `POST /api/tvs` - Add new TV
- [x] `PUT /api/tvs/:tvId` - Update TV name and IP
- [x] `PUT /api/tvs/:tvId/tags` - Update TV tag filters
- [x] `DELETE /api/tvs/:tvId` - Delete TV
- [x] `GET /api/tags` - Get all tags
- [x] `POST /api/tags` - Add new tag
- [x] `DELETE /api/tags/:tag` - Delete tag
- [x] `GET /api/health` - Health check with library path
- [ ] `/api/sync` - Trigger Git LFS operations
- [ ] `/api/display` - Call AppDaemon service to display image on TV (via HA REST API)
- [ ] `/api/shuffle` - Start/stop shuffle via AppDaemon services

#### Step 5: Create Add-on Container Files
- [ ] Create `config.yaml` - Add-on metadata and configuration options
- [ ] Create `Dockerfile` - Container build instructions
- [ ] Create `build.yaml` - Multi-architecture build config
- [ ] Create `rootfs/usr/bin/run.sh` - Startup script
- [ ] Create add-on `README.md` - User documentation (shows in HA UI)
- [ ] Create `CHANGELOG.md` - Version history
- [ ] Add `icon.png` and `logo.png` - Add-on branding

#### Step 6: Package for HACS
- [ ] Create repository `README.md` with installation instructions
- [ ] Set up GitHub releases with version tags
- [ ] Test installation via HACS custom repository
- [ ] Submit to HACS default repository

### Technology Stack
- **Backend**: Node.js + Express
- **File Operations**: Node.js `fs` module
- **Image Processing**: `sharp` library (for thumbnails)
- **Git Operations**: `simple-git` library
- **Frontend**: Vanilla HTML/CSS/JavaScript (or Alpine.js for reactivity)
- **Container**: Alpine Linux base image

### Local Development
```bash
cd /Users/ownerOWNER/devprojects/ha-frame-art-manager/frame_art_manager/app
export FRAME_ART_PATH="/Users/ownerOWNER/devprojects/ha-config/www/frame_art"
npm install
npm start
```

### Metadata Helper Functions Needed
- ✅ `readMetadata()` - Load metadata.json
- ✅ `writeMetadata(data)` - Save metadata.json
- ✅ `addImage(filename, matte, filter, tags, dimensions)` - Add new image entry
- ✅ `updateImage(filename, updates)` - Update existing image metadata
- ✅ `renameImage(oldFilename, newFilename)` - Rename image in metadata
- ✅ `deleteImage(filename)` - Remove image from metadata
- ✅ `getAllImages()` - Return all image metadata
- ✅ `getImagesByTag(tag)` - Query images by tag
- ✅ `addTV(name, ip)` - Add TV to list
- ✅ `updateTV(tvId, name, ip)` - Update TV details
- ✅ `updateTVTags(tvId, tags)` - Update TV tag filters
- ✅ `removeTV(tvId)` - Remove TV from list
- ✅ `getAllTVs()` - Get all TVs
- ✅ `addTag(tagName)` - Add tag to library
- ✅ `removeTag(tagName)` - Remove tag from library
- ✅ `getAllTags()` - Get all tags
- ✅ `generateThumbnail(imagePath, thumbPath)` - Create thumbnail using sharp
- [ ] `verifySync()` - Check consistency between actual files and metadata

### Integration with Frame Art Repository
- Accesses: `/config/www/frame_art/` (or local path via env var)
- Reads/writes: `metadata.json`
- Manages: `library/` and `thumbs/` directories
- Git operations: Push/pull via Git LFS

### Next Phase Dependencies
- Will call AppDaemon services via HA REST API (Phase 3)
- Services: `appdaemon.frame_art_display`, `appdaemon.frame_art_shuffle_start`, `appdaemon.frame_art_shuffle_stop`

---

## Current Status (Updated: October 2025)

### ✅ Completed Features

**Web Interface:**
- Full-featured image gallery with search, filter, and sort
- Image detail modal with rename, tag, matte/filter editing
- Bulk operations (multi-select and tag multiple images)
- TV management with detail modal and tag filtering
- Drag & drop image upload
- Responsive, professional UI with compact toolbar

**Backend API:**
- Complete REST API for images, TVs, and tags
- Image upload with automatic thumbnail generation
- Metadata management with JSON persistence
- File operations (upload, rename, delete) with UUID preservation

**Key Features:**
- **Image Rename**: Preserves UUID suffixes, sanitizes names, updates files + thumbnails + metadata
- **TV Tag Filtering**: Assign tags to each TV to control which images display
- **Multi-tag Filter**: Checkbox dropdown for selecting multiple tags
- **Bulk Tagging**: Select multiple images and apply tags at once
- **Sort Direction Toggle**: Click arrow to switch between ascending/descending
- **Professional UI**: Compact toolbar with icons, hover effects, clean design

### 📋 Pending Features
- Git LFS sync management interface
- AppDaemon service integration for displaying images
- Containerization (Dockerfile, config.yaml for Home Assistant)
- HACS packaging and distribution

### 🔧 Development Environment
```bash
cd /Users/ownerOWNER/devprojects/ha-frame-art-manager/frame_art_manager/app
export FRAME_ART_PATH="/Users/ownerOWNER/devprojects/ha-config/www/frame_art"
npm install
# Development with auto-reload:
npx nodemon server.js
# Or production:
npm start
```

Server runs on: http://localhost:8099

### 📚 Documentation
- `docs/RENAME_FEATURE.md` - Image rename functionality
- `docs/TV_TAG_FILTERING.md` - TV tag assignment and filtering
- `docs/TV_DETAIL_MODAL.md` - TV detail modal implementation
- See individual feature docs for detailed technical information