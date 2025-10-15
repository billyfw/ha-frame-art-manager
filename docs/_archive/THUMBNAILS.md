# Thumbnail System - How It Works

## Overview

The Frame Art Manager uses a two-tier image system for performance:

### 1. **Full Images** (`library/`)
- Original high-resolution images
- Used in the modal detail view
- Served from `/library/{filename}`

### 2. **Thumbnails** (`thumbs/`)
- Generated at 400x300px (max dimensions, maintains aspect ratio)
- Used in the gallery grid view
- Served from `/thumbs/thumb_{filename}`
- Named with `thumb_` prefix

---

## Performance Benefit

**Example with your test image:**
- **Full image**: `book1-2.jpg` = 2.4MB
- **Thumbnail**: `thumb_book1-2.jpg` = 41KB
- **Savings**: ~60x smaller! 

With 50 images in gallery:
- **Without thumbnails**: 50 × 2.4MB = 120MB downloaded 😱
- **With thumbnails**: 50 × 41KB = 2MB downloaded ✅

---

## How Thumbnails Are Created

### Automatic (on upload):
```javascript
// When you upload via the web interface
POST /api/images/upload
→ Saves to library/
→ Automatically generates thumbnail
→ Saves to thumbs/thumb_{filename}
```

### Manual (for existing images):
```bash
# Via API
curl -X POST http://localhost:8099/api/images/{filename}/thumbnail

# Or use the gallery - thumbnails are created on-demand
```

---

## Gallery Display Logic

```javascript
// Gallery tries thumbnail first, falls back to full image
<img src="/thumbs/thumb_book1-2.jpg" 
     onerror="this.src='/library/book1-2.jpg'" />
```

**Fallback behavior:**
1. Try to load thumbnail
2. If thumbnail doesn't exist → load full image
3. Full image gets scaled by CSS (not ideal, but works)

---

## Thumbnail Storage

```
frame_art/
├── library/
│   └── book1-2.jpg          (2.4MB - original)
├── thumbs/
│   └── thumb_book1-2.jpg    (41KB - thumbnail)
└── metadata.json
```

**Note:** Thumbnails are NOT stored in metadata.json - they're just files with a naming convention.

---

## Best Practices

### For New Images:
✅ Upload via the web interface → thumbnails auto-generated

### For Existing Images:
1. Add image to `library/` folder manually
2. Add entry to metadata.json (or use Sync tab)
3. Generate thumbnail via API or wait for first gallery view

### Cleanup:
- Deleting an image removes both the image AND its thumbnail
- Orphaned thumbnails (no matching image) won't cause issues

---

## Technical Details

**Generation:** Uses Sharp library
```javascript
sharp(imagePath)
  .resize(400, 300, {
    fit: 'inside',           // Maintains aspect ratio
    withoutEnlargement: true // Don't upscale small images
  })
  .toFile(thumbPath);
```

**Format:** Keeps original format (jpg stays jpg, png stays png)

---

## Metadata Field (Historical Note)

You might see old metadata with a `thumbnail` field:
```json
{
  "filename": "book1-2.jpg",
  "thumbnail": "IMG_4534.png"  // ← Old/unused field
}
```

This is **not used** by the current system. The app uses the `thumb_{filename}` convention instead.
