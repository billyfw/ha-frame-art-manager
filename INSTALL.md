# Installing Frame Art Manager as a Home Assistant Add-on

This guide walks you through installing your Frame Art Manager as a local Home Assistant add-on.

## Prerequisites

- Home Assistant OS, Supervised, or Container installation
- SSH access to your Home Assistant instance (for local installation)
- OR a GitHub repository (for remote installation)

## Method 1: Local Installation (Recommended for Development)

### Step 1: Access Your Add-ons Directory

SSH into your Home Assistant instance and navigate to the add-ons directory:

```bash
cd /addons
# or if that doesn't exist:
cd /usr/share/hassio/addons/local
```

### Step 2: Copy Your Add-on

Copy the entire `frame_art_manager` directory to the add-ons location:

```bash
# From your development machine, SCP the files:
scp -r frame_art_manager/ root@homeassistant.local:/addons/

# Or use the Home Assistant file editor/Samba share
```

### Step 3: Reload Add-ons

In Home Assistant:
1. Go to **Settings** → **Add-ons**
2. Click the **⋮** menu (top right) → **Check for updates**
3. Look for **Frame Art Manager** under **Local add-ons**

### Step 4: Install

1. Click **Frame Art Manager**
2. Click **Install**
3. Wait for installation to complete (may take a few minutes)

### Step 5: Configure

1. Go to the **Configuration** tab
2. Set your `frame_art_path` (default: `/config/www/frame_art` is fine)
3. Set your `port` (default: `8099` is fine)
4. Click **Save**

### Step 6: Start

1. Go to the **Info** tab
2. Enable **Start on boot** (recommended)
3. Click **Start**
4. Wait for the add-on to start (check the **Log** tab for status)

### Step 7: Access

- Click **Open Web UI** in the add-on page
- Or navigate to: `http://homeassistant.local:8099`
- Or use the sidebar panel: **Frame Art Manager**

## Method 2: GitHub Repository Installation

### Step 1: Push to GitHub

Push your code to a GitHub repository:

```bash
cd /path/to/ha-frame-art-manager
git add .
git commit -m "Initial commit of Frame Art Manager add-on"
git push origin main
```

### Step 2: Add Repository to Home Assistant

In Home Assistant:
1. Go to **Settings** → **Add-ons** → **Add-on Store**
2. Click **⋮** menu (top right) → **Repositories**
3. Add: `https://github.com/yourusername/ha-frame-art-manager`
4. Click **Add**

### Step 3: Install from Store

1. Find **Frame Art Manager** in the add-on store
2. Click **Install**
3. Configure as described in Method 1, Steps 5-7

## Troubleshooting

### Add-on Doesn't Appear

- Check that `config.yaml` is in the root of the `frame_art_manager` directory
- Verify the directory structure matches:
  ```
  frame_art_manager/
    config.yaml
    Dockerfile
    build.yaml
    run.sh
    app/
      server.js
      package.json
      ...
  ```
- Try restarting Home Assistant

### Build Fails

- Check the **Log** tab for specific errors
- Ensure all dependencies are in `package.json`
- Verify Dockerfile syntax
- Check that `run.sh` has execute permissions

### Won't Start

- Check the **Log** tab for errors
- Verify `FRAME_ART_PATH` is writable
- Check that port 8099 isn't already in use
- Ensure Node.js dependencies installed correctly

### Can't Access Web UI

- Verify the add-on is running (green indicator)
- Check firewall settings
- Try accessing via IP: `http://[your-ha-ip]:8099`
- Check if Ingress is working (use **Open Web UI** button)

## Updating the Add-on

### Local Installation

1. Make your code changes
2. Copy updated files to `/addons/frame_art_manager/`
3. Go to **Settings** → **Add-ons** → **Frame Art Manager**
4. Click **Restart**

### GitHub Installation

1. Commit and push your changes
2. In Home Assistant: **Settings** → **Add-ons** → **Add-on Store**
3. Click **⋮** → **Check for updates**
4. If available, click **Update** on Frame Art Manager

## Adding to Dashboard

### Option 1: Sidebar Panel

The add-on automatically adds a sidebar panel. If it doesn't appear:
1. Go to **Settings** → **Dashboards**
2. Check that the panel is enabled

### Option 2: Webpage Card

Add to any dashboard:
1. Edit dashboard
2. Add **Webpage Card**
3. URL: `http://homeassistant.local:8099`
4. Or use: `/api/hassio_ingress/[addon-slug]`

### Option 3: iFrame Card (deprecated)

Use a Webpage card instead, but iFrame also works:
```yaml
type: iframe
url: http://homeassistant.local:8099
aspect_ratio: 100%
```

## Next Steps

After installation:
1. Upload some artwork via the **Upload** tab
2. Add your Frame TVs via Home Assistant **Settings** → **Devices & Services** → **Integrations** (search for "Samsung Frame Art Shuffler")
3. Organize with tags via the **Tags** tab
4. Set up Git sync for backup (see main README)

## Uninstalling

1. Go to **Settings** → **Add-ons** → **Frame Art Manager**
2. Click **Uninstall**
3. Your frame art files in `/config/www/frame_art/` will remain
4. Delete manually if desired

## Support

- **Issues**: https://github.com/billyfw/ha-frame-art-manager/issues
- **Documentation**: See the add-on's **Documentation** tab
- **Logs**: Check the add-on **Log** tab for diagnostics
