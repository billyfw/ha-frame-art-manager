# Quick Start Guide

## Development Mode 🔧

From the `app/` directory:

```bash
cd frame_art_manager/app
cp .env.example .env
# Edit .env to set FRAME_ART_PATH to your local path
npm run dev
```

**What happens:**
- Auto-restarts on file changes (nodemon)
- Uses path from `.env` file
- Runs on: `http://localhost:8099`

---

## Production Mode 🚀

In Home Assistant, the add-on runs automatically with:

- Uses Home Assistant path: `/config/www/frame_art`
- Runs on: `http://localhost:8099`

---

## Override Path 🛠️

If you need a custom path without using `.env`, set the environment variable:

```bash
FRAME_ART_PATH="/custom/path" npm run dev
# or
FRAME_ART_PATH="/custom/path" npm start
```

---

## Environment Priority

1. **Environment variable** (`.env` file or shell export)
2. **Production default** (`/config/www/frame_art` in Home Assistant)
3. **Error if not set** (development mode)

---

## Stop the Server

Press `Ctrl + C` in the terminal where the server is running.

---

## Check If Server Is Running

```bash
curl http://localhost:8099/api/health
```

Or check: `http://localhost:8099` in your browser.
