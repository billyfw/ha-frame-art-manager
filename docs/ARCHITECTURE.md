# Technical Architecture

## System Overview

Frame Art Manager is a Node.js web application for managing Samsung Frame TV artwork libraries. It provides a REST API and web interface for image upload, metadata management, and TV configuration.

---

## Technology Stack

### Backend
- **Runtime**: Node.js v18+
- **Framework**: Express.js v4.18+
- **Image Processing**: sharp v0.32+
- **File Upload**: multer v1.4+
- **Utilities**: 
  - crypto (built-in) - UUID generation
  - fs/promises (built-in) - File operations
  - path (built-in) - Path manipulation

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Flexbox, Grid layouts
- **Vanilla JavaScript** - No frameworks
- **Fetch API** - HTTP requests

### Data Storage
- **metadata.json** - JSON file database
- **File System** - Image storage (library/ and thumbs/)

---

## Architecture Pattern

### MVC-like Structure
```
├── server.js              # Entry point, Express setup
├── metadata_helper.js     # Model layer (data operations)
├── routes/                # Controller layer (API endpoints)
│   ├── images.js
│   ├── tvs.js
│   └── tags.js
└── public/                # View layer (static files)
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

---

## Core Components

### 1. Server (server.js)

**Responsibilities:**
- Express app configuration
- Middleware setup
- Route registration
- Static file serving
- Server startup

**Key Features:**
- CORS enabled for cross-origin requests
- Body parsing (JSON and URL-encoded)
- File upload handling (multer)
- Custom middleware for FRAME_ART_PATH injection

**Middleware Stack:**
```javascript
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use((req, res, next) => {
  req.frameArtPath = process.env.FRAME_ART_PATH
  next()
})
app.use('/library', express.static(libraryPath))
app.use('/thumbs', express.static(thumbsPath))
app.use(express.static(publicPath))
```

**Port**: 8099 (configurable via PORT env var)

---

### 2. Metadata Helper (metadata_helper.js)

**Design Pattern**: Class-based with async methods

**Responsibilities:**
- Read/write metadata.json
- CRUD operations for images, TVs, tags
- Thumbnail generation
- File system operations

**Key Methods:**

#### Core Operations
```javascript
async readMetadata()           // Load metadata.json
async writeMetadata(data)      // Save metadata.json
async ensureDirectories()      // Create library/thumbs if needed
async generateThumbnail(src, dest) // Create 400x300 thumbnail
```

#### Image Operations
```javascript
async addImage(filename, matte, filter, tags, dimensions)
async updateImage(filename, updates)
async renameImage(oldFilename, newFilename)
async deleteImage(filename)
async getAllImages()
async getImagesByTag(tag)
```

#### TV Operations
```javascript
async addTV(name, ip)
async updateTV(tvId, name, ip)
async updateTVTags(tvId, tags)
async removeTV(tvId)
async getAllTVs()
```

#### Tag Operations
```javascript
async addTag(tagName)
async removeTag(tagName)
async getAllTags()
```

**Error Handling:**
- Throws descriptive errors
- Caller handles error responses
- File operations wrapped in try-catch

---

### 3. Route Handlers (routes/)

**Design Pattern**: Express Router modules

#### images.js
- GET `/` - List all images
- POST `/` - Upload image (multipart/form-data)
- GET `/:filename` - Get single image
- PUT `/:filename` - Update metadata
- POST `/:filename/rename` - Rename image
- DELETE `/:filename` - Delete image
- POST `/bulk-tag` - Bulk tag operation

#### tvs.js
- GET `/` - List all TVs
- POST `/` - Add new TV
- PUT `/:tvId` - Update TV details
- PUT `/:tvId/tags` - Update TV tags
- DELETE `/:tvId` - Delete TV
- POST `/:tvId/test` - Test connection (placeholder)

#### tags.js
- GET `/` - List all tags
- POST `/` - Add new tag
- DELETE `/:tag` - Delete tag

**Request Flow:**
```
Client Request
    ↓
Express Router
    ↓
Middleware (injects frameArtPath)
    ↓
Route Handler
    ↓
MetadataHelper (data operations)
    ↓
File System / metadata.json
    ↓
Response to Client
```

---

### 4. Frontend Application (public/js/app.js)

**Design Pattern**: Module pattern with global state

**State Management:**
```javascript
let allImages = []          // Image metadata cache
let allTags = []            // Tag library cache
let allTVs = []             // TV configurations cache
let selectedImages = new Set() // Bulk selection state
let sortAscending = true    // Sort direction
let currentImageFilename = null // Active modal image
let currentTVId = null      // Active modal TV
```

**Key Functions:**

#### Initialization
```javascript
initTabs()              // Tab navigation setup
initModal()             // Image modal setup
initTVModal()           // TV modal setup
initBulkActions()       // Bulk operations setup
initUploadForm()        // Upload form handling
initTVForm()            // TV form handling
initTagForm()           // Tag form handling
```

#### Data Loading
```javascript
loadGallery()           // Fetch and render images
loadTags()              // Fetch tags
loadTagsForFilter()     // Populate tag filter
loadTVs()               // Fetch TVs
```

#### Rendering
```javascript
renderGallery()         // Render image grid
renderTagList()         // Render tag list
renderTVList()          // Render TV list
updateSortDirectionIcon() // Update sort arrow
updateTagFilterDisplay() // Update filter button
formatDate(dateString)  // Format ISO dates
```

#### Image Operations
```javascript
openModal(filename)     // Open image detail
saveImageMetadata()     // Save image changes
deleteImage(filename)   // Delete with confirmation
showEditFilenameForm()  // Show rename form
saveFilenameChange()    // Submit rename
```

#### TV Operations
```javascript
openTVModal(tvId)       // Open TV detail
saveTVModal()           // Save TV changes
deleteTVFromModal()     // Delete TV
updateTVModalTagsDisplay() // Update tag display
```

#### Bulk Operations
```javascript
toggleImageSelection(filename) // Toggle selection
openBulkTagModal()      // Open bulk tag modal
saveBulkTags()          // Apply tags to selected
clearSelection()        // Clear all selections
```

**Event Handling:**
- Click events: Cards, buttons, modals
- Change events: Inputs, selects, checkboxes
- Submit events: Forms
- Document click: Close dropdowns

---

## Data Flow

### Image Upload Flow
```
User selects file
    ↓
Upload form submitted
    ↓
POST /api/images (multipart)
    ↓
Multer middleware processes upload
    ↓
Generate UUID suffix
    ↓
Save to library/
    ↓
Generate thumbnail with sharp
    ↓
Extract dimensions
    ↓
MetadataHelper.addImage()
    ↓
Write to metadata.json
    ↓
Return success response
    ↓
Frontend redirects to Gallery
```

### Image Rename Flow
```
User clicks pencil icon
    ↓
Inline form appears
    ↓
User enters new name
    ↓
POST /api/images/:filename/rename
    ↓
Extract UUID from old filename
    ↓
Sanitize new base name
    ↓
Check for conflicts
    ↓
Rename library file (fs.rename)
    ↓
Rename thumbnail file (fs.rename)
    ↓
MetadataHelper.renameImage()
    ↓
Update metadata.json key
    ↓
Return old and new filenames
    ↓
Frontend updates UI
```

### TV Tag Filtering Flow
```
User clicks TV row
    ↓
Modal opens with TV data
    ↓
User selects tags in dropdown
    ↓
Click "Save Changes"
    ↓
PUT /api/tvs/:tvId (name, ip)
    ↓
PUT /api/tvs/:tvId/tags (tags array)
    ↓
MetadataHelper.updateTV()
    ↓
MetadataHelper.updateTVTags()
    ↓
Write to metadata.json
    ↓
Return updated TV object
    ↓
Frontend updates TV list
```

---

## File System Structure

```
FRAME_ART_PATH/
├── library/                    # Original images
│   ├── landscape-a1b2c3d4.jpg  # UUID suffix prevents conflicts
│   ├── portrait-e5f6a7b8.jpg
│   └── ...
├── thumbs/                     # Generated thumbnails
│   ├── landscape-a1b2c3d4.jpg  # Same filename as original
│   ├── portrait-e5f6a7b8.jpg   # 400x300px, JPEG quality 85
│   └── ...
└── metadata.json               # All metadata
```

### metadata.json Schema
```json
{
  "images": {
    "filename.jpg": {
      "filename": "landscape-a1b2c3d4.jpg",
      "matte": "square_white",
      "filter": "none",
      "tags": ["landscape", "nature"],
      "added": "2025-01-15T10:30:00.000Z",
      "dimensions": {
        "width": 3840,
        "height": 2160
      }
    }
  },
  "tvs": [
    {
      "id": "1234567890",
      "name": "Living Room TV",
      "ip": "192.168.1.100",
      "added": "2025-01-15T09:00:00.000Z",
      "tags": ["landscape", "abstract"]
    }
  ],
  "tags": ["landscape", "portrait", "abstract", "nature"]
}
```

---

## Security Considerations

### Current Implementation
- **Input Sanitization**: Filename sanitization (alphanumeric + hyphens)
- **File Type Validation**: Multer accepts only image/* MIME types
- **Path Traversal Prevention**: Using path.basename() for filenames
- **No Authentication**: Designed for local network use

### Future Enhancements
- Add authentication middleware
- Rate limiting for uploads
- File size limits (configurable)
- HTTPS support for production
- Home Assistant OAuth integration

---

## Performance Considerations

### Current Optimizations
- **Thumbnail Generation**: Reduces load times in gallery
- **Client-Side Filtering**: No server round-trip for search/filter/sort
- **Sharp Library**: Fast, efficient image processing
- **Static File Serving**: Express.static for direct file access

### Future Optimizations
- **Lazy Loading**: Load images as user scrolls
- **Image Caching**: Browser cache headers
- **Pagination**: Limit initial data load
- **Web Workers**: Offload heavy client operations
- **Compression**: Gzip/Brotli middleware

---

## Error Handling Strategy

### Backend
```javascript
try {
  // Operation
  res.json({ success: true, data })
} catch (error) {
  console.error('Operation failed:', error)
  res.status(500).json({ error: error.message })
}
```

### Frontend
```javascript
try {
  const response = await fetch(url, options)
  const result = await response.json()
  if (result.success) {
    // Handle success
  }
} catch (error) {
  console.error('Request failed:', error)
  alert('Operation failed')
}
```

---

## Configuration

### Environment Variables
- `FRAME_ART_PATH` (required) - Path to frame art library
- `PORT` (optional) - Server port (default: 8099)

### Development Setup
```bash
export FRAME_ART_PATH="/path/to/frame_art"
npm install
npx nodemon server.js
```

### Production Setup
```bash
export FRAME_ART_PATH="/config/www/frame_art"
npm start
```

---

## Testing Strategy

### Current State
- Manual testing via web interface
- Console logging for debugging
- Error alerts to user

### Future Testing
- **Unit Tests**: Jest for helper functions
- **Integration Tests**: Supertest for API endpoints
- **E2E Tests**: Playwright for UI workflows
- **Test Coverage**: Aim for 80%+ coverage

---

## Deployment

### Development
- Runs directly on host machine
- Port 8099 exposed
- Hot reload with nodemon

### Production (Future)
- Docker container
- Home Assistant Add-on
- Volume mounts for data
- Health checks
- Logging to stdout

---

## Dependencies

### Production Dependencies
```json
{
  "express": "^4.18.2",
  "multer": "^1.4.5-lts.1",
  "sharp": "^0.32.1",
  "cors": "^2.8.5"
}
```

### Development Dependencies
```json
{
  "nodemon": "^2.0.22"
}
```

---

## Browser Compatibility

### Target Browsers
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS 14+, Android Chrome)

### Required Features
- Fetch API
- ES6 (arrow functions, const/let, template literals)
- CSS Flexbox/Grid
- File API (for uploads)

---

## Future Architecture Improvements

### Planned Changes
- **Database**: Migrate from JSON to SQLite or PostgreSQL
- **Real-time Updates**: WebSocket for live sync
- **Caching Layer**: Redis for frequently accessed data
- **Queue System**: Bull for background jobs (thumbnail generation)
- **API Versioning**: /api/v1, /api/v2 for backwards compatibility
- **GraphQL**: Alternative to REST for flexible queries
