# API Documentation

## Overview
RESTful API for managing Frame Art Manager data. All endpoints return JSON.

Base URL: `http://localhost:8099/api`

---

## Images API

### Get All Images
```
GET /api/images
```

**Response:**
```json
[
  {
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
]
```

### Get Single Image
```
GET /api/images/:filename
```

**Response:**
```json
{
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
```

### Upload Image
```
POST /api/images
Content-Type: multipart/form-data
```

**Body:**
- `image` (file, required) - Image file
- `matte` (string, optional) - Matte type (default: "none")
- `filter` (string, optional) - Filter type (default: "none")
- `tags` (string, optional) - Comma-separated tags

**Response:**
```json
{
  "success": true,
  "filename": "myimage-e5f6a7b8.jpg",
  "message": "Image uploaded successfully"
}
```

**Process:**
1. Generates UUID suffix for filename
2. Saves original to `library/`
3. Generates thumbnail to `thumbs/`
4. Extracts dimensions
5. Adds metadata entry
6. Returns new filename with UUID

### Update Image Metadata
```
PUT /api/images/:filename
Content-Type: application/json
```

**Body:**
```json
{
  "matte": "modern_black",
  "filter": "sepia",
  "tags": ["vintage", "portrait"]
}
```

**Response:**
```json
{
  "success": true,
  "image": {
    "filename": "portrait-a1b2c3d4.jpg",
    "matte": "modern_black",
    "filter": "sepia",
    "tags": ["vintage", "portrait"],
    "added": "2025-01-15T10:30:00.000Z",
    "dimensions": {
      "width": 2160,
      "height": 3840
    }
  }
}
```

### Rename Image
```
POST /api/images/:filename/rename
Content-Type: application/json
```

**Body:**
```json
{
  "newBaseName": "sunset-beach"
}
```

**Response:**
```json
{
  "success": true,
  "oldFilename": "landscape-a1b2c3d4.jpg",
  "newFilename": "sunset-beach-a1b2c3d4.jpg"
}
```

**Process:**
1. Extracts UUID from old filename
2. Sanitizes new base name (lowercase, alphanumeric + hyphens)
3. Checks for conflicts
4. Renames library file
5. Renames thumbnail file
6. Updates metadata entry
7. Returns both filenames

**Sanitization Rules:**
- Converts to lowercase
- Replaces spaces and underscores with hyphens
- Removes special characters
- Preserves original UUID suffix

### Delete Image
```
DELETE /api/images/:filename
```

**Response:**
```json
{
  "success": true,
  "message": "Image deleted successfully"
}
```

**Process:**
1. Deletes library file
2. Deletes thumbnail file
3. Removes metadata entry
4. Returns confirmation

### Bulk Tag Images
```
POST /api/images/bulk-tag
Content-Type: application/json
```

**Body:**
```json
{
  "filenames": ["image1-uuid.jpg", "image2-uuid.jpg"],
  "tags": ["new-tag", "another-tag"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tags added to 2 images"
}
```

**Process:**
- Adds tags to existing tags (does not replace)
- Creates new tags in library if they don't exist
- Updates metadata for all specified images

---

## TVs API

### Get All TVs
```
GET /api/tvs
```

**Response:**
```json
[
  {
    "id": "1234567890",
    "name": "Living Room TV",
    "ip": "192.168.1.100",
    "added": "2025-01-15T09:00:00.000Z",
    "tags": ["landscape", "abstract"]
  }
]
```

### Add TV
```
POST /api/tvs
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Bedroom TV",
  "ip": "192.168.1.101"
}
```

**Response:**
```json
{
  "success": true,
  "tv": {
    "id": "1234567891",
    "name": "Bedroom TV",
    "ip": "192.168.1.101",
    "added": "2025-01-15T11:00:00.000Z",
    "tags": []
  }
}
```

**Process:**
- Generates unique ID (timestamp)
- Creates TV entry with empty tags array
- Adds to metadata
- Returns new TV object

### Update TV Details
```
PUT /api/tvs/:tvId
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Main Living Room TV",
  "ip": "192.168.1.100"
}
```

**Response:**
```json
{
  "success": true,
  "tv": {
    "id": "1234567890",
    "name": "Main Living Room TV",
    "ip": "192.168.1.100",
    "added": "2025-01-15T09:00:00.000Z",
    "tags": ["landscape"]
  }
}
```

### Update TV Tags
```
PUT /api/tvs/:tvId/tags
Content-Type: application/json
```

**Body:**
```json
{
  "tags": ["landscape", "nature", "abstract"]
}
```

**Response:**
```json
{
  "success": true,
  "tv": {
    "id": "1234567890",
    "name": "Living Room TV",
    "ip": "192.168.1.100",
    "added": "2025-01-15T09:00:00.000Z",
    "tags": ["landscape", "nature", "abstract"]
  }
}
```

**Tag Filtering Logic:**
- Empty `tags` array → TV displays all images
- Non-empty `tags` array → TV displays only images with at least one matching tag

### Delete TV
```
DELETE /api/tvs/:tvId
```

**Response:**
```json
{
  "success": true,
  "message": "TV removed successfully"
}
```

### Test TV Connection
```
POST /api/tvs/:tvId/test
```

**Response:**
```json
{
  "success": true,
  "message": "Connection test not yet implemented",
  "tv": {
    "id": "1234567890",
    "name": "Living Room TV",
    "ip": "192.168.1.100"
  }
}
```

**Note:** Placeholder endpoint for future TV connectivity testing.

---

## Tags API

### Get All Tags
```
GET /api/tags
```

**Response:**
```json
["landscape", "portrait", "abstract", "nature", "urban"]
```

### Add Tag
```
POST /api/tags
Content-Type: application/json
```

**Body:**
```json
{
  "name": "new-tag"
}
```

**Response:**
```json
{
  "success": true,
  "tag": "new-tag"
}
```

**Process:**
- Checks for duplicates
- Adds to tags array in metadata
- Returns new tag

### Delete Tag
```
DELETE /api/tags/:tag
```

**Response:**
```json
{
  "success": true,
  "message": "Tag 'landscape' removed from library"
}
```

**Process:**
- Removes tag from library array
- Removes tag from all images
- Updates metadata

---

## Health & System API

### Health Check
```
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "frameArtPath": "/config/www/frame_art",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

**Use Cases:**
- Verify server is running
- Check configured library path
- System status monitoring

---

## Static File Routes

### Serve Image
```
GET /library/:filename
```
Returns original image file from library directory.

### Serve Thumbnail
```
GET /thumbs/:filename
```
Returns thumbnail image (400x300px).

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Name and IP are required"
}
```

### 404 Not Found
```json
{
  "error": "Image not found"
}
```

### 409 Conflict
```json
{
  "error": "An image with name 'sunset-beach-a1b2c3d4.jpg' already exists"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to upload image"
}
```

---

## Data Models

### Image Metadata
```typescript
{
  filename: string,        // Full filename with UUID suffix
  matte: string,          // Matte type (default: "none")
  filter: string,         // Filter type (default: "none")
  tags: string[],         // Array of tag strings
  added: string,          // ISO 8601 timestamp
  dimensions: {
    width: number,        // Pixel width
    height: number        // Pixel height
  }
}
```

### TV Configuration
```typescript
{
  id: string,             // Unique ID (timestamp)
  name: string,           // Display name
  ip: string,             // IP address
  added: string,          // ISO 8601 timestamp
  tags: string[]          // Filter tags (empty = show all)
}
```

### Metadata.json Structure
```json
{
  "images": {
    "filename1.jpg": { /* image metadata */ },
    "filename2.jpg": { /* image metadata */ }
  },
  "tvs": [
    { /* tv configuration */ }
  ],
  "tags": [
    "tag1",
    "tag2"
  ]
}
```

---

## UUID System

Images use UUID suffixes to prevent naming conflicts:
- Pattern: `basename-uuid.ext`
- Example: `landscape-a1b2c3d4.jpg`
- UUID: 8 character hex string
- Preserved during rename operations
- Generated during upload using `crypto.randomBytes(4)`

---

## File Organization

```
FRAME_ART_PATH/
├── library/              # Original images
│   ├── image1-uuid.jpg
│   ├── image2-uuid.jpg
│   └── ...
├── thumbs/               # Thumbnails (400x300)
│   ├── image1-uuid.jpg
│   ├── image2-uuid.jpg
│   └── ...
└── metadata.json         # All metadata
```

---

## Future Endpoints (Planned)

### Sync Operations
```
POST /api/sync/pull      # Pull from Git LFS
POST /api/sync/push      # Push to Git LFS
GET /api/sync/status     # Check sync status
```

### AppDaemon Integration
```
POST /api/display        # Display image on TV
POST /api/shuffle/start  # Start shuffle mode
POST /api/shuffle/stop   # Stop shuffle mode
```
