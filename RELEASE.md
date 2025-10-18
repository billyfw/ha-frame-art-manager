# How to Release Updates to HACS

Quick guide for releasing new versions of the Frame Art Manager add-on.

## Release Checklist

1. **Update version in `frame_art_manager/config.yaml`**
   ```yaml
   version: "0.6"  # Increment this
   ```

2. **Update `frame_art_manager/CHANGELOG.md`**
   ```markdown
   ## [0.6] - 2025-10-XX
   ### Added
   - New feature description
   ### Fixed
   - Bug fix description
   ```

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "Release v0.6: Brief description of changes"
   ```

4. **Create a version tag**
   ```bash
   git tag -a v0.6 -m "Release version 0.6"
   ```

5. **Push to GitHub**
   ```bash
   git push origin main --tags
   ```

## That's It!

HACS will automatically detect the new tag and show the update to users.

## Tag Command Explained

- **`git tag`** - Creates a version marker
- **`-a v0.6`** - Annotated tag (recommended for releases)
- **`-m "message"`** - Description of the release
- **`--tags`** - Required to push tags to GitHub

## Version Numbers

Use simple semantic versioning:
- `v0.5` - Minor update
- `v0.6` - Next minor update  
- `v1.0` - Major milestone
- `v1.1` - Minor update after 1.0

The version in `config.yaml` should match the tag (without the 'v').

## If You Forget to Push Tags

```bash
# Push just the tags later
git push origin --tags
```
