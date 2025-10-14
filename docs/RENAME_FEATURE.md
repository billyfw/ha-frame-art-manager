# Image Rename Feature

## Overview
Users can now rename images directly from the detail modal by clicking a pencil icon (✏️) next to the image name.

## User Interface

### Modal Display
- **Pencil Icon**: Located next to the image name in the detail modal
- **Click to Edit**: Clicking the pencil icon reveals an inline edit form
- **Edit Form**: Contains:
  - Text input pre-filled with current base name
  - "Save" button (primary blue)
  - "Cancel" button (secondary gray)

### How It Works
1. Open an image's detail modal
2. Click the pencil (✏️) icon next to the name
3. Edit the base name in the input field
4. Click "Save" to confirm or "Cancel" to abort
5. The image file, thumbnail, and metadata are all updated

## Technical Implementation

### What Gets Renamed
- **Filename Structure**: `{basename}-{uuid}.{ext}`
- **Only Base Name Changes**: The UUID and extension are preserved
- **Example**: 
  - Old: `vacation-a1b2c3d4.jpg`
  - New: `beach-trip-a1b2c3d4.jpg` (after renaming to "beach-trip")

### Backend Changes

#### API Endpoint
- **Route**: `POST /api/images/:filename/rename`
- **Body**: `{ newBaseName: "new-name" }`
- **Response**: `{ success: true, oldFilename, newFilename }`

#### File Operations
1. Sanitizes new base name (lowercase, replaces invalid chars with `-`)
2. Extracts UUID from original filename
3. Constructs new filename with same UUID and extension
4. Checks for conflicts (prevents overwriting existing files)
5. Renames physical image file in `library/` directory
6. Renames thumbnail file in `thumbs/` directory (if exists)
7. Updates metadata.json entry

#### MetadataHelper Method
```javascript
async renameImage(oldFilename, newFilename)
```
- Validates old filename exists in metadata
- Checks new filename doesn't already exist
- Copies metadata to new filename key
- Deletes old metadata entry
- Writes updated metadata.json

### Frontend Changes

#### JavaScript Functions
- `showEditFilenameForm()`: Shows edit form, hides display name, focuses input
- `hideEditFilenameForm()`: Hides edit form, shows display name
- `saveFilenameChange()`: Sends rename request to API, updates UI on success

#### User Experience
- Input is pre-filled with current display name
- Auto-focuses and selects text for quick editing
- Updates modal immediately after successful rename
- Reloads gallery to show new name throughout app
- Shows error alerts if rename fails (e.g., name conflict)

### CSS Styling
- `.modal-filename-container`: Flex layout for name and pencil icon
- `.btn-icon`: Minimal button style with hover effect
- `.edit-filename-form`: Inline flex form with proper spacing
- `.btn-small`: Smaller button size for inline forms
- Responsive design maintained

## Name Sanitization Rules
- Converts to lowercase
- Replaces non-alphanumeric characters (except `-` and `_`) with `-`
- Removes consecutive dashes
- Preserves UUID and file extension automatically

## Error Handling
- Empty name validation
- Duplicate filename detection
- UUID extraction validation
- File access error handling
- Metadata consistency checks

## Benefits
1. **User-Friendly**: No need to re-upload images to change names
2. **Safe**: UUID prevents accidental overwrites of other images
3. **Consistent**: Updates all related files (image, thumbnail, metadata)
4. **Fast**: Inline editing without leaving the detail modal
5. **Reversible**: Can rename again if needed
