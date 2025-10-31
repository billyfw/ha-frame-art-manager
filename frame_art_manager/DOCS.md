# Frame Art Manager Documentation

## Overview

Frame Art Manager helps you organize and manage artwork for your Samsung Frame displays. Upload images, organize them with tags, and sync changes to your shared library. TV discovery, assignment, and display automation now live in the Home Assistant integration rather than the add-on UI.

## Accessing the Add-on

### After Installation

1. Go to **Settings** → **Add-ons** → **Frame Art Manager**
2. Ensure the add-on is started (check for green indicator)
3. Click **Open Web UI** to access the interface

### Alternative Access Methods

- **Direct URL**: `http://[your-home-assistant-ip]:8099`
- **Sidebar Panel**: Look for "Frame Art Manager" in the Home Assistant sidebar
- **Dashboard**: Add a Webpage card pointing to the add-on URL

### Adding to Dashboard

To add Frame Art Manager to any dashboard:

1. Edit your dashboard
2. Add a **Webpage Card**
3. Set URL to: `http://homeassistant.local:8099`
4. Adjust aspect ratio as desired (100% recommended)

## Interface Overview

The web interface has 4 main areas:
- **Gallery**: Browse and manage your images
- **Upload**: Add new images to your library
- **Tags**: Manage your tag library
- **Advanced**: System information and settings (including metadata viewer and sync details)

## Configuration

### Home Label (Optional)

Set the **Home** field to a nickname like `Madrone` so future automations can tell which location this add-on instance belongs to. The value is optional today but is passed to the backend for upcoming features.

### Git Sync (Optional)

To enable Git synchronization of your frame art library:

1. Go to **Settings** → **Add-ons** → **Frame Art Manager** → **Configuration**
2. Paste your SSH private key in the `ssh_private_key` field
3. Set `git_remote_host_alias` to match your Git remote host (default: `github-billy`)
4. Save and restart the add-on

**To get your SSH private key:**
- From Terminal & SSH add-on: `cat ~/.ssh/id_ed25519`
- Copy the entire output including `-----BEGIN` and `-----END` lines

**Note**: The private key is stored securely in the add-on's configuration and is never exposed in logs.

## Storage Location

- Images are stored in: `/config/www/frame_art/library/`
- Thumbnails are stored in: `/config/www/frame_art/thumbs/`
- Metadata is stored in: `/config/www/frame_art/metadata.json`

## Support

- **GitHub**: https://github.com/billyfw/ha-frame-art-manager
- **Issues**: https://github.com/billyfw/ha-frame-art-manager/issues
- **Full Documentation**: See the GitHub repository for detailed usage instructions

## Version

Current Version: 0.2.0

Last Updated: October 18, 2025
