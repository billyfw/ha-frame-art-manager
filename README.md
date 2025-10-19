# Home Assistant Frame Art Manager

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)

![Project Maintenance][maintenance-shield]

A Home Assistant add-on for managing Samsung Frame TV artwork libraries.

## About

Frame Art Manager provides a beautiful web interface for organizing and managing artwork that can be displayed on Samsung Frame TVs. Upload images, tag them, assign them to specific TVs, and keep everything in sync with Git LFS.

### Features

- 📸 **Image Management**: Upload, rename, delete, and organize artwork
- 🏷️ **Tag System**: Organize images with tags and bulk operations
- 📺 **TV Management**: Configure multiple Frame TVs with tag-based filtering
- 🖼️ **Matte & Filters**: Apply 7 matte styles and 5 filters to images
- 🔄 **Git Sync**: Automatic synchronization with Git LFS repositories
- 📱 **Responsive UI**: Works on desktop, tablet, and mobile devices
- 🎨 **Professional Interface**: Clean, modern design with intuitive controls

## Installation

### Option 1: Add to Add-on Store

1. Navigate to **Supervisor** → **Add-on Store** in Home Assistant
2. Click the **⋮** menu → **Repositories**
3. Add this repository URL: `https://github.com/billyfw/ha-frame-art-manager`
4. Find **Frame Art Manager** in the list and click **Install**
5. Configure and start the add-on

### Option 2: Manual Installation

1. Copy the `frame_art_manager` folder to your Home Assistant `/addons/` directory
2. Restart Home Assistant
3. Find **Frame Art Manager** in the **Local Add-ons** section
4. Install, configure, and start

### Preparing a fresh Home Assistant environment

When provisioning a new Home Assistant box, set up the artwork repository before launching the add-on:

1. **Install Git + Git LFS** on the host (Supervisor → Add-on → SSH & Web Terminal, then run):

	```bash
	apk add git git-lfs
	git lfs install --system
	```

2. **Create the artwork directory** that the add-on will manage (defaults to `/config/www/frame_art`):

	```bash
	mkdir -p /config/www
	cd /config/www
	```

3. **Clone the Frame Art library via SSH** so images and metadata stay under version control:

	```bash
	git clone git@github.com:billyfw/frame_art.git frame_art
	cd frame_art
	```

	> 💡 Ensure the Home Assistant host has an SSH key registered with GitHub (`/root/.ssh/id_rsa`). The default add-on startup flow expects SSH access and will not prompt for HTTPS credentials.

4. **Normalize Git LFS to the expected SSH endpoints.** Older clones (or the default `git lfs install` flow) sometimes record HTTPS URLs or append `/info/lfs` directly in your Git config. Inside Home Assistant the add-on can’t complete HTTPS auth, and Git LFS will refuse to download objects if it sees `billyfw/frame_art.git/info/lfs` as the repository. Running the commands below rewrites everything to the SSH base URL that our scripts expect and strips out any lingering HTTPS credentials. The add-on also performs this check each time it starts, so you’re mostly just confirming things look right before first launch:

	```bash
	git remote get-url origin                                 # git@github.com:billyfw/frame_art.git
	git config remote.origin.lfsurl ssh://git@github.com/billyfw/frame_art
	git config lfs.url ssh://git@github.com/billyfw/frame_art
	git config lfs.ssh.endpoint git@github.com:billyfw/frame_art.git
	git config --unset lfs.https://github.com/billyfw/frame_art/info/lfs.access 2>/dev/null || true
	git config --unset lfs.https://github.com/billyfw/frame_art.git/info/lfs.access 2>/dev/null || true
	```

5. **Install the add-on** and set the configuration option `frame_art_path: /config/www/frame_art`.

6. **Restart the add-on** after any manual Git/LFS changes so `run.sh` can re-sync configuration before the Node server starts.

## Configuration

```yaml
frame_art_path: /config/www/frame_art
port: 8099
```

See the add-on's **Documentation** tab for detailed configuration options.

## Usage

After starting the add-on:

1. Click **Open Web UI** from the add-on page
2. Or add to your dashboard using the sidebar panel

The interface has 5 main tabs:
- **Gallery**: Browse and manage images
- **Upload**: Add new artwork
- **TVs**: Configure your Frame TVs
- **Tags**: Manage tag library
- **Advanced**: System information

See the add-on **Documentation** for detailed usage instructions.

## Development

This project is built with:
- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Image Processing**: Sharp
- **Git Integration**: simple-git + Git LFS
- **Testing**: Custom test suite (40 tests, 100% passing)

### Local Development

```bash
cd frame_art_manager/app
cp .env.example .env
# Edit .env to set your FRAME_ART_PATH
npm install
npm run dev
```

Access at: http://localhost:8099

### Running Tests

```bash
npm test
```

For Git/LFS-specific validation:

```bash
npm run test:git
```

## Documentation

- [Development Guide](docs/DEVELOPMENT.md) - Technical details and API reference
- [Features Guide](docs/FEATURES.md) - Complete UI feature documentation
- [Status Document](docs/STATUS.md) - Project status and roadmap

## Roadmap

### ✅ Completed (v0.2.0)
- Complete web interface
- REST API (18 endpoints)
- Git LFS integration
- Automated testing
- Home Assistant add-on packaging

### 🔨 In Progress
- Manual Git sync UI refinements

### 📋 Next Up
- AppDaemon integration for TV control
- Display images via HA services
- Slideshow automation
- TV status monitoring

See [STATUS.md](docs/STATUS.md) for detailed progress.

## Support

- **Issues**: [GitHub Issues](https://github.com/billyfw/ha-frame-art-manager/issues)
- **Discussions**: [GitHub Discussions](https://github.com/billyfw/ha-frame-art-manager/discussions)
- **Documentation**: See the `docs/` folder

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Credits

Created by Billy

Special thanks to the Home Assistant community.

---

[releases-shield]: https://img.shields.io/github/release/billyfw/ha-frame-art-manager.svg
[releases]: https://github.com/billyfw/ha-frame-art-manager/releases
[license-shield]: https://img.shields.io/github/license/billyfw/ha-frame-art-manager.svg
[maintenance-shield]: https://img.shields.io/maintenance/yes/2025.svg
