# Frame Art Manager - Node.js Application

This is the web application component of the Frame Art Manager Home Assistant add-on.

## Features Implemented

### ✅ Phase 2 Step 3: Web Interface Features
- **Image Upload** - Upload new artwork images with metadata
- **Tag Management** - Create and manage tags for organizing artwork
- **Matte/Filter Selection** - Choose mattes and filters per image
- **Image Gallery** - View all artwork with thumbnails and infinite scroll support
- **Image Delete** - Remove unwanted images from library
- **Search & Filter** - Find images by name or tag
- **Sync Verification** - Check consistency between files and metadata

> **Note:** TV discovery, assignment, and scheduling now live inside the Home Assistant integration. The add-on focuses solely on library management (images, tags, sync).

## 🎨 Curated Filter Set (October 2025)

The editor now ships with a focused collection of filters tuned specifically for Samsung Frame art mode. Each recipe has a twin on the backend (Sharp) and frontend (CSS) so the preview matches the final render. Choose **None** to bypass any processing when you want the original image.

| Filter | Style & Use Case | Tonal Highlights | Example Inspiration |
| --- | --- | --- | --- |
| None | Original artwork | No processing applied | — |
| Sunlit Sienna | Earthy travel shots | Muted sienna midtones | [Earth tone palettes](https://www.design-seeds.com/palette/earth-tones/) |
| Coastal Breeze | Airy coastal scenes | Cool cyan lift, crisp whites | [Cool tone editing](https://www.photoworkout.com/cool-tone-photography/) |
| Pastel Wash | Illustrations and prints | Gentle saturation, blush tint | [Pastel color grading](https://helpx.adobe.com/lightroom/how-to/pastel-photo-effect.html) |
| Film Classic | General purpose filmic | Slight saturation bump, rich blacks | [Classic film emulation](https://petapixel.com/film-vs-digital-color/) |
| Noir Cinema | High drama B&W | Crisp highlights, inky blacks | [B&W contrast guide](https://photography.tutsplus.com/articles/creating-dramatic-black-and-white-landscapes--photo-14817) |
| Silver Pearl | Soft monochrome | Bright whites, gentle contrast | [Soft monochrome looks](https://digital-photography-school.com/3-simple-steps-soft-black-white-portraits/) |
| Graphite Ink | Sketch-inspired artwork | Linear edges, midtone depth | [Ink illustration styles](https://www.skillshare.com/en/blog/inking-techniques/) |

### 🔧 API Endpoints
- `GET /api/images` - Get all images
- `GET /api/images/tag/:tagName` - Get images by tag
- `POST /api/images/upload` - Upload new image
- `PUT /api/images/:filename` - Update image metadata
- `DELETE /api/images/:filename` - Delete image
- `POST /api/images/:filename/thumbnail` - Generate thumbnail
- `GET /api/images/verify` - Verify sync status

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
- `FRAME_ART_HOME` - Optional label for the physical location (e.g., `Madrone`)
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
- [ ] Add batch operations
- [ ] Add image preview with matte/filter simulation
- [ ] Add drag-and-drop upload
