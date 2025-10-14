# Utility Scripts

This folder contains one-time migration and utility scripts.

## migrate-dimensions.js

Analyzes all existing images in the library and adds dimension and aspect ratio metadata.

**When to use:**
- After bulk importing images outside the upload interface
- After restoring from a backup with old metadata format
- When aspect ratio data is missing for existing images

**Usage:**
```bash
cd /path/to/frame_art_manager/app
FRAME_ART_PATH="/path/to/frame_art" node scripts/migrate-dimensions.js
```

**What it does:**
- Reads all images from metadata.json
- Uses Sharp to analyze each image's dimensions
- Calculates aspect ratio (width/height)
- Updates metadata.json with dimensions and aspectRatio fields
- Skips images that already have this data

**Output:**
- Shows progress for each image
- Indicates 16:9 images with [16:9] tag
- Provides summary of updated/skipped/errored images
