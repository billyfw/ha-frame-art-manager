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

### Connecting Your Art Library to GitHub (First Run)

The library (images, thumbnails and `metadata.json`) lives in a private GitHub repository,
which backs it up and keeps every copy in sync. Images are stored with Git LFS. The add-on
sets this up from its web UI; no terminal or SSH commands are needed.

When the library folder (`frame_art_path`) is empty and not yet a git repository, opening
the web UI shows **Connect your art library**:

1. **Create a private repository** on GitHub (the link opens
   `https://github.com/new?name=frame_art&visibility=private`). Leave it empty: no README,
   no license. To share an existing Frame Art library instead, use its repository.
2. **Enter the repository** as `owner/name`, for example `your-user/frame_art`.
3. **Add the add-on's key as a deploy key.** Copy the public key shown on the screen, open
   the repository's deploy keys page (the link goes to
   `https://github.com/<owner>/<repo>/settings/keys/new`), paste it, give it a title and
   check **Allow write access**. Without write access the add-on can download the library
   but cannot save your changes.
4. **Test connection.** The test tells you whether GitHub accepts the key, whether the key
   can write, and whether the repository is empty or already holds a library.
5. **Connect library.**
   - Empty repository: the add-on creates a new library in the folder (`.gitattributes` for
     Git LFS and an empty `metadata.json`) and pushes it to the `main` branch.
   - Repository with a library: the add-on downloads it into the folder (the `main` branch,
     then the images through Git LFS; a large library can take a while).

Sync works as soon as setup finishes; the page reloads into the gallery. **Set up later**
closes the screen; **Advanced → Settings → Library Sync** opens it again.

Setup never overwrites anything. It only runs when the folder is missing, empty, or holds
just the empty folders and `metadata.json` the add-on creates at startup. A folder that is
already a git repository never sees the screen and is left exactly as it is. A folder with
other files (for example images added before connecting) is refused: move them out, or
point `frame_art_path` at an empty folder, then run setup again.

#### The generated key

When `ssh_private_key` is empty, the add-on generates an ed25519 key on first start and keeps
it in its private data folder (`/data/ssh/id_ed25519`), so it survives restarts and updates.
Only the public half is ever shown. Removing the deploy key on GitHub revokes the add-on's
access. Uninstalling the add-on deletes the key; a reinstall generates a new one, which then
needs adding as a deploy key again.

### Using Your Own SSH Key (Existing Setups)

The `ssh_private_key` option still works and takes precedence over the generated key:

1. Go to **Settings** → **Add-ons** → **Frame Art Manager** → **Configuration**
2. Paste your SSH private key in the `ssh_private_key` field
3. Set `git_remote_host_alias` to match your Git remote host (default: `github-owner`)
4. Save and restart the add-on

**To get your SSH private key:**
- From Terminal & SSH add-on: `cat ~/.ssh/id_ed25519`
- Copy the entire output including `-----BEGIN` and `-----END` lines

**Note**: The private key is stored securely in the add-on's configuration and is never exposed in logs.

Either key is used over SSH on port 443 (`ssh.github.com`), which works on networks that
block port 22.

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
