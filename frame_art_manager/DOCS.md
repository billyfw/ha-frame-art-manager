# Frame Art Manager Documentation

## Overview

Frame Art Manager helps you organize and manage artwork for your Samsung Frame TV. Upload images, organize them with tags, and assign them to specific TVs for display.

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

The web interface has 5 main tabs:
- **Gallery**: Browse and manage your images
- **Upload**: Add new images to your library
- **TVs**: Configure your Frame TV devices
- **Tags**: Manage your tag library
- **Advanced**: System information and settings

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
