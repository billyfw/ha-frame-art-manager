# Frame Art Manager Add-on

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]
![Supports armhf Architecture][armhf-shield]
![Supports armv7 Architecture][armv7-shield]
![Supports i386 Architecture][i386-shield]

## About

Billy's Art Manager home built web interface for managing artwork that can be displayed on TVs. Upload images, organize with tags, assign artwork to specific TVs, and sync your library with Git LFS for backup and multi-device management.

## Installation

1. Add this repository to your Home Assistant add-on store:
   - Go to **Supervisor** → **Add-on Store** → **⋮ (menu)** → **Repositories**
   - Add: `https://github.com/billyfw/ha-frame-art-manager`

2. Find **Frame Art Manager** in the add-on store and click **Install**

3. Configure the add-on (see Configuration section below)

4. Start the add-on

5. Click **Open Web UI** or add to your dashboard

## Configuration

Configuration options are available in the **Configuration** tab of the add-on.

**Default values:**
```yaml
frame_art_path: /config/www/frame_art
port: 8099
```

### Option: `frame_art_path`

The directory where your artwork library will be stored. Default is `/config/www/frame_art` which makes images accessible via Home Assistant's built-in web server.

### Option: `port`

The port the web interface will run on. Default is `8099`.

**Note**: The add-on uses Ingress by default, so you can access it directly from the Home Assistant UI without worrying about the port.

## License

MIT License - See LICENSE file for details

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg
