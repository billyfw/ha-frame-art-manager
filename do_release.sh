#!/bin/bash

# Frame Art Manager Release Script
# Usage: ./do_release.sh [major|minor|patch]

set -e

# Check if argument provided
if [ $# -eq 0 ]; then
    echo "Error: Version bump type required"
    echo "Usage: ./do_release.sh [major|minor|patch]"
    echo ""
    echo "Examples:"
    echo "  ./do_release.sh patch  # 0.5.5 -> 0.5.6"
    echo "  ./do_release.sh minor  # 0.5.5 -> 0.6.0"
    echo "  ./do_release.sh major  # 0.5.5 -> 1.0.0"
    echo ""
    echo "What this script does:"
    echo "  • Reads current version from config.yaml"
    echo "  • Bumps version number based on type (major/minor/patch)"
    echo "  • Updates config.yaml with new version"
    echo "  • Commits all changes to git"
    echo "  • Creates a git tag (e.g., v0.5.6)"
    echo "  • Pushes code and tags to GitHub"
    echo "  • SSHs into Home Assistant"
    echo "  • Auto-detects add-on slug"
    echo "  • Uninstalls old version of add-on"
    echo "  • Reinstalls fresh from GitHub with new version"
    echo "  • Starts the add-on"
    echo ""
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
echo "Updating Home Assistant add-on..."
ssh root@homeassistant.local << ENDSSH
# The GitHub repo slug should be e2a3b0cb_frame_art_manager
GITHUB_SLUG="e2a3b0cb_frame_art_manager"

# Check if GitHub version is installed and uninstall it
INSTALLED=\$(ha addons --raw-json | jq -r '.data.addons[] | select(.slug == "'\$GITHUB_SLUG'") | .slug')

if [ -n "\$INSTALLED" ]; then
    echo "Found installed GitHub version: \$GITHUB_SLUG"
    echo "Uninstalling to rebuild..."
    ha addons uninstall "\$GITHUB_SLUG"
    sleep 3
fi

# Check for local version and remove it
LOCAL_SLUG=\$(ha addons --raw-json | jq -r '.data.addons[] | select(.name == "Frame Art Helper" or .name == "Frame Art Manager") | select(.repository == "local") | .slug')

if [ -n "\$LOCAL_SLUG" ]; then
    echo "Found local version: \$LOCAL_SLUG - removing it..."
    ha addons uninstall "\$LOCAL_SLUG"
    sleep 3
fi

# Force supervisor to reload and clear all caches
echo "Reloading supervisor to clear caches..."
ha supervisor reload
sleep 10

# Force check for updates from GitHub (equivalent to "Check for updates" button)
echo "Checking for repository updates..."
ha supervisor refresh
sleep 10

# Install fresh from GitHub
echo "Installing fresh from GitHub repository..."
ha addons install "\$GITHUB_SLUG"
sleep 5

# Start it
echo "Starting add-on..."
ha addons start "\$GITHUB_SLUG"
sleep 2

echo "✅ Add-on rebuilt with version $NEW_VERSION"
echo ""
echo "Note: If version still shows old number in HA UI, manually click"
echo "'Check for updates' in Settings > Add-ons > Repositories"
ENDSSH

echo ""
echo "✅ Release complete!"
echo "Version: $NEW_VERSION"
echo "Tag: v$NEW_VERSION"
echo "GitHub: https://github.com/billyfw/ha-frame-art-manager/releases/tag/v$NEW_VERSION"
