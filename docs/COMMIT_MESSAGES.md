# Enhanced Commit Messages

## Overview
The system now generates detailed, file-specific commit messages that clearly describe what changed for each file.

## Commit Message Format

### Structure
```
Sync: <summary of changes>

  <file1>: <what changed>
  <file2>: <what changed>
  ...
```

### Summary Line
The first line provides a high-level count:
- `X new` - New images added
- `X modified` - Images or metadata modified
- `X renamed` - Images renamed
- `X deleted` - Images deleted

Multiple categories are comma-separated: `Sync: 2 new, 1 renamed, 3 modified`

### Detail Lines
Each subsequent line describes exactly what changed for a specific file.

## Examples

### Example 1: Tag Removal
**Before (old system):**
```
Sync: Auto-commit 1 file(s) from manual sync
```

**After (new system):**
```
Sync: 1 modified

  book1-2a-52403dc7.jpg: removed tag: test6
```

### Example 2: Multiple Tag Changes
```
Sync: 2 modified

  book1-2a-52403dc7.jpg: removed tags: test5, test6
  aaaimg_4534-test-3885c2bc.png: added tags: art, modern
```

### Example 3: Mixed Changes
```
Sync: 1 new, 1 renamed, 1 modified

  added: sunset-beach-4a3b2c1d.jpg
  renamed: old-name-xyz.jpg → new-name-abc.jpg
  portrait-123.jpg: added tag: favorite, updated matte
```

### Example 4: Property Updates
```
Sync: 1 modified

  landscape-456.jpg: updated matte, filter
```

### Example 5: Image Upload
```
Sync: 3 new

  added: mountain-view-1a2b3c4d.jpg
  added: city-night-5e6f7g8h.jpg  
  added: forest-path-9i0j1k2l.jpg
```

### Example 6: Image Deletion
```
Sync: 2 deleted

  deleted: old-photo-abc123.jpg
  deleted: test-image-xyz789.jpg
```

### Example 7: Rename Operation
```
Sync: 1 renamed

  renamed: IMG_1234-hash.jpg → vacation-paris-hash.jpg
```

### Example 8: Complex Multi-Operation
```
Sync: 2 new, 1 renamed, 2 modified, 1 deleted

  added: new-art-piece-hash1.jpg
  added: another-photo-hash2.jpg
  renamed: temp-name-hash3.jpg → final-name-hash3.jpg
  existing-photo-hash4.jpg: removed tag: draft, added tag: published
  another-image-hash5.jpg: updated matte, filter
  deleted: old-screenshot-hash6.jpg
```

## Change Detection Details

### Tag Changes
The system parses the git diff of `metadata.json` to detect:
- **Added tags**: Lists each tag that was added
- **Removed tags**: Lists each tag that was removed
- Shows both operations separately if tags were added AND removed

### Property Changes
Detects changes to:
- `matte` - Frame matte style
- `filter` - Image filter applied
- Other metadata properties (excluding `updated` timestamp)

### File Operations
- **Added**: New file uploaded to library
- **Modified**: Binary file changed (re-uploaded)
- **Renamed**: File renamed through the UI
- **Deleted**: File removed from library

## Implementation

### Function: `generateCommitMessage(files)`
Located in `git_helper.js`, this function:

1. Calls `parseImageChanges()` to get counts
2. Generates summary line
3. Calls `getMetadataChanges()` to detect tag/property changes
4. Formats each file change with specific details
5. Returns multi-line commit message

### Function: `getMetadataChanges()`
- Gets git diff of `metadata.json`
- Parses diff to extract changes per image
- Returns array of human-readable change descriptions

### Function: `parseMetadataDiff(diff)`
- Analyzes diff line-by-line
- Identifies which image is being modified
- Detects added/removed tags
- Detects property changes
- Formats changes into readable strings

### Function: `formatImageChanges(imageName, addedTags, removedTags, propertyChanges)`
- Combines all changes for one image
- Formats as readable strings
- Handles pluralization ("tag" vs "tags")

## Benefits

### For Users
1. **Clear history**: Immediately see what changed in each commit
2. **Easy debugging**: Find when a specific tag was added/removed
3. **Accountability**: Know exactly what each sync operation did
4. **No confusion**: Commit messages match actual changes (no more "pexels image" when it's actually "book1.jpg")

### For Developers
1. **Better git log**: More useful commit history
2. **Easier troubleshooting**: Can trace issues through commit messages
3. **Automated accuracy**: No manual commit messages needed
4. **Detailed audit trail**: Every change is documented

## Git Log Example

```bash
$ git log --oneline -5
a1b2c3d Sync: 1 modified
        
        book1-2a-52403dc7.jpg: removed tag: test6
        
d4e5f6g Sync: 1 renamed, 1 modified
        
        renamed: image1baaa99x-7a2e17fa.jpeg → image1baaa99x00-7a2e17fa.jpeg
        aaaimg_4534-test-3885c2bc.png: added tags: tagx, test5
        
h7i8j9k Sync: 3 new
        
        added: sunset-beach-4a3b2c1d.jpg
        added: city-night-5e6f7g8h.jpg
        added: forest-path-9i0j1k2l.jpg
```

## Testing

To test the new commit messages:

1. Make changes in the UI (add/remove tags, upload images, rename files)
2. Click the sync button
3. Check the commit in git log:
   ```bash
   cd ~/devprojects/ha-config/www/frame_art
   git log -1 --format=fuller
   ```

## Future Enhancements

Potential improvements:
- Detect tag value changes (not just add/remove)
- Show thumbnail URLs that changed
- Indicate which TV assignments changed
- Group changes by operation type
- Add emoji indicators (🏷️ for tags, 🎨 for filters, etc.)

---

**Date:** October 16, 2025  
**Status:** Implemented ✅
