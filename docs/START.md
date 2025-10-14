# Quick Start Guide

## Development Mode 🔧

From the `app/` directory:

```bash
cd /Users/billywaldman/devprojects/ha-frame-art-manager/frame_art_manager/app
npm run dev
```

**What happens:**
- Auto-restarts on file changes (nodemon)
- Uses local path: `/Users/billywaldman/devprojects/ha-config/www/frame_art`
- Runs on: `http://localhost:8099`

---

## Production Mode 🚀

From the `app/` directory:

```bash
cd /Users/billywaldman/devprojects/ha-frame-art-manager/frame_art_manager/app
npm start
```

**What happens:**
- No auto-restart
- Uses Home Assistant path: `/config/www/frame_art`
- Runs on: `http://localhost:8099`

---

## Override Path 🛠️

If you need a custom path, set the environment variable:

```bash
FRAME_ART_PATH="/custom/path" npm run dev
# or
FRAME_ART_PATH="/custom/path" npm start
```

---

## Path Priority

The app determines the path in this order:

1. **`FRAME_ART_PATH` environment variable** (highest priority)
2. **Production default** (`/config/www/frame_art`) if NODE_ENV=production
3. **Development default** (`/Users/billywaldman/devprojects/ha-config/www/frame_art`)

---

## Stop the Server

Press `Ctrl + C` in the terminal where the server is running.

---

## Check If Server Is Running

```bash
curl http://localhost:8099/api/health
```

Or check: `http://localhost:8099` in your browser.
