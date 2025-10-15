# Multi-Select Bulk Tagging

Multi-select functionality has been added to allow bulk tagging of multiple images at once.

## Features

### Selection Methods
- **Single Click**: Select individual image (clears previous selection)
- **Cmd/Ctrl + Click**: Toggle individual image selection (keeps other selections)
- **Shift + Click**: Select range from last clicked image to current

### Visual Feedback
- Selected images have a blue outline (4px solid #3498db)
- Checkmark (✓) appears in top-right corner of selected images
- Bulk actions bar appears at top of gallery showing selection count

### Bulk Actions
- **Tag Selected**: Opens modal to add tags to all selected images
- **Clear Selection**: Deselects all images

### Bulk Tag Modal
- Shows count of selected images
- Enter comma-separated tags
- Tags are merged with existing tags (no duplicates)
- Updates all selected images in sequence
- Auto-refreshes gallery and tag library after completion

## Usage Flow

1. **Select Images**:
   - Click individual images
   - Hold Shift and click to select range
   - Hold Cmd/Ctrl and click to toggle individual selections

2. **Add Tags**:
   - Click "Tag Selected" button in blue bar
   - Enter tags separated by commas (e.g., "landscape, sunset, beach")
   - Click "Add Tags"

3. **Results**:
   - All selected images updated with new tags
   - Tags are added to existing tags (not replaced)
   - Duplicate tags automatically removed
   - Selection automatically cleared
   - Gallery refreshes to show updates

## Technical Details

### State Management
- `selectedImages`: Set of selected filenames
- `lastClickedIndex`: Last clicked image index for range selection

### Key Functions
- `handleImageClick()`: Manages selection logic with keyboard modifiers
- `updateBulkActionsBar()`: Shows/hides bulk actions bar
- `saveBulkTags()`: Applies tags to all selected images
- `clearSelection()`: Clears all selections

### CSS Classes
- `.selected`: Applied to selected image cards
- `.bulk-actions.visible`: Shows bulk actions bar
- `.bulk-modal.visible`: Shows bulk tag modal

## Future Enhancements
- Bulk delete selected images
- Bulk assign to TV
- Copy/move selected images
- Export selected images list
- Select all / invert selection buttons
