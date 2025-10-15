# Frame Art Manager - Node.js Application

This is the web application component of the Frame Art Manager Home Assistant add-on.

## Features Implemented

### ✅ Phase 2 Step 3: Web Interface Features
- **Image Upload** - Upload new artwork images with metadata
- **Tag Management** - Create and manage tags for organizing artwork
- **Matte/Filter Selection** - Choose mattes and filters per image
- **TV Management** - Add and manage multiple Samsung Frame TV IPs
- **Image Gallery** - View all artwork with thumbnails and infinite scroll support
- **Image Delete** - Remove unwanted images from library
- **Search & Filter** - Find images by name or tag
- **Sync Verification** - Check consistency between files and metadata

### 🔧 API Endpoints
- `GET /api/images` - Get all images
- `GET /api/images/tag/:tagName` - Get images by tag
- `POST /api/images/upload` - Upload new image
- `PUT /api/images/:filename` - Update image metadata
- `DELETE /api/images/:filename` - Delete image
- `POST /api/images/:filename/thumbnail` - Generate thumbnail
- `GET /api/images/verify` - Verify sync status

- `GET /api/tvs` - Get all TVs
- `POST /api/tvs` - Add new TV
- `DELETE /api/tvs/:tvId` - Remove TV
- `POST /api/tvs/:tvId/test` - Test TV connection

- `GET /api/tags` - Get all tags
- `POST /api/tags` - Add new tag
- `DELETE /api/tags/:tagName` - Remove tag

- `GET /api/health` - Health check endpoint

## Local Development

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Setup

1. Install dependencies:
```bash
cd frame_art_manager/app
npm install
```

2. Create a `.env` file from the template:
```bash
cp .env.example .env
```

3. Edit `.env` and set your frame art path:
```bash
FRAME_ART_PATH=/path/to/your/ha-config/www/frame_art
```

4. Start the development server:
```bash
npm start
```

Or for auto-reload during development:
```bash
npm run dev
```

5. Open your browser to: `http://localhost:8099`

### Environment Variables

- `FRAME_ART_PATH` - Path to the frame art library (required for development)
- `PORT` - Server port (default: `8099`)

### Directory Structure

When running, the app expects this structure in `FRAME_ART_PATH`:
```
frame_art/
├── metadata.json      # Image metadata and TV list
├── library/          # Original images
└── thumbs/           # Generated thumbnails
```

The app will automatically create these directories if they don't exist.

## Tech Stack

- **Backend**: Express.js
- **Image Processing**: Sharp (for thumbnail generation)
- **File Upload**: Multer
- **Git Operations**: simple-git (for future Git LFS sync)
- **Frontend**: Vanilla JavaScript with modern CSS

## Next Steps

- [ ] Implement Git LFS sync operations
- [ ] Add AppDaemon service integration (display, shuffle)
- [ ] Implement TV connection testing
- [ ] Add batch operations
- [ ] Add image preview with matte/filter simulation
- [ ] Add drag-and-drop upload
