# TV Detail Modal Feature

## Overview
The TV management interface now uses a detail modal similar to the image gallery. TV rows are read-only and clickable - clicking a row opens a modal where you can edit all TV properties.

## User Interface

### TV List View (Read-Only)
Each TV row displays:
- **TV Name** (bold, primary text)
- **IP Address** (secondary text)
- **Tag Selection Status** (e.g., "All images", "landscape", or "3 tags selected")

Rows are clickable with hover effects to indicate interactivity.

### TV Detail Modal
Clicking a TV row opens a modal with:
- **TV Name** field (editable text input)
- **IP Address** field (editable text input)
- **Display Tags** selector (multi-select dropdown with checkboxes)
- **Date Added** (read-only, formatted as "Jan 5, 2025")
- **Action Buttons**:
  - Save Changes (primary)
  - Delete TV (danger)
  - Cancel (secondary)

## Technical Implementation

### Frontend Changes

#### HTML (`index.html`)
Added TV detail modal structure:
```html
<div id="tv-modal" class="modal">
  <div class="modal-content tv-modal">
    <!-- Modal content with form fields -->
  </div>
</div>
```

#### JavaScript (`app.js`)
**New Functions:**
- `openTVModal(tvId)` - Opens modal and populates with TV data
- `closeTVModal()` - Closes modal and resets state
- `updateTVModalTagsDisplay()` - Updates tag button text based on selections
- `saveTVModal()` - Saves all TV changes (name, IP, tags)
- `deleteTVFromModal()` - Deletes TV with confirmation
- `initTVModal()` - Sets up event listeners

**Modified Functions:**
- `renderTVList()` - Now renders clickable read-only rows instead of inline editors

**State:**
- `currentTVId` - Tracks which TV is being edited in the modal

#### CSS (`style.css`)
**New Styles:**
- `.list-item-clickable` - Hover and active states for clickable rows
- `.tv-modal` - Modal sizing and layout
- `.tv-modal-actions` - Button layout in modal
- `.modal-info` - Styling for read-only info section

### Backend Changes

#### API Endpoints

**New Endpoint:**
**PUT** `/api/tvs/:tvId`

Updates TV name and IP address.

Request body:
```json
{
  "name": "Living Room TV",
  "ip": "192.168.1.100"
}
```

Response:
```json
{
  "success": true,
  "tv": {
    "id": "1234567890",
    "name": "Living Room TV",
    "ip": "192.168.1.100",
    "added": "2025-01-15T10:00:00.000Z",
    "tags": ["landscape"]
  }
}
```

**Existing Endpoint (unchanged):**
**PUT** `/api/tvs/:tvId/tags` - Updates only the tags array

#### Metadata Helper (`metadata_helper.js`)

**New Method:**
```javascript
async updateTV(tvId, name, ip)
```
Updates the name and IP address for a specific TV in the metadata.

## User Flow

1. **View TVs** - Navigate to the TVs tab to see all configured TVs
2. **Select TV** - Click on any TV row to open the detail modal
3. **Edit Details** - Modify name, IP address, or tag selections
4. **Save Changes** - Click "Save Changes" to persist updates
5. **Delete TV** (optional) - Click "Delete TV" to remove the TV (with confirmation)
6. **Cancel** - Click "Cancel" or the X to close without saving

## Benefits

### User Experience
- **Cleaner Interface** - TV list is more compact without inline controls
- **Familiar Pattern** - Matches the image detail modal pattern
- **Better Mobile Support** - Modal works better on small screens than inline editing
- **Focused Editing** - Modal provides dedicated space for editing without distraction

### Code Quality
- **Consistency** - Follows same pattern as image modal
- **Maintainability** - Modal logic is centralized and easier to maintain
- **Extensibility** - Easy to add more TV properties in the future

## Future Enhancements

Potential improvements:
- **Test Connection** button in modal to verify TV connectivity
- **TV Status Indicator** showing online/offline status
- **Last Used** timestamp showing when TV last displayed an image
- **Preview Mode** to see which images would display with current tag selection
- **Bulk Edit** multiple TVs at once
- **TV Groups** to apply same tags to multiple TVs
- **Custom Display Settings** per TV (brightness, mat preferences, etc.)
