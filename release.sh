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

echo "Waiting 5 seconds for GitHub to process..."
sleep 5

# Update Home Assistant add-on
echo "Updating Home Assistant add-on..."
ssh root@homeassistant.local << 'ENDSSH'
ha addons reload
sleep 2
ha addons update frame_art_manager
sleep 2
ha addons restart frame_art_manager
echo "Add-on updated and restarted!"
ENDSSH

echo ""
echo "✅ Release complete!"
echo "Version: $NEW_VERSION"
echo "Tag: v$NEW_VERSION"
echo "GitHub: https://github.com/billyfw/ha-frame-art-manager/releases/tag/v$NEW_VERSION"
