# TV Tag Filtering Feature

## Overview
Each TV in the Frame Art Manager can be assigned specific tags to control which images are displayed on that TV. This allows you to curate different image collections for different TVs in your home.

## Usage

### Assigning Tags to a TV
1. Navigate to the **TVs** tab
2. For each TV, you'll see a "Display tags:" dropdown
3. Click the dropdown to see all available tags in your library
4. Check the tags you want to associate with that TV
5. Selected tags are automatically saved

### Display Behavior
- **No tags selected**: The TV will display all images from your library (default behavior)
- **One or more tags selected**: The TV will only display images that have at least one of the selected tags

### Tag Display
- When no tags are selected, the button shows: "All images"
- When one tag is selected, the button shows: the tag name
- When multiple tags are selected, the button shows: "N tags selected" (where N is the count)

## Technical Implementation

### Backend

#### Data Structure
Each TV object in `metadata.json` now includes a `tags` array:
```json
{
  "id": "1234567890",
  "name": "Living Room TV",
  "ip": "192.168.1.100",
  "added": "2025-01-15T10:00:00.000Z",
  "tags": ["landscape", "abstract"]
}
```

#### API Endpoint
**PUT** `/api/tvs/:tvId/tags`

Request body:
```json
{
  "tags": ["tag1", "tag2"]
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
    "tags": ["tag1", "tag2"]
  }
}
```

#### Metadata Helper Method
`updateTVTags(tvId, tags)` - Updates the tags array for a specific TV

### Frontend

#### UI Components
- Custom multi-select dropdown for each TV
- Checkbox-based tag selection
- Dynamic button text showing current selection
- Click-outside-to-close behavior

#### Functions
- `toggleTVTagsDropdown(tvId)` - Opens/closes the tag dropdown for a specific TV
- `updateTVTags(tvId)` - Sends selected tags to the backend and updates the UI

## Integration with AppDaemon

When implementing the AppDaemon service for displaying images on TVs, the service should:

1. Query the TV configuration from the Frame Art Manager API
2. Retrieve the `tags` array for the target TV
3. Filter images based on the TV's tags:
   - If `tags` array is empty or undefined, use all images
   - If `tags` array has values, only include images that have at least one matching tag
4. Randomly select from the filtered image set

Example filtering logic:
```python
def get_images_for_tv(tv_id):
    tv_config = get_tv_config(tv_id)
    tv_tags = tv_config.get('tags', [])
    
    if not tv_tags:
        # Return all images
        return get_all_images()
    else:
        # Return images that match at least one tag
        return get_images_with_any_tags(tv_tags)
```

## Future Enhancements

Potential improvements to consider:
- **AND vs OR logic**: Option to require all tags (AND) instead of any tag (OR)
- **Exclude tags**: Allow negative filtering (show images WITHOUT certain tags)
- **Weighted random**: Show images with matching tags more frequently
- **Schedule-based tags**: Different tag sets for different times of day
- **Tag groups**: Organize tags into categories for easier selection
