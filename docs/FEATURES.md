# Features Guide

User guide for Frame Art Manager's web interface.

---

## Interface Overview

The app has 6 tabs:
1. **Gallery** - Browse and manage images
2. **Upload** - Add new images
3. **TVs** - Configure TV devices
4. **Tags** - Manage tag library
5. **Sync** - Git operations (coming soon)
6. **Advanced** - System info (coming soon)

---

## Gallery Tab

### Image Grid

Images display as cards with:
- Thumbnail preview
- Image name (without UUID)
- Tags as colored badges
- Date added
- Selection checkbox

### Toolbar

**Search** (🔍)
- Type to filter images by name
- Real-time, case-insensitive

**Tag Filter** (🏷️)
- Multi-select dropdown with checkboxes
- Button shows:
  - "All Tags" (none selected)
  - Tag name (one selected)
  - "N tags selected" (multiple selected)
- OR logic: shows images with ANY selected tag

**Sort**
- Dropdown: Name or Date Added
- Direction button (⬆/⬇): click to toggle
- Combines with search and filter

### Bulk Operations

**Selecting Images:**
- Click checkbox on any card
- Select multiple images
- Toolbar shows selection count

**Bulk Actions:**
- "Tag Selected" - Add tags to all selected
- "Clear Selection" - Deselect all

**Bulk Tag Modal:**
- Enter comma-separated tags
- Tags ADDED to existing (not replaced)
- All selected images updated at once

### Image Detail Modal

**Open:** Click any image card (except checkbox)

**Name Editing:**
- Click pencil icon (✏️) next to name
- Inline form appears
- Enter new name (auto-sanitized)
- UUID suffix preserved
- Updates file, thumbnail, and metadata

**Metadata:**
- Full filename with UUID
- Resolution (width × height)
- Date added

**Edit Controls:**
- **Matte**: Dropdown with 7 options
  - None, Square White/Black/Beige, Modern White/Black/Beige
- **Filter**: Dropdown with 5 options
  - None, Sepia, Grayscale, Warm, Cool
- **Tags**: Comma-separated text input
  - Add/remove tags inline
  - Auto-creates new tags

**Actions:**
- Save Changes
- Delete Image (with confirmation)
- Close (or click outside modal)

---

## Upload Tab

### Drag & Drop Upload

**Drop Zone:**
- Large dashed border area
- "Drag & drop image here or click to browse"
- Highlights on drag-over

**Multiple Files:**
- Select multiple in file picker
- Uploads sequentially

### Upload Form

**Fields:**
- **Custom Name** (optional)
  - Auto-sanitized on upload
  - Gets UUID suffix
- **Matte**: Dropdown (default: None)
- **Filter**: Dropdown (default: None)
- **Tags**: Comma-separated text input

**Process:**
1. File saved to `library/`
2. UUID suffix added
3. Thumbnail generated (400×300px)
4. Metadata saved
5. Redirects to Gallery

---

## TVs Tab

### TV List

Shows all configured TVs with:
- TV name
- IP address
- Assigned tags (or "All images")
- Click any row to open detail modal

### Add TV Form

**Fields:**
- Name (e.g., "Living Room TV")
- IP Address (e.g., "192.168.1.100")
- Home (dropdown: Madrone or Maui)

**Submit:** Adds TV to list

### TV Detail Modal

**Open:** Click any TV row

**View/Edit:**
- TV Name (editable text input)
- IP Address (editable text input)
- Home (dropdown: Madrone or Maui)

**Tag Selection:**
- Multi-select dropdown
- Assign tags to control what displays
- Empty = all images
- With tags = only images matching those tags

**Actions:**
- Save Changes
- Delete TV (with confirmation)
- Close (or click outside)

---

## Tags Tab

### Tag List

Shows all tags with:
- Tag name
- Delete button (×)

**Delete:**
- Click × button
- Confirms action
- Removes from library AND all images

### Add Tag Form

**Field:**
- Tag name (text input)

**Submit:**
- Adds to library
- Available in all dropdowns

---

## Sync Tab

*Coming soon: Manual Git LFS operations*

**Planned:**
- Pull latest changes button
- Push local changes button
- Sync status indicator
- Last sync timestamp
- Conflict resolution

---

## Advanced Tab

*Coming soon: System information and metadata viewer*

**Planned:**
- Raw metadata.json viewer
- Library statistics (file count, total size)
- Orphaned file detection
- Cache management
- Health check status

---

## Common Workflows

### Upload New Image

1. Go to Upload tab
2. Drag & drop or click to browse
3. (Optional) Enter custom name
4. Select matte and filter
5. Add tags (comma-separated)
6. Click Upload
7. Redirected to Gallery

### Organize Existing Images

1. Go to Gallery tab
2. Click image card
3. Edit metadata:
   - Rename (click pencil icon)
   - Change matte/filter
   - Add/remove tags
4. Click Save Changes

### Bulk Tag Multiple Images

1. Go to Gallery tab
2. Click checkboxes on desired images
3. Click "Tag Selected" button
4. Enter tags (comma-separated)
5. Click Apply
6. All selected images updated

### Configure TV Display

1. Go to TVs tab
2. Click TV row to open modal
3. Select tags in dropdown
4. Click Save Changes
5. TV will only show images with those tags

### Filter Gallery by Tags

1. Go to Gallery tab
2. Click tag filter button (🏷️)
3. Check desired tags in dropdown
4. Gallery updates (OR logic - any match)
5. Click outside to close dropdown

### Search and Sort

1. Go to Gallery tab
2. Type in search box (🔍)
3. Select sort option (Name/Date)
4. Toggle direction (⬆/⬇)
5. Gallery updates in real-time

---

## Keyboard Shortcuts

*Note: Keyboard shortcuts not yet implemented*

**Planned:**
- `Esc` - Close modal
- `Ctrl+A` - Select all images
- `Ctrl+D` - Deselect all
- `Delete` - Delete selected images
- `/` - Focus search box

---

## Visual Design

### Color Scheme
- Background: Light gray (#f5f5f5)
- Cards: White with hover effect
- Primary buttons: Blue (#007bff)
- Danger buttons: Red (#dc3545)
- Tag badges: Multiple colors (rotate per tag)

### Layout
- Responsive grid (auto-fit columns)
- Compact toolbar with icons
- Modals centered with backdrop
- Consistent spacing (10-20px gaps)

### Interactions
- Hover effects on cards (scale + shadow)
- Smooth transitions (0.2s)
- Click-outside to close dropdowns
- Visual feedback on selection

---

## Data Model

### Image Metadata
```javascript
{
  "filename": "landscape-a1b2c3d4.jpg",
  "matte": "square_white",
  "filter": "none",
  "tags": ["landscape", "nature"],
  "dimensions": {"width": 3840, "height": 2160},
  "aspectRatio": 1.78,
  "added": "2025-10-15T10:30:00.000Z"
}
```

### TV Configuration
```javascript
{
  "id": "1234567890",
  "name": "Living Room TV",
  "ip": "192.168.1.100",
  "home": "Madrone",
  "tags": ["landscape"],
  "added": "2025-10-15T09:00:00.000Z"
}
```

### Tag Library
```javascript
["landscape", "portrait", "nature", "abstract"]
```

---

## Tips & Tricks

### Organizing Images

**Use descriptive tags:**
- Orientation: `landscape`, `portrait`, `square`
- Subject: `nature`, `abstract`, `people`
- Color: `warm`, `cool`, `monochrome`
- Season: `spring`, `summer`, `fall`, `winter`

**Name images clearly:**
- Use hyphens: `sunset-beach`, not `sunset_beach`
- Lowercase preferred
- Avoid special characters

### Managing TVs

**Empty tags = all images:**
- Leave tags empty to show entire library
- Useful for "random" mode

**Specific tags = curated:**
- Assign 1-2 tags for themed displays
- Example: Living room = `landscape`
- Example: Bedroom = `nature, abstract`

### Bulk Operations

**Select strategically:**
- Use search/filter first to narrow down
- Then bulk-select and tag
- More efficient than one-by-one

**Tags are additive:**
- Bulk tagging ADDS tags, doesn't replace
- To remove tags, edit individually

---

## Troubleshooting

**Image won't upload:**
- Check file is image format (JPEG, PNG, HEIC, etc.)
- Verify file size < 50MB
- HEIC files are automatically converted to JPEG
- Check disk space

**Can't rename image:**
- Ensure new name only uses: letters, numbers, hyphens
- System auto-sanitizes invalid characters

**Tags not filtering correctly:**
- Remember: Filter uses OR logic (any match)
- Check tags are spelled correctly
- Tags are case-sensitive

**Modal won't close:**
- Click outside modal backdrop
- Or click Close button
- Refresh page if stuck

---

For technical details, see [DEVELOPMENT.md](DEVELOPMENT.md).  
For project status, see [STATUS.md](STATUS.md).
