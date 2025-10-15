# Web Interface Features Documentation

## Overview
The Frame Art Manager provides a comprehensive web interface for managing Samsung Frame TV artwork. This document describes all implemented UI features and their interactions.

## Tab Structure

The interface uses a tabbed navigation system with 6 main sections:

1. **Gallery** - View, search, filter, and manage images
2. **Upload** - Upload new images with metadata
3. **TVs** - Manage TV devices and their display settings
4. **Tags** - Manage tag library
5. **Sync** - Git LFS synchronization (placeholder)
6. **Advanced** - Metadata viewer and system info

---

## Gallery Tab

### Image Grid
- Displays all images as cards in a responsive grid
- Each card shows:
  - Thumbnail (400x300px, generated with sharp)
  - Image name (base name without UUID)
  - Tags as colored badges
  - Date added (bottom right, light gray)
  - Selection checkbox (for bulk operations)

### Toolbar (Compact Design)

**Search** (🔍 icon)
- Text input for filtering images by name
- Real-time search as you type
- Case-insensitive matching

**Tag Filter** (🏷️ icon)
- Custom multi-select dropdown with checkboxes
- Shows all available tags
- Button text updates dynamically:
  - "All Tags" when none selected
  - Tag name when one selected
  - "N tags selected" when multiple selected
- OR logic: Shows images with ANY of the selected tags
- Click outside to close dropdown

**Sort Controls**
- Dropdown with options:
  - Name (alphabetical)
  - Date Added (chronological)
- Direction toggle button (⬆/⬇)
  - Click to switch between ascending/descending
  - Icon updates to show current direction

### Bulk Operations

**Multi-Select Mode**
- Click checkbox on any image card to enter multi-select mode
- Bulk actions toolbar appears showing:
  - Number of images selected
  - "Tag Selected" button
  - "Clear Selection" button

**Bulk Tagging**
- Click "Tag Selected" to open bulk tag modal
- Enter comma-separated tags
- Tags are ADDED to existing tags (not replaced)
- All selected images updated at once

### Image Detail Modal

**Opening**
- Click anywhere on an image card (except checkbox)
- Modal displays with:
  - Full-size image preview
  - Image details and editing controls

**Image Name**
- Displays base name (without UUID suffix)
- Pencil icon (✏️) to enable editing
- Click pencil → inline form appears
- Enter new name (automatically sanitized)
- UUID suffix preserved on save
- Files, thumbnails, and metadata all updated

**Metadata Display**
- Full filename (with UUID)
- Resolution (width x height)

**Editing Controls**
- **Matte**: Dropdown with 7 options
  - None (default)
  - Square White/Black/Beige
  - Modern White/Black/Beige
- **Filter**: Dropdown with 5 options
  - None (default)
  - Sepia, Grayscale, Warm, Cool
- **Tags**: Comma-separated text input
  - Add/remove tags
  - Tags autocreate if they don't exist

**Action Buttons**
- Save Changes (blue) - Updates metadata
- Delete Image (red) - Removes image with confirmation

---

## Upload Tab

### Upload Form

**Image Selection**
- File input with accept="image/*"
- Mobile: Offers camera option (capture="environment")
- Desktop: File picker

**Metadata Fields**
- **Matte**: Dropdown (default: none)
- **Filter**: Dropdown (default: none)
- **Tags**: Comma-separated text input
- All fields optional except image file

**Upload Process**
1. Select image file
2. (Optional) Set matte, filter, tags
3. Click "Upload Image"
4. Server processes:
   - Saves original to `library/`
   - Generates thumbnail to `thumbs/`
   - Adds entry to metadata.json
5. Redirects to Gallery tab on success

---

## TVs Tab

### TV List (Read-Only View)

Each TV row displays:
- **TV Name** (bold, primary text)
- **IP Address** (gray, secondary text)
- **Tag Status** (gray, shows tag selection)
  - "All images" when no tags selected
  - Tag name when one tag selected
  - "N tags selected" when multiple selected

**Interaction**
- Rows are clickable (hover effect shows interactivity)
- Click any row to open TV detail modal

### Add TV Form

**Fields**
- TV Name (text input, required)
- IP Address (text input, required, placeholder: "192.168.1.100")
- Click "Add TV" to create

### TV Detail Modal

**Opened by clicking a TV row**

**Editable Fields**
- **TV Name**: Text input
- **IP Address**: Text input
- **Display Tags**: Multi-select dropdown with checkboxes
  - Shows all available tags
  - Select which tags this TV should display
  - Button text updates like gallery tag filter
  - Empty = show all images

**Read-Only Info**
- Date Added (formatted as "Jan 5, 2025")

**Action Buttons**
- Save Changes (blue) - Updates TV
- Delete TV (red) - Removes TV with confirmation
- Cancel (gray) - Close without saving

**Tag Filtering Logic**
When displaying images on a TV:
- No tags selected → Show all images from library
- Tags selected → Show only images with at least one matching tag

---

## Tags Tab

### Tag Management

**Add New Tag**
- Text input + "Add Tag" button
- Tag names are case-sensitive
- Duplicates prevented

**Tag List (Tag Cloud)**
- Displays all tags as styled badges
- Each tag shows:
  - Tag name
  - Delete button (×)
- Click delete to remove tag
- Confirmation before deletion
- Deleting tag removes it from all images

---

## Sync Tab

**Placeholder for future Git LFS functionality**
- Verify Sync button (placeholder)
- Will show sync status and allow manual sync operations

---

## Advanced Tab

### System Information

**Library Path**
- Displays configured FRAME_ART_PATH
- Shows where images are stored

### Metadata Viewer

**View Metadata Button**
- Click to load and display raw metadata.json
- Shows formatted JSON in code block
- Useful for debugging and verification

---

## UI Design Principles

### Visual Design
- **Clean & Compact**: Minimal padding, efficient use of space
- **Professional**: Subtle hover effects, consistent styling
- **Responsive**: Works on desktop and mobile devices
- **Icons**: Visual cues (🔍 search, 🏷️ tags, ⬆⬇ sort direction)

### Color Scheme
- Background: #f5f5f5 (light gray)
- Cards: #ffffff (white)
- Primary: #3498db (blue)
- Danger: #e74c3c (red)
- Secondary: #95a5a6 (gray)
- Text: #2c3e50 (dark gray)
- Secondary text: #7f8c8d (medium gray)

### Interaction Patterns
- **Modal-based editing**: Click to open detail view
- **Inline editing**: Pencil icon enables inline forms
- **Hover feedback**: Visual response to cursor
- **Click-outside to close**: Dropdowns and modals
- **Confirmation for destructive actions**: Delete operations

### Typography
- Font: System fonts (-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, etc.)
- Hierarchy: H1 (2.5rem) → H2 (1.8rem) → H3 (1.3rem) → Body (1rem)

---

## Keyboard & Accessibility

### Form Inputs
- All inputs have labels
- Required fields marked
- Placeholders provide examples
- Tab navigation supported

### Buttons
- Clear visual states (default, hover, active)
- Appropriate button types (submit, button)
- Disabled states where applicable

---

## State Management

### Client-Side State
- `allImages` - Array of all image metadata
- `allTags` - Array of all tag names
- `allTVs` - Array of all TV configurations
- `selectedImages` - Set of selected image filenames (for bulk operations)
- `currentImageFilename` - Currently viewed image in modal
- `currentTVId` - Currently edited TV in modal
- `sortAscending` - Sort direction boolean

### Persistence
- All state persisted in backend metadata.json
- Client fetches on page load and after mutations
- Optimistic UI updates followed by server sync

---

## Performance Optimizations

### Image Loading
- Thumbnails used in gallery (400x300px)
- Lazy loading possible for large galleries
- Full-size images loaded only in detail modal

### Data Loading
- Initial load fetches all data
- Updates fetch only changed items
- No automatic polling (manual refresh required)

### Search & Filter
- Client-side filtering for instant response
- No server round-trip for search/filter/sort

---

## Error Handling

### User Feedback
- Alerts for errors (delete confirmation, save errors)
- Console logging for debugging
- Graceful degradation (empty states)

### Empty States
- "No images yet" in gallery
- "No TVs added yet" in TV list
- "No tags yet" in tag list

---

## Future Enhancements

### Possible Improvements
- **Infinite scroll** for large image galleries
- **Drag & drop reordering** for priority/sequence
- **Image preview on hover** in gallery
- **Advanced search** with multiple criteria
- **Tag autocomplete** in input fields
- **Batch upload** multiple files at once
- **TV connection testing** verify TV is reachable
- **Image statistics** usage tracking, most displayed
- **Export/Import** backup and restore metadata
