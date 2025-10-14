# Upload with Custom Names - Examples

## How It Works

When you upload an image, you can now provide a custom name. A UUID will be automatically appended to prevent duplicates.

### Format:
```
{custom-name}-{uuid}.{extension}
```

## Examples

### 1. With Custom Name:
```
Input:
- File: IMG_1234.jpg
- Custom Name: "sunset beach"

Output:
- Filename: sunset-beach-a1b2c3d4.jpg
```

### 2. Without Custom Name (uses original):
```
Input:
- File: IMG_1234.jpg
- Custom Name: (blank)

Output:
- Filename: img-1234-e5f6g7h8.jpg
```

### 3. Special Characters Are Sanitized:
```
Input:
- File: photo.jpg
- Custom Name: "My Awesome Photo!!!"

Output:
- Filename: my-awesome-photo-i9j0k1l2.jpg
```

### 4. Multiple Uploads of Same Name:
```
First upload: "landscape" → landscape-a1b2c3d4.jpg
Second upload: "landscape" → landscape-z9y8x7w6.jpg  (different UUID!)
```

## UUID Format

- Uses first 8 characters of a UUID (e.g., `a1b2c3d4`)
- Ensures no duplicates even with same names
- Short enough to not clutter filenames

## Benefits

✅ **Descriptive names** - "sunset-beach" instead of "IMG_1234"
✅ **No duplicates** - UUID suffix prevents collisions
✅ **Clean URLs** - Sanitized, lowercase, no special characters
✅ **Git-friendly** - Consistent naming for version control
✅ **Optional** - Leave blank to use original filename

## Name Sanitization Rules

- Converts to lowercase
- Replaces spaces with dashes
- Removes special characters (keeps letters, numbers, dash, underscore)
- Removes consecutive dashes

### Examples:
| Input | Output |
|-------|--------|
| "Sunset Beach" | "sunset-beach" |
| "My Photo (2024)" | "my-photo-2024" |
| "café__view" | "caf-view" |
| "photo@#$%^&123" | "photo-123" |
