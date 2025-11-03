#!/bin/bash

# Frame Art Manager Release Script
# Usage: ./do_release.sh [major|minor|patch] [-m "commit message"]

set -e

# Function to show usage
show_usage() {
    echo "Frame Art Manager Release Script"
    echo ""
    echo "Usage: ./do_release.sh [major|minor|patch] [-m \"commit message\"]"
    echo ""
    echo "Version Bump Types:"
    echo "  major    Increment major version (e.g., 0.5.5 -> 1.0.0)"
    echo "  minor    Increment minor version (e.g., 0.5.5 -> 0.6.0)"
    echo "  patch    Increment patch version (e.g., 0.5.5 -> 0.5.6)"
    echo ""
    echo "Options:"
    echo "  -m \"message\"    Custom commit message (optional)"
    echo "  --help, -h      Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./do_release.sh patch"
    echo "  ./do_release.sh minor"
    echo "  ./do_release.sh patch -m \"Fix SSH key handling\""
    echo ""
    echo "What this script does:"
    echo "  1. Reads current version from config.yaml"
    echo "  2. Bumps version number based on type (major/minor/patch)"
    echo "  3. Updates config.yaml with new version"
    echo "  4. Commits all changes to git"
    echo "  5. Creates a git tag (e.g., v0.5.6)"
    echo "  6. Pushes code and tags to GitHub"
    echo "  7. SSHs into Home Assistant"
    echo "  8. Auto-detects add-on slug"
    echo "  9. Updates add-on to new version from GitHub"
    echo "  10. Prompts to manually restore SSH key configuration"
}

# Parse arguments
BUMP_TYPE=""
COMMIT_MESSAGE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_usage
            exit 0
            ;;
        -m)
            COMMIT_MESSAGE="$2"
            shift 2
            ;;
        major|minor|patch)
            BUMP_TYPE="$1"
            shift
            ;;
        *)
            echo "Error: Unknown option $1"
            echo ""
            show_usage
            exit 1
            ;;
    esac
done

# Check if argument provided
if [ -z "$BUMP_TYPE" ]; then
    echo "Error: Version bump type required"
    echo ""
    echo "Usage: ./do_release.sh [major|minor|patch] [-m \"commit message\"]"
    echo ""
    echo "Run './do_release.sh --help' for more information"
    exit 1
fi

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

# Build commit message
if [ -n "$COMMIT_MESSAGE" ]; then
    git commit -m "Release v$NEW_VERSION - $COMMIT_MESSAGE"
else
    git commit -m "Release v$NEW_VERSION"
fi

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

# Check for local version and remove it (if upgrading from local to GitHub)
LOCAL_SLUG=\$(ha addons --raw-json | jq -r '.data.addons[] | select(.name == "Frame Art Helper" or .name == "Frame Art Manager") | select(.repository == "local") | .slug')

if [ -n "\$LOCAL_SLUG" ]; then
    echo "Found local version: \$LOCAL_SLUG - removing it..."
    ha addons uninstall "\$LOCAL_SLUG"
    sleep 3
fi

# Force refresh of repository data and version files (same as "Check for updates" button)
echo "Refreshing repository data from GitHub..."
ha refresh-updates
sleep 5

# Check if GitHub version is already installed
INSTALLED=\$(ha addons --raw-json | jq -r '.data.addons[] | select(.slug == "'\$GITHUB_SLUG'") | .slug')

if [ -n "\$INSTALLED" ]; then
    echo "Add-on already installed, updating to version $NEW_VERSION..."
    echo "(Configuration will be preserved across update)"
    
    ha addons update "\$GITHUB_SLUG"
    sleep 3
else
    echo "Installing fresh from GitHub repository..."
    ha addons install "\$GITHUB_SLUG"
    sleep 5
    echo "Starting add-on..."
    ha addons start "\$GITHUB_SLUG"
    sleep 2
fi

echo "✅ Add-on updated to version $NEW_VERSION"
ENDSSH

echo ""
echo "✅ Release complete!"
echo "Version: $NEW_VERSION"
echo "Tag: v$NEW_VERSION"
echo "GitHub: https://github.com/billyfw/ha-frame-art-manager/releases/tag/v$NEW_VERSION"
