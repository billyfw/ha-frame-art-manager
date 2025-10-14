# Developer Quick Reference

## Quick Start

### Setup
```bash
cd /Users/billywaldman/devprojects/ha-frame-art-manager/frame_art_manager/app
export FRAME_ART_PATH="/Users/billywaldman/devprojects/ha-config/www/frame_art"
npm install
```

### Run Development Server
```bash
npx nodemon server.js
# Server runs on http://localhost:8099
```

### Run Production Server
```bash
npm start
```

---

## Project Structure

```
frame_art_manager/app/
├── server.js              # Express server setup
├── metadata_helper.js     # Data operations class
├── package.json           # Dependencies
├── routes/                # API endpoints
│   ├── images.js         # Image CRUD + upload + rename
│   ├── tvs.js            # TV management
│   └── tags.js           # Tag operations
└── public/               # Frontend files
    ├── index.html        # Single page app
    ├── css/
    │   └── style.css     # All styles
    └── js/
        └── app.js        # Frontend logic
```

---

## Key Files

### server.js
- Express app configuration
- Middleware setup (CORS, body parsing, multer)
- Route registration
- Static file serving
- Port: 8099

### metadata_helper.js
- Class: `MetadataHelper`
- Constructor takes `frameArtPath`
- All methods are async
- Handles file system + metadata.json operations

### routes/images.js
- Image upload (POST /)
- Metadata CRUD (GET, PUT, DELETE /:filename)
- Rename (POST /:filename/rename)
- Bulk tag (POST /bulk-tag)

### routes/tvs.js
- TV CRUD (GET, POST, PUT, DELETE)
- Tag filtering (PUT /:tvId/tags)

### routes/tags.js
- Tag library management (GET, POST, DELETE)

### public/js/app.js
- Frontend state and logic
- Tab navigation
- Modal management
- API calls with fetch()
- DOM manipulation

---

## Common Tasks

### Add New API Endpoint

1. **Create route handler** (e.g., in routes/images.js):
```javascript
router.get('/stats', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const images = await helper.getAllImages();
    res.json({ count: images.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

2. **Register route** (in server.js if new file):
```javascript
const statsRoutes = require('./routes/stats');
app.use('/api/stats', statsRoutes);
```

3. **Call from frontend**:
```javascript
async function loadStats() {
  const response = await fetch(`${API_BASE}/stats`);
  const data = await response.json();
  console.log(data.count);
}
```

### Add New Metadata Helper Method

1. **Add to metadata_helper.js**:
```javascript
async getImageCount() {
  const metadata = await this.readMetadata();
  return Object.keys(metadata.images).length;
}
```

2. **Use in route handler**:
```javascript
const helper = new MetadataHelper(req.frameArtPath);
const count = await helper.getImageCount();
```

### Add New UI Feature

1. **Update HTML** (public/index.html):
```html
<button id="my-feature-btn">My Feature</button>
```

2. **Add styles** (public/css/style.css):
```css
#my-feature-btn {
  background: #3498db;
  color: white;
}
```

3. **Add JavaScript** (public/js/app.js):
```javascript
function initMyFeature() {
  const btn = document.getElementById('my-feature-btn');
  btn.addEventListener('click', async () => {
    // Feature logic
  });
}

// Call in DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  // ... existing init calls
  initMyFeature();
});
```

---

## API Endpoints Quick Reference

### Images
```
GET    /api/images              # List all
POST   /api/images              # Upload (multipart)
GET    /api/images/:filename    # Get one
PUT    /api/images/:filename    # Update metadata
POST   /api/images/:filename/rename  # Rename
DELETE /api/images/:filename    # Delete
POST   /api/images/bulk-tag     # Bulk tag
```

### TVs
```
GET    /api/tvs                 # List all
POST   /api/tvs                 # Add new
PUT    /api/tvs/:tvId           # Update details
PUT    /api/tvs/:tvId/tags      # Update tags
DELETE /api/tvs/:tvId           # Delete
POST   /api/tvs/:tvId/test      # Test connection
```

### Tags
```
GET    /api/tags                # List all
POST   /api/tags                # Add new
DELETE /api/tags/:tag           # Delete
```

### System
```
GET    /api/health              # Health check
```

---

## Frontend State Variables

```javascript
// Global state in app.js
let allImages = []           // Image metadata cache
let allTags = []             // Tag library cache
let allTVs = []              // TV configurations cache
let selectedImages = new Set()  // Bulk selection
let sortAscending = true     // Sort direction
let currentImageFilename = null // Active modal image
let currentTVId = null       // Active modal TV
```

---

## Frontend Functions Quick Reference

### Initialization
- `initTabs()` - Tab navigation
- `initModal()` - Image detail modal
- `initTVModal()` - TV detail modal
- `initBulkActions()` - Bulk operations
- `initUploadForm()` - Upload form
- `initTVForm()` - TV form
- `initTagForm()` - Tag form

### Data Loading
- `loadGallery()` - Fetch & render images
- `loadTags()` - Fetch tags
- `loadTVs()` - Fetch TVs

### Rendering
- `renderGallery()` - Image grid
- `renderTagList()` - Tag list
- `renderTVList()` - TV list

### Image Operations
- `openModal(filename)` - Open detail modal
- `saveImageMetadata()` - Save changes
- `deleteImage(filename)` - Delete with confirm
- `showEditFilenameForm()` - Show rename UI
- `saveFilenameChange()` - Submit rename

### TV Operations
- `openTVModal(tvId)` - Open detail modal
- `saveTVModal()` - Save changes
- `deleteTVFromModal()` - Delete with confirm

### Utilities
- `formatDate(dateString)` - ISO → "Jan 5, 2025"

---

## CSS Classes Reference

### Layout
- `.container` - Main container
- `.tab-content` - Tab pane
- `.section` - Content section

### Gallery
- `.image-grid` - Grid layout
- `.image-card` - Individual card
- `.image-card.selected` - Selected state
- `.image-info` - Card info section
- `.image-date` - Date display

### Modals
- `.modal` - Modal overlay
- `.modal-content` - Modal box
- `.tv-modal` - TV modal variant
- `.bulk-modal` - Bulk tag modal

### Controls
- `.controls` - Toolbar container
- `.control-item` - Toolbar section
- `.custom-multiselect` - Custom dropdown
- `.multiselect-button` - Dropdown button
- `.multiselect-dropdown` - Dropdown menu
- `.multiselect-option` - Checkbox option

### Buttons
- `.btn-primary` - Blue action button
- `.btn-secondary` - Gray button
- `.btn-danger` - Red delete button
- `.btn-small` - Small button
- `.btn-icon` - Icon button

### Lists
- `.list-item` - List row
- `.list-item-clickable` - Clickable row
- `.list-item-info` - Row content
- `.list-item-name` - Primary text
- `.list-item-detail` - Secondary text

---

## Common Patterns

### API Call Pattern
```javascript
async function doSomething() {
  try {
    const response = await fetch(`${API_BASE}/endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Handle success
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Operation failed:', error);
    alert('Failed: ' + error.message);
  }
}
```

### Modal Pattern
```javascript
function openSomeModal(id) {
  // Populate modal fields
  document.getElementById('modal-field').value = data;
  
  // Show modal
  document.getElementById('some-modal').style.display = 'block';
}

function closeSomeModal() {
  document.getElementById('some-modal').style.display = 'none';
}

// Event listeners
document.getElementById('modal-save').addEventListener('click', async () => {
  // Save logic
  closeSomeModal();
});

document.getElementById('modal-cancel').addEventListener('click', closeSomeModal);
```

### Dropdown Pattern
```javascript
// Toggle dropdown
button.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdown.classList.toggle('active');
});

// Close on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-container')) {
    dropdown.classList.remove('active');
  }
});
```

---

## Debugging Tips

### Server-Side
```javascript
// Add logging in route handlers
console.log('Request received:', req.body);
console.log('Metadata:', metadata);

// Log errors with stack traces
console.error('Error:', error);
console.error('Stack:', error.stack);
```

### Client-Side
```javascript
// Log state changes
console.log('Images loaded:', allImages.length);
console.log('Selected:', Array.from(selectedImages));

// Debug API calls
console.log('Fetching:', url);
console.log('Response:', await response.json());

// Inspect DOM
console.log('Element:', document.getElementById('id'));
```

### Network
- Open browser DevTools → Network tab
- Check request/response for API calls
- Verify status codes and payloads

---

## File Naming Conventions

### Images
- Format: `basename-uuid.ext`
- Example: `landscape-a1b2c3d4.jpg`
- UUID: 8 hex characters
- Generated: `crypto.randomBytes(4).toString('hex')`

### Sanitization
```javascript
// Lowercase, replace spaces/underscores with hyphens
// Remove special characters except hyphens
baseName.toLowerCase()
  .replace(/[\s_]+/g, '-')
  .replace(/[^a-z0-9-]/g, '')
```

---

## Environment Variables

```bash
# Required
export FRAME_ART_PATH="/path/to/frame_art"

# Optional
export PORT=8099  # Default port
```

---

## npm Scripts

```json
{
  "start": "node server.js",
  "dev": "nodemon server.js"
}
```

Usage:
```bash
npm start       # Production
npm run dev     # Development with auto-reload
```

---

## Git Workflow

```bash
# Check status
git status

# Stage changes
git add .

# Commit
git commit -m "Description of changes"

# Push
git push origin main
```

---

## Documentation Files

- `DEVELOPMENT.md` - Overall development plan and status
- `docs/API.md` - Complete API reference
- `docs/ARCHITECTURE.md` - Technical architecture
- `docs/UI_FEATURES.md` - UI feature documentation
- `docs/RENAME_FEATURE.md` - Image rename feature
- `docs/TV_TAG_FILTERING.md` - TV tag filtering
- `docs/TV_DETAIL_MODAL.md` - TV modal implementation
- `docs/QUICK_REFERENCE.md` - This file

---

## Next Steps

### Immediate
- Implement Git LFS sync interface
- Add AppDaemon service integration
- Create Dockerfile for containerization

### Future
- Add authentication
- Implement real TV connection testing
- Add image usage statistics
- Create backup/restore functionality
- Add batch upload support
