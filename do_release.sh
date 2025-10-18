#!/bin/bash

# Frame Art Manager Release Script
# Usage: ./release.sh [major|minor|patch]

set -e

# Check if argument provided
if [ $# -eq 0 ]; then
    echo "Error: Version bump type required"
    echo "Usage: ./release.sh [major|minor|patch]"
    echo ""
    echo "Examples:"
    echo "  ./release.sh patch  # 0.5.2 -> 0.5.3"
    echo "  ./release.sh minor  # 0.5.2 -> 0.6.0"
    echo "  ./release.sh major  # 0.5.2 -> 1.0.0"
    exit 1
fi

BUMP_TYPE=$1

# Validate bump type
if [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
    echo "Error: Invalid bump type '$BUMP_TYPE'"
    echo "Must be: major, minor, or patch"
    exit 1
fi

# Get current version from config.yaml
CONFIG_FILE="frame_art_manager/config.yaml"
CURRENT_VERSION=$(grep '^version:' "$CONFIG_FILE" | sed 's/version: "\(.*\)"/\1/')

echo "Current version: $CURRENT_VERSION"

# Split version into parts
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Bump version based on type
case $BUMP_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "New version: $NEW_VERSION"

# Update config.yaml
sed -i.bak "s/^version: \".*\"/version: \"$NEW_VERSION\"/" "$CONFIG_FILE"
rm "${CONFIG_FILE}.bak"

echo "Updated $CONFIG_FILE to version $NEW_VERSION"

# Git operations
echo "Committing changes..."
git add .
git commit -m "Release v$NEW_VERSION"

echo "Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release version $NEW_VERSION"

echo "Pushing to GitHub..."
git push origin main --tags

echo "Waiting for GitHub to process..."
sleep 3

# Update Home Assistant add-on
echo "Reinstalling Home Assistant add-on..."
ssh root@homeassistant.local << ENDSSH
# Force supervisor to refresh repositories
ha supervisor reload
sleep 2

# Find the current slug (it may have changed)
ADDON_SLUG=\$(ha addons --raw-json | grep -o '"slug":"[^"]*frame_art_manager"' | head -1 | cut -d'"' -f4)

if [ -z "\$ADDON_SLUG" ]; then
    echo "❌ Could not find Frame Art Manager add-on"
    exit 1
fi

echo "Found add-on with slug: \$ADDON_SLUG"

# Uninstall the old version
echo "Uninstalling old version..."
ha addons uninstall "\$ADDON_SLUG"
sleep 2

# Reload to see the new version
ha addons reload
sleep 2

# Install fresh (slug should be the same for the same repo)
echo "Installing new version..."
ha addons install "\$ADDON_SLUG"
sleep 5

# Start it
echo "Starting add-on..."
ha addons start "\$ADDON_SLUG"
sleep 2

echo "✅ Add-on reinstalled with version $NEW_VERSION"
ENDSSH

echo ""
echo "✅ Release complete!"
echo "Version: $NEW_VERSION"
echo "Tag: v$NEW_VERSION"
echo "GitHub: https://github.com/billyfw/ha-frame-art-manager/releases/tag/v$NEW_VERSION"
