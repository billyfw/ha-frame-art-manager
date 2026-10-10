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
  (expected remote `billyfw/frame_art`, which the add-on build patches to accept any
  origin; branch `main` hardcoded, pull --rebase
  --autostash, "cloud wins" conflict resolution, semantic commit messages).
  Local dev checkout: `~/devprojects/ha-config/www/frame_art`.
- **`~/devprojects/ha-config`**: Madrone HA config repo (the HA box is `ha.mad` /
  `192.168.1.152`, SSH alias `ssh ha`).

## Every home in one list (2026-10-04, Billy)

The gallery, the display list and the tagsets cover every home at once: `GET /api/ha/tvs?house=all`
merges each house's displays (each carries `house`, `house_name`, `device_name`; with more than one
house its `name` reads "<device> (<house>)") and returns `tagsets` as the union plus
`tagsets_by_house`. Per-display calls (display, select, override, clear-override, upload log) carry
`?house=<that display's house>`. **Tagsets are shared across homes in the UI**: a save goes to every
home (a rename only where the old name exists), a delete to every home that has the tagset, and
selecting a tagset for a display first copies it into that display's home if missing
(`ensureTagsetInHouse`). Statistics, display logs and recency settings stay per home: the `house`
cookie, chosen by the Home picker on the Statistics header and the Recency tab (house-switcher.js).
House labels come from `HOUSES_JSON` names (Madrone, Maui). **A home that does not answer is a red
dot after the display dots** (2026-10-10): its hover reads "<Home>: unreachable (<its displays>)",
the displays as the manager last saw them (`last_displays.js`, in memory: after a restart the names
come back with that home's first answer). With no home answering the row is red dots only.

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
  **Show on TV sends the filename only when a house is set** (`display_payload.js`,
  2026-10-09): the integration resolves it in its own library copy. `image_path` and
  `image_url` are add-on-era fields that only make sense on a shared `/config/www`; from Fly
  they named `/data/frame_art/library/<file>`, the integration takes `image_path` first, and
  every Show on TV at Madrone since the cutover died with "Art file not found" (HA answers a
  bare 500, the UI shows "Request failed with status code 500"). The add-on path still sends
  them. That call waits 120 s (`DISPLAY_TIMEOUT_MS`): HA holds the POST until the TV has the
  picture, 33 s for the fireplace, and the 30 s house default would fail it on the clock.
  `pokeHouses` never logs curl's error message: it is the command line, token included.
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

`npm test` defaults `FRAME_ART_PATH` to the real `ha-config/www/frame_art` checkout and the
git suites clone the real library: run it with `FRAME_ART_PATH=<scratch repo>
GIT_SSH_COMMAND=false` (network tests then skip; 107 pass, 15 skip on 2026-10-05).
`app/node_modules` is committed (stale, despite .gitignore), so a fresh worktree lacks newer
packages: add `NODE_PATH=<a full npm ci install>/node_modules`.

## Deployment

- **Add-on channel (public; Billy no longer runs it)**: neither house has the add-on
  installed (checked live 2026-10-05), but the repo is public and other people install it
  from the add-on store; their issues and PRs land here. The store builds from **main
  HEAD** (no `image:` in config.yaml), so a push to main ships to their next install, and a
  `config.yaml` version bump offers it as an update.
  **Billy's rule (2026-10-05): helping them takes zero risk to his instance.** Their fixes
  go only in the add-on-only files (`frame_art_manager/{Dockerfile,build.yaml,config.yaml,
  run.sh}`), which never reach the Fly image (`fly/Dockerfile` copies only
  `frame_art_manager/app/` and `fly/entrypoint.sh`); a change under `app/` or `fly/` for
  them needs his explicit OK. Example: the add-on Dockerfile patches `expectedRemote` to ''
  at build time (PR #3) instead of changing `git_helper.js`.
  Base image HA 3.22 = Node 22.23.2 (3.19 had 20.15.1, which cannot `require()` the
  ESM-only socks-proxy-agent: every add-on start crashed, issue #4).
  **Never run `do_release.sh`**: after the bump, commit, tag and push it SSHes to `ha.mad`
  and would reinstall and start the add-on there, a second writer to the library. Release
  by hand: bump `version:` in `frame_art_manager/config.yaml`, commit `Release vX.Y.Z -
  <msg>`, `git tag -a vX.Y.Z`, push main with the tag. The add-on maps `config:rw`, serves
  ingress + **unauthenticated LAN port 8099**.
- **Fly channel (target)**: `fly/` holds `Dockerfile`, `entrypoint.sh`, `fly.toml`.
  Machine `8e2d09c7123238` (lax) is **shared-cpu-1x / 512 MB + 256 MB swap since
  2026-09-02** (was 1 GB; measured steady RSS ~180 MB). `fly deploy` reconciles the
  machine to fly.toml's `[[vm]]` + `swap_size_mb`, so change size THERE, not only with
  `fly machine update`. If it ever OOM-restarts under a big LFS sync, go back to 1 GB.
  Deploy with `fly deploy --remote-only -c fly/fly.toml --dockerfile fly/Dockerfile`
  from the repo root (no local Docker; on dev flyctl lives at `~/.fly/bin/flyctl`, logged in
  as Billy since 2026-10-04). Tailnet-only: no `[http_service]`, no public IPs; UI at
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
