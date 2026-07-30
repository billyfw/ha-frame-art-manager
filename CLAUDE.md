# CLAUDE.md — ha-frame-art-manager

Web app for managing the Samsung Frame TV art library (gallery, upload, tagging, git
sync). Historically packaged as a Home Assistant add-on; **currently migrating to a single
central instance on Fly.io** — read `docs/MULTI_HOME_PLAN.md` FIRST before any
architectural work. That doc is the authoritative plan (phases, decisions, rejected
alternatives) for supporting the second house in Maui.

## System map (three repos + library)

- **This repo**: Node 20 + Express backend (`frame_art_manager/app/`), vanilla-JS frontend
  (`frame_art_manager/app/public/js/app.js`, ~13.5k lines). No frontend framework.
- **`~/devprojects/frame-art-shuffler`**: HA custom integration (HACS) that actually pushes
  art to the TVs (vendored samsungtvws, ws port 8002, WoL). Reads the library from local
  disk at `/config/www/frame_art/`. Per-TV state, tagsets, pairing tokens live there, not
  here.
- **Library**: `git@github.com:billyfw/frame_art.git` — git + LFS (`library/`, `thumbs/`,
  `originals/` in LFS; `metadata.json` plain text). Managed by `app/git_helper.js`
  (expected remote `billyfw/frame_art`, branch `main` hardcoded, pull --rebase
  --autostash, "cloud wins" conflict resolution, semantic commit messages).
  Local dev checkout: `~/devprojects/ha-config/www/frame_art`.
- **`~/devprojects/ha-config`**: Madrone HA config repo (the HA box is `ha.mad` /
  `192.168.1.152`, SSH alias `ssh ha`).

## Key backend facts

- Fully env-driven: `FRAME_ART_PATH`, `PORT` (8099), `NODE_ENV`,
  `GIT_AUTO_PULL_ON_STARTUP`, `GIT_AUTO_PUSH_ON_CHANGE`, `HA_URL`
  (default `http://supervisor/core/api`), `SUPERVISOR_TOKEN`. See `.env.example` in
  `frame_art_manager/app/`.
- `NODE_ENV=development` runs fully outside HA: HA routes are mocked
  (`routes/ha.js` `requireHA`), analytics reads `app/test-data/mock-logs/`.
- Routes: `routes/{images,tags,sync,ha,analytics}.js`. Analytics parses JSONL
  (`events.json` — one JSON object per line; do NOT revert to array format, see
  v1.25.9–11 history).
- HA coupling: service calls to `frame_art_shuffler.*` + a Jinja template POSTed to
  `/api/template` that scrapes entities by id suffix (`_current_artwork`, etc.) —
  brittle contract, works over remote HA REST with a token too.
- Startup: verify git → auto-pull → init dirs → `backfillSourceHashes()` (incremental).

## Dev & test

```bash
cd frame_art_manager/app
npm ci
npm test                 # node tests/run-all-tests.js (no framework)
FRAME_ART_PATH=~/devprojects/ha-config/www/frame_art NODE_ENV=development node server.js
```

For a safe scratch library: APFS-clone the checkout (`cp -Rc`) and neuter pushes
(`git remote set-url --push origin PUSH_DISABLED`).

## Deployment

- **Add-on channel (legacy, being retired per the plan)**: `do_release.sh [major|minor|
  patch] ["msg"]` bumps `frame_art_manager/config.yaml`, commits, tags, pushes, then SSHes
  to `ha.mad` and updates installed slug `e2a3b0cb_frame_art_manager`. The add-on maps
  `config:rw`, serves ingress + **unauthenticated LAN port 8099** (known wart; goes away
  with the migration).
- **Fly channel (target)**: `fly/` holds `Dockerfile`, `entrypoint.sh`, `fly.toml`.
  Deploy with `fly deploy --remote-only -c fly/fly.toml --dockerfile fly/Dockerfile`
  (no local Docker on this Mac). Tailnet-only: no `[http_service]`, no public IPs; UI at
  `https://frame.tail9ddff9.ts.net`. Machine must stay always-on (auto-stop can't wake on
  tailnet traffic).

## Gotchas

- zsh eats bare `=` words (`echo ===` fails) — quote separators in shell commands.
- `metadata.json` is the merge-conflict hotspot; the migration makes this repo's instance
  the ONLY writer. Never add a second writer.
- The `home`/`FRAME_ART_HOME` option is vestigial (removed v0.7.5, still plumbed through
  `run.sh`/`server.js`, consumed by nothing).
- `manifest.json`-style docs in `docs/` describe several never-built features
  (e.g. FEATURES.md "Home dropdown") — check code before trusting docs.
