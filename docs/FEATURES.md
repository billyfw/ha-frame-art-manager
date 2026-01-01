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
- Multi-select dropdown organized into sections:

**Filters Section** (at top):
- **Recently Displayed**: Shows images currently on TVs and recently removed
  - Displays count of unique images in filter
  - When active, shows overlay on each image with TV name and time
  - "Now" for current images, "Xm ago", "Xh ago", "Xd ago" for previous
  - Automatically sorts by most recent first
  - Hides redundant last-display info in card footer
- **Similar Images**: Find duplicate and visually similar images
  - Shows count as "(Xdup/Ysim)" - duplicates (very similar) and similar
  - Adjustable threshold slider when active
  - Groups related images together in the gallery
- **Non 16:9**: Filter images that aren't 16:9 aspect ratio
  - Useful for finding images that may not display well on Frame TVs

**TVs Section**:
- Quick shortcuts to see images matching each TV's tag criteria
- "None" option shows images that don't match any TV

**Tags Section**:
- Multi-select checkboxes for all tags
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
- **Matte**: Dropdown with Samsung Frame options
  - none, modernthin, modern, modernwide, flexible, shadowbox, panoramic, triptych, mix, squares
- **Filter**: Dropdown with Samsung art filters
  - None, Aqua, ArtDeco, Ink, Wash, Pastel, Feuve
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

The Tags tab has two main sections: **Manage Tagsets** and **TV Tagset Assignments**.

### Manage Tagsets

Tagsets are named collections of include/exclude tags that can be assigned to TVs. They're defined globally (not per-TV), so the same tagset can be used by multiple TVs.

**Tagset Dropdown:**
- Select a tagset to view its details
- Shows include tags and exclude tags
- Displays which TVs are using this tagset

**Edit Tagset:**
- Click "Edit Tagset" button
- Opens modal with:
  - Tagset name (editable for rename)
  - Include tags (multi-select checkboxes)
  - Exclude tags (multi-select checkboxes)
- Renaming automatically updates all TV assignments

**Delete Tagset:**
- Click "Delete" button (requires confirmation)
- Cannot delete if any TV is using it (shows which TV)
- Cannot delete the only tagset

**New Tagset:**
- Click "+ New Tagset" button
- Opens modal to create a new tagset
- Requires at least one include tag

### TV Tagset Assignments

Grid of cards showing each TV's tagset configuration:

**For Each TV:**
- **Selected Tagset**: Dropdown to choose permanent tagset
- **Override Status**: Shows active override and expiry time
- **Override Button**: Apply temporary tagset override
- **Clear Button**: Remove active override early

**Applying an Override:**
1. Click "Override" button on TV card
2. Select tagset and duration (30min to 24h, or custom)
3. Override shows expiry countdown
4. Automatically reverts when duration expires
5. Or click "Clear" to revert early

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

### Find Recently Displayed Images

1. Go to Gallery tab
2. Click tag filter button (🏷️)
3. Check "Recently Displayed" in the Filters section
4. Gallery shows:
   - Images currently displaying on any TV (marked "Now")
   - Images that were previously displayed (marked with time ago)
5. Each image shows an overlay with TV name and when it was removed
6. Gallery automatically sorts by most recent first

### Find Similar/Duplicate Images

1. Go to Gallery tab
2. Click tag filter button (🏷️)
3. Check "Similar Images" in the Filters section
4. Dropdown shows count: "(Xdup/Ysim)"
   - Duplicates: very similar images (threshold ≤10)
   - Similar: visually similar images (threshold ≤38)
5. Use the threshold slider to adjust sensitivity
6. Similar images are grouped together with overlay showing related images

### Find Non-Standard Aspect Ratios

1. Go to Gallery tab
2. Click tag filter button (🏷️)
3. Check "Non 16:9" in the Filters section
4. Gallery shows only images that aren't 16:9 aspect ratio
5. Useful for identifying images that may not display well on Frame TVs

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
  "matte": "squares",
  "filter": "None",
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
