# TV Shortcuts Feature

## Overview
TV shortcuts provide a convenient way to quickly filter gallery images by TV. Instead of manually selecting multiple tags, users can click a TV checkbox to automatically select/deselect all tags assigned to that TV.

## Location
The TV shortcuts appear at the top of the tag filter dropdown in the Gallery view, above the tag checkboxes.

## Functionality

### Display Logic
- Only TVs with assigned tags are shown in the shortcuts section
- TVs without tags are automatically filtered out
- Section includes a "TV SHORTCUTS" header and a divider line

### Checkbox States
1. **Unchecked**: None of the TV's tags are selected
2. **Checked**: All of the TV's tags are selected
3. **Indeterminate (dash)**: Some but not all of the TV's tags are selected

### Interaction
- **Checking a TV**: Selects all tag checkboxes for that TV's assigned tags
- **Unchecking a TV**: Deselects all tag checkboxes for that TV's assigned tags
- **Changing tags**: TV checkbox state automatically updates to reflect current tag selections

### Synchronization
TV shortcuts automatically update when:
- The Gallery view loads (initial page load)
- TVs are loaded (switching to TVs tab)
- A TV is saved with updated tags
- A TV is deleted
- Tag checkboxes are manually changed

## Implementation Details

### HTML Structure
```html
<div id="tv-shortcuts" class="tv-shortcuts">
  <!-- Populated dynamically with TV checkboxes -->
</div>
```

### Key Functions

#### `loadTagsForFilter()`
Populates the TV shortcuts section with checkboxes for TVs that have tags:
```javascript
const tvsWithTags = allTVs.filter(tv => tv.tags && tv.tags.length > 0);
// Creates checkboxes with data-tv-tags attribute storing TV's tags
```

#### `handleTVShortcutChange(event)`
When a TV checkbox is clicked:
1. Reads the TV's tags from the checkbox's `data-tv-tags` attribute
2. Selects or deselects all tag checkboxes for those tags
3. Triggers `updateTagFilterDisplay()` to refresh the UI

#### `updateTVShortcutStates()`
Updates TV checkbox states based on current tag selections:
1. Gets all selected tag IDs from tag checkboxes
2. For each TV, checks how many of its tags are selected
3. Sets checkbox to:
   - Checked if all tags selected
   - Indeterminate if some but not all tags selected
   - Unchecked if no tags selected

### CSS Styling
```css
.tv-shortcuts {
  /* Container styling */
}

.tv-shortcuts-header {
  text-transform: uppercase;
  color: #888;
  font-size: 0.75em;
  padding: 6px 10px 3px;
}

.tv-shortcuts-divider {
  border-bottom: 1px solid #444;
  margin: 5px 0;
}
```

## User Experience

### Example Workflow
1. User has 3 TVs:
   - Living Room: tags ["nature", "abstract"]
   - Bedroom: tags ["nature", "sunset"]
   - Kitchen: tags ["food", "abstract"]

2. User clicks "Living Room" TV checkbox
   - "nature" and "abstract" tag checkboxes are automatically selected
   - Gallery shows only images with "nature" OR "abstract" tags
   - Living Room checkbox shows checked
   - Bedroom checkbox shows indeterminate (has "nature" but not "abstract")
   - Kitchen checkbox shows indeterminate (has "abstract" but not "nature")

3. User manually unchecks "abstract" tag
   - Living Room checkbox automatically changes to indeterminate
   - Bedroom checkbox automatically changes to checked (only has "nature" which is still selected)
   - Kitchen checkbox changes to indeterminate

## Benefits
- **Speed**: Select multiple tags with one click instead of checking each individually
- **Convenience**: Don't need to remember which tags are assigned to each TV
- **Visual feedback**: Indeterminate state shows when viewing images for one TV will include some images from another TV
- **Consistency**: Matches the existing multi-select dropdown pattern
