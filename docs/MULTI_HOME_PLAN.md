# Multi-Home Architecture Plan — Fly.io Central Manager ("C1")

**Status: Phase 1 COMPLETE; Phase 2 IMPLEMENTED (pending deploy) — 2026-07-29**
Phase 1: app `frame-art-manager` live on Fly, node `frame` = 100.104.227.75, HTTPS at
`https://frame.tail9ddff9.ts.net`, 653 images served over tailnet.
Phase 2: `library_sync` module + `sync_library` service + status sensor + timer + logs
HomeAssistantView implemented in frame-art-shuffler with options UI; 57/57 tests pass;
LFS batch auth verified live (§4.1 [verify] resolved: Basic x-access-token works); live
adoption run against billyfw/frame_art adopted all 653 existing files with ZERO downloads
(~3.5 min one-time for serial pointer fetches; subsequent syncs = one tip check).
Remaining for Phase 2 sign-off (§4.4): dev_deploy to Madrone HA + on-box verification —
requires user approval per that repo's workflow rules. Production needs a fine-grained
read-only PAT (live test used a broader gh oauth token).
**Decided:** 2026-07-29, in discussion with Billy. This document is the executable plan.
**Audience:** Any Claude session (or human) continuing this work with NO prior conversation
context. Everything needed is in this file plus the referenced code. Verify claims marked
`[verify]` before relying on them; everything else was read directly from code on 2026-07-29.

---

## 0. The decision and why

Billy bought a second house in **Maui (Launiupoko, "Lau")** which will get its own Home
Assistant instance and at least one Samsung Frame TV (85", living room, "probably more
later"). The frame-art system must serve both houses. After evaluating options, the decision:

**One central Frame Art Manager instance on Fly.io — the ONLY writer to the art library —
with houses reduced to shuffler-only consumers that mirror the library over HTTPS from
GitHub. Both HA add-on installations get retired entirely.**

### Rejected alternatives (do not re-propose without new facts)

| Option | Why rejected |
|---|---|
| Add-on installed in both houses (status quo ×2) | Two writers → `metadata.json` conflicts ("cloud wins" data loss); two UIs; push-capable deploy key duplicated into second house |
| Madrone add-on manages Maui remotely | Couples Maui management to Madrone being up; violates the federation principle in `network-management/maui-expansion.md` §2 ("local autonomy, global observation") |
| "C2" GitOps serverless (static PWA + GitHub Actions ingestion) | Works for the library plane but tagsets/display/analytics are HA-coupled, not git-coupled; too many seams (functions + Actions + R2 + CAS retries + batching). Billy: "too many seams/risk" |
| Cloud storage source of truth (Supabase/S3 + custom sync) | Rebuilds versioning/atomicity/audit/sync that git+LFS already provides; git LFS is working great |
| Houses keep add-on in "sync agent mode" | Houses would need git only because the add-on container carries git. Read-only consumers don't need git at all — see §2. Billy explicitly rejected keeping add-ons |
| Lazy per-image fetch at display time (no house mirror) | Puts the network in the display path; breaks local autonomy (internet down → shuffle can't fetch). Mirror keeps shuffling 100% local |

### Design principles (inherited from the houses' network architecture)

1. **Local autonomy**: each house must keep shuffling art with the internet or any cloud
   piece down. Staleness is acceptable; broken shuffling is not.
2. **Single writer**: exactly one process (Fly manager) ever pushes to the library repo or
   writes `metadata.json`. Houses hold read-only credentials only.
3. **Git remains the source of truth**: `git@github.com:billyfw/frame_art.git` (git + LFS).
   No second datastore.
4. **Tailnet-only exposure**: the manager UI is never on the public internet. Auth = being
   on the Tailscale tailnet. (Amanda's devices are being added to the tailnet — confirmed
   by Billy 2026-07-29.)

---

## 1. Current architecture facts (verified 2026-07-29)

Three git repos in `~/devprojects` plus the library:

### 1.1 `ha-frame-art-manager` (this repo) — the manager

- Node 20 + Express + vanilla-JS frontend (`frame_art_manager/app/public/js/app.js`,
  ~13.5k lines). Backend deps: sharp, heic-convert, multer, simple-git, blockhash-core,
  axios, exif-reader (`frame_art_manager/app/package.json`).
- Packaged as an HA add-on: `frame_art_manager/config.yaml` (version 1.25.11, slug
  `frame_art_manager`, maps `config:rw`, ingress on 8099 **plus raw LAN port 8099 with no
  auth**), `frame_art_manager/Dockerfile` (HA base image + bashio `run.sh`), installed from
  the GitHub add-on repo (`repository.json`), installed slug on the box:
  `e2a3b0cb_frame_art_manager`.
- **Fully env-driven** (`app/server.js`): `FRAME_ART_PATH` (the library checkout),
  `PORT` (default 8099), `FRAME_ART_HOME` (vestigial), `NODE_ENV`,
  `GIT_AUTO_PULL_ON_STARTUP` (default true), `GIT_AUTO_PUSH_ON_CHANGE` (default true),
  `HA_URL` (default `http://supervisor/core/api`), `SUPERVISOR_TOKEN`. Dev mode
  (`NODE_ENV=development`) mocks all HA routes (`app/routes/ha.js` `requireHA` + MOCK_*).
- Startup sequence (`app/server.js:190-197`): listen → `verifyGitConfiguration()`
  (fails soft) → auto-pull if behind → `initializeDirectories()` → `backfillSourceHashes()`
  (**incremental** — `ensureSourceHashes` only fills missing hashes).
- Git logic in `app/git_helper.js` (1721 lines): `expectedRemote = 'billyfw/frame_art'`
  (line 21, verified by substring match line 367), branch hardcoded `main`,
  `pull --rebase --autostash origin main` + `git lfs pull`, semantic commit messages,
  conflict resolution = "cloud wins" with lost-changes report.
- Sync triggers today: server startup; UI page load (`checkSyncOnLoad` → `/api/sync/check`
  → possibly `/api/sync/full`); manual sync button. **No daemon/timer.**
- Analytics (`app/routes/analytics.js`) reads the shuffler's logs **directly off disk**:
  production path `/config/frame_art/logs/` (`events.json` is JSONL as of v1.25.9-11,
  plus `summary.json`, `pending.json`); dev path `app/test-data/mock-logs/`.
- HA calls (`app/routes/ha.js`): axios against `HA_API_BASE`; services used:
  `frame_art_shuffler.display_image`, `upsert_tagset`, `delete_tagset`, `select_tagset`,
  `override_tagset`, `clear_tagset_override`, `set_recency_windows`. `GET /api/ha/tvs`
  POSTs a Jinja template to HA `/api/template` that scrapes attributes off entities whose
  ids end `_current_artwork` / `_auto_shuffle_next` / `_screen_on` (brittle suffix
  contract — works over remote HA REST too, needs only base URL + token).
  `GET /api/ha/pool-health` proxies the integration's `HomeAssistantView` at
  `/api/frame_art_shuffler/pool_health`.
- Upload limits: 50 MB (`app/routes/images.js` fileSize), 25 MB memory-buffered
  duplicate-check path.
- Release: `do_release.sh` bumps `config.yaml` version, commits, tags, pushes, then
  `ssh ha.mad` → `ha refresh-updates` + `ha addons update e2a3b0cb_frame_art_manager`.

### 1.2 `frame-art-shuffler` — the HA custom integration (HACS)

- `custom_components/frame_art_shuffler/`, domain `frame_art_shuffler`, single-instance
  (`config_flow.py` aborts `single_instance_allowed`). Distributed via HACS custom repo
  `https://github.com/billyfw/frame-art-shuffler`; dev loop via `scripts/dev_deploy.sh`
  (tars the component to `/config/custom_components/` over SSH, default host `ha`).
- Pushes art to TVs via vendored `samsungtvws` v3.0.3 (`frame_tv.py`, websocket port 8002,
  chunked upload, matte workaround, WoL by stored MAC). TVs registered manually in options
  flow; per-TV state in `entry.data["tvs"]`; tagsets in `entry.data["tagsets"]`.
  Pairing tokens: `/config/frame_art_shuffler/tokens/<safe_ip>.token`.
- Reads the library from **local disk**: metadata at
  `hass.config.path("www/frame_art/metadata.json")` (`const.py`
  `DEFAULT_METADATA_RELATIVE_PATH`, frozen into `entry.data["metadata_path"]` at setup),
  images resolved as `metadata_path.parent / "library" / filename` (`shuffle.py`,
  `__init__.py display_image`). **It never uses `thumbs/` or `originals/`.**
- Writes display logs to `/config/frame_art/logs/` (`events.json` JSONL, `summary.json`,
  `pending.json`) — `display_log.py`.
- Has a `HomeAssistantView` precedent: `/api/frame_art_shuffler/pool_health`
  (`__init__.py`, `requires_auth = True`).

### 1.3 The library — `git@github.com:billyfw/frame_art.git`

- Layout: `library/` (full images, LFS), `thumbs/` (LFS), `originals/` (LFS),
  `metadata.json` (plain git text — the conflict-prone file), `README.md`.
  `.gitattributes` LFS-tracks image extensions under `library/*` and `thumbs/*`.
- Checkouts today: HA box `/config/www/frame_art` (3.4 GB working tree + LFS cache ≈
  double on disk); dev Mac `~/devprojects/ha-config/www/frame_art` (nested repo inside
  ha-config).
- Metadata schema: `{version, tags: [...], images: {"<filename>": {added, updated,
  aspectRatio, dimensions, filter, matte, tags: [...], sourceHash}}}`. A deprecated `tvs`
  array is stripped by the manager on read. Filenames are content-suffixed
  (e.g. `xmas-a3-pyramid-336f872d.png`) — treat as immutable/cacheable.

### 1.4 Environment inventory (from `network-management`, verified by agent 2026-07-29)

- **Tailnet**: one Tailscale tailnet spans everything; MagicDNS suffix `tail9ddff9.ts.net`.
  Split DNS: domain `mad` → dnsmasq on the HA box (`192.168.1.152`; HA's tailscale IP is
  `100.81.0.118`). `.mad` names are hand-added dnsmasq static records. Planned: `lau` zone
  → resolver on the Maui "net services" box.
- **Madrone HA**: HAOS on Beelink S12 (N95), `ha.mad` / `192.168.1.152`, SSH alias
  `ssh ha` (user `hassio`). HA is ALSO the Madrone subnet router + dnsmasq host (Maui
  design moves those roles to a separate infra box).
- **Maui plan** (`network-management/maui-expansion.md`, `maui-buildout.md`): subnet
  `10.32.1.0/24`, fresh HAOS on a Beelink S12 Pro, new sibling repo `ha-config-lau`,
  federated topology, no dates yet ("draft scope for quote — site walk pending").
  **Maui's HA will NOT be a tailnet node by default** (the infra box subnet-routes) — this
  is why houses must never need to *initiate* connections to tailnet addresses (§2).
- **Dev Mac**: no Docker installed → use `fly deploy --remote-only`. Node v20.19.5 present.
- **Existing remote-access path being retired**: `art-manager.ancwbfw.com` → UniFi DNS →
  NGINX Proxy Manager add-on → ingress redirect (see `local_ssl_certs/
  HA_URL_and_SSL_Setup_README.md`). Retire in Phase 3.

---

## 2. Target architecture

```
                    ┌─────────────────────────────────────────┐
                    │ Fly.io machine "frame" (region lax)     │
                    │  - Express app (this repo, unchanged)   │
                    │  - /data volume: git+LFS checkout       │
                    │  - tailscaled (userspace) + serve TLS   │
                    │  - THE ONLY WRITER (push key here only) │
                    └────────┬───────────────┬────────────────┘
              git push/pull  │               │ 1) HA service calls (display, tagsets)
                             ▼               │ 2) post-push poke: sync_library
                    ┌─────────────┐          │    (Fly → house over tailnet/subnet routes;
                    │   GitHub    │          │     houses NEVER call Fly)
                    │ frame_art   │          ▼
                    │  (git+LFS)  │   ┌──────────────┐    ┌──────────────┐
                    └──────┬──────┘   │ Madrone HA   │    │ Maui HA      │
                           │          │ shuffler +   │    │ shuffler +   │
        HTTPS mirror       └─────────▶│ library_sync │    │ library_sync │
        (Trees/Contents/LFS batch,    └──────┬───────┘    └──────┬───────┘
         read-only PAT, timer +              │ ws:8002 + WoL     │
         poke-triggered)                     ▼                   ▼
                                        Frame TVs           Frame TVs
```

- **UI access**: `https://frame.tail9ddff9.ts.net` (canonical PWA origin, cert via
  `tailscale serve`). Convenience names `frame.mad` / `frame.lau` = dnsmasq static records
  pointing at the Fly node's stable Tailscale 100.x IP; optionally an app-level redirect
  carrying `?house=` context. `.mad`/`.lau` can't get public certs (not real TLDs) — the
  ts.net origin is canonical for exactly this reason.
- **Freshness protocol**: after every successful push, the manager calls HA service
  `frame_art_shuffler.sync_library` on each configured house (it already holds per-house
  tokens for display/tagset calls — same channel, zero new auth surface). Fallback: timer
  in the integration (default 15 min). Poke direction is Fly → house (works for both
  houses via subnet routes); houses only ever talk OUT to GitHub over public HTTPS.
- **House disk**: `/config/www/frame_art/` becomes a plain directory (no `.git`) holding
  `library/` + `metadata.json` only. No thumbs, no originals, no LFS cache → less than
  half today's footprint.
- **Credentials**: Fly holds the ONLY write deploy key. Each house holds a fine-grained
  read-only PAT (Contents: read) scoped to `billyfw/frame_art` only.
- **Cost**: ~$7–8/mo (always-on shared-cpu-1x 1GB ≈ $5.70 + 10GB volume ≈ $1.50).
  ⚠️ **The machine must be always-on.** Fly auto-stop/auto-start is driven by fly-proxy
  watching `[http_service]` traffic; tailnet traffic bypasses fly-proxy entirely, so a
  stopped machine could never wake. Do NOT add `[http_service]` (that would create public
  exposure) and do NOT enable auto_stop.

### What gets deleted when done

- Both HA add-on installations (Madrone's existing one; Maui never gets one).
- The push-capable deploy key from add-on options.
- `.git` + LFS cache from house checkouts (reclaims ~half the space).
- The `art-manager.ancwbfw.com` NPM/redirect path.
- Eventually: `do_release.sh`'s SSH-to-HA update step (add-on channel retired; script
  repurposed for `fly deploy`). Keep the add-on packaging files in-repo until Phase 3
  completes (rollback path), then archive under `frame_art_manager/_archive/` or delete.

---

## 3. Phase 1 — Fly deployment, read-only trial

**Goal**: the manager runs on Fly, reachable over the tailnet, gallery browsable, sync
*pull* working — while Madrone's add-on remains the production writer. Fly gets a
**read-only** deploy key in this phase so it physically cannot push.

### 3.1 Files added in this phase (already created)

- `fly/Dockerfile` — portable image: `node:20-alpine`, apk `git git-lfs openssh-client
  ca-certificates`, tailscale binaries copied from the official image, app copied from
  `frame_art_manager/app/`, entrypoint `fly/entrypoint.sh`.
- `fly/entrypoint.sh` — plain-shell replacement for the bashio `run.sh`:
  1. start tailscaled (userspace networking, state on `/data/tailscale`, SOCKS5+HTTP
     proxy on `localhost:1055`), `tailscale up --hostname=frame`, `tailscale serve` TLS →
     `localhost:8099`;
  2. write SSH key from `GIT_SSH_KEY_B64` secret to `/root/.ssh/id_ed25519`, keyscan
     github.com;
  3. clone `git@github.com:billyfw/frame_art.git` into `$FRAME_ART_PATH` on first boot;
  4. replicate `run.sh`'s LFS-over-SSH config normalization (lines 85–136 of
     `frame_art_manager/run.sh` — `remote.origin.lfsurl`, `lfs.url`, `lfs.ssh.endpoint`,
     unset stale https access keys);
  5. `exec node server.js`.
- `fly/fly.toml` — no `[http_service]` (tailnet-only!), `[mounts]` volume `frame_art_data`
  → `/data`, env `FRAME_ART_PATH=/data/frame_art`, `NODE_ENV=production`,
  `GIT_AUTO_PUSH_ON_CHANGE=false` (Phase 1 safety; flipped in Phase 3), vm 1GB.

### 3.2 Steps to launch (requires Billy or a session with flyctl auth)

```bash
# one-time, from repo root
brew install flyctl && fly auth login              # if not present
fly apps create frame-art-manager                  # or pick free name; update fly.toml [app]
fly volumes create frame_art_data --region lax --size 10 -a frame-art-manager

# secrets — mint FRESH keys, do not reuse the add-on's:
# 1) READ-ONLY deploy key for phase 1:
ssh-keygen -t ed25519 -f /tmp/fly_frame_art_ro -N '' -C fly-frame-art-readonly
#    → add PUBLIC key at github.com/billyfw/frame_art → Settings → Deploy keys
#      (leave "Allow write access" UNCHECKED for phase 1)
fly secrets set -a frame-art-manager GIT_SSH_KEY_B64="$(base64 < /tmp/fly_frame_art_ro)"
# 2) Tailscale auth key: admin console → Settings → Keys → new auth key
#    (reusable OFF, ephemeral OFF, tag e.g. tag:server; then disable key expiry on the
#     node after first join, via admin console → machine → Disable key expiry)
fly secrets set -a frame-art-manager TS_AUTHKEY="tskey-auth-..."

fly deploy --remote-only -c fly/fly.toml --dockerfile fly/Dockerfile
```

### 3.3 Phase 1 verification checklist (executed 2026-07-29)

- [x] `fly logs`: tailscaled up → first-boot clone (actual LFS transfer **1.11 GiB**, 1306
      objects, ~5 min — the 3.4 GB local figure includes git double-storage) → "Git
      configuration valid" → "Server ready".
- [x] Node `frame` on the tailnet at **100.104.227.75** (persisted across restart; key
      expiry disabled in admin console).
- [x] Health/gallery over tailnet from bd: `http://100.104.227.75:8099/api/health` ok,
      `/api/metadata` = **653 images / 18 tags** (remote tip; Mac checkout had been 197
      commits behind), thumbs HTTP 200. Connection is **direct, not DERP-relayed**.
- [x] HTTPS live 2026-07-29: tailnet HTTPS/Serve feature enabled in admin console, then
      activated without restart via `fly ssh console -a frame-art-manager -C "tailscale
      serve --bg localhost:8099"`. Canonical origin verified:
      `https://frame.tail9ddff9.ts.net/api/health` → ok. (Note: enabling HTTPS publishes
      the ts.net hostname in public Certificate Transparency logs — name only, the
      service itself remains tailnet-only. Boot-time serve now succeeds on future
      restarts since the feature is enabled.)
- [x] Skipped deliberately: mutation/push test (double-gated: read-only deploy key AND
      `GIT_AUTO_PUSH_ON_CHANGE=false`; will be exercised at the Phase 3 flip).
- [x] `fly machine restart` → healthy in ~36 s, **no re-clone**, IP unchanged.
- [x] Analytics fail-soft: `/api/analytics/summary` returns 200 (empty data, no logs dir
      on Fly), server stays healthy. Real data arrives in Phase 4 via the shuffler logs
      endpoint.
- Entrypoint hardening added during launch: `--accept-routes` on `tailscale up` (needed
  for subnet-routed HA IPs in Phases 3–4) and `timeout 20` around `tailscale serve`.

### 3.4 Phase 1 gotchas

- **sharp on alpine/arm64 vs amd64**: Fly builders are amd64 by default; `npm ci` in the
  Docker build fetches the right prebuilt binary. The repo's `package.json` has
  `postinstall: npm rebuild sharp` which needs no compiler for prebuilt platforms. If the
  build fails on sharp, add `python3 make g++` to apk (matches the add-on Dockerfile).
- **dotenv**: `server.js` calls `require('dotenv').config()`. Ensure no `.env` file gets
  baked into the image (`fly/Dockerfile` copies `frame_art_manager/app/` — a `.dockerignore`
  excludes `.env`, `node_modules`, `test-data` is KEPT for dev-mode analytics mocks).
- **Do not set `SUPERVISOR_TOKEN`** on Fly. Its absence + `NODE_ENV=production` makes HA
  routes return 503 (correct for Phase 1; Phase 4 replaces this with multi-house config).

---

## 4. Phase 2 — `library_sync` module + logs endpoint in the shuffler

All work in the **`frame-art-shuffler` repo**. This is the one genuinely new piece of the
whole plan (~300–400 lines + tests). It must be reviewed carefully.

### 4.1 New module: `custom_components/frame_art_shuffler/library_sync.py`

Mirrors `library/` + `metadata.json` from GitHub to the local library dir over pure HTTPS.
**No git binary, no checkout.** Config (added to the integration's options flow):

- `github_token` (str, required for sync): fine-grained PAT, resource = `billyfw/frame_art`
  only, permission = Contents: Read-only, no expiry or 1-year with a calendar reminder.
- `library_repo` (str, default `billyfw/frame_art`), `library_branch` (default `main`).
- `sync_interval_minutes` (int, default 15; 0 disables the timer — poke-only).

Algorithm (each sync run; must be idempotent and resumable):

1. `GET /repos/{repo}/branches/{branch}` → tip commit SHA. If equal to
   `state.last_synced_commit`, exit early (cheap no-op poll).
2. `GET /repos/{repo}/git/trees/{tip_sha}?recursive=1` → full file list with **git blob
   SHAs**. ⚠️ For LFS-tracked paths the blob SHA is the sha1 of the *pointer file*, NOT
   the content — it still works as a change detector (pointer changes ⇔ content changes).
   Guard: response has `"truncated": false` (at ~540 files it will be; if it ever
   truncates, page via per-directory tree calls).
3. Filter to `library/*` and `metadata.json` **only** (never thumbs/, originals/).
4. Diff against state file `/config/www/frame_art/.library_sync_state.json`
   (`{path: {blob_sha, size}}`, plus `last_synced_commit`).
5. For each new/changed `library/` file:
   a. Fetch pointer text: `GET /repos/{repo}/contents/{path}?ref={tip_sha}` with header
      `Accept: application/vnd.github.raw+json` (pointer is 3 lines:
      `version …\noid sha256:<hex>\nsize <n>`). Parse oid + size.
   b. Batch (up to ~100 objects per request): `POST
      https://github.com/{repo}.git/info/lfs/objects/batch`, headers
      `Accept: application/vnd.git-lfs+json`, `Content-Type: application/vnd.git-lfs+json`,
      HTTP Basic auth `x-access-token:{PAT}` `[verify: PAT-over-basic works for LFS batch
      on private repos — test with curl before coding; if 401, exchange via the
      `Authorization: token` header form or use the git-credential flow]`, body
      `{"operation":"download","transfers":["basic"],"objects":[{"oid":"...","size":n}]}`.
      Response contains per-object `actions.download.href` (presigned, no auth) + headers.
   c. Download to `<library>/.sync_tmp/<filename>`, verify sha256 == oid and size, then
      atomic `os.replace()` into `library/`. Update state entry immediately (resumability).
6. Deletions: paths in state but not in tree → remove file, drop state entry.
7. **`metadata.json` LAST**, only after all file operations succeeded: fetch via contents
   raw API (if >1 MB use `GET /repos/{repo}/git/blobs/{sha}` with raw accept), write via
   temp + `os.replace`. Ordering guarantees a shuffle never picks a metadata entry whose
   file hasn't landed. (A file present with no metadata entry yet is harmless — shuffle
   reads metadata, not the directory.)
8. Write `last_synced_commit`, fire an HA event `frame_art_shuffler_library_synced`
   `{commit, added, updated, deleted}` for automations/debugging.

Implementation requirements:

- All HTTP via `aiohttp` from HA's shared session (`async_get_clientsession(hass)`);
  hashing and file writes via `hass.async_add_executor_job` (never block the event loop);
  one sync at a time (`asyncio.Lock`); retries with backoff (3×, exponential) on 5xx/network;
  bail cleanly on 401/403 with a persistent notification (bad/expired PAT).
- **First run / adoption**: `/config/www/frame_art` already exists at Madrone as a git
  checkout. Adoption logic: if a `library/` file exists with correct size, accept it and
  record its tree blob_sha in state WITHOUT re-downloading (cheap adoption; full sha256
  verification optional behind a service flag). The initial Maui sync is a full ~2–3 GB
  download (library only, not thumbs/originals) — must survive restarts mid-way
  (per-file state updates give this for free).
- **Never touch** `.git/` if present (Phase 3 removes it manually), tokens dir, logs dir.

### 4.2 New service, entities, and poke endpoint

- Service `frame_art_shuffler.sync_library` (no fields; optional `full_verify: bool`) →
  triggers a sync run. This is what the manager pokes. Registered in `__init__.py`
  alongside existing services; add to `services.yaml`.
- Timer: `async_track_time_interval` per `sync_interval_minutes`.
- Sensor `sensor.frame_art_library_sync`: state = `ok | syncing | error | never`;
  attributes: `last_synced_commit`, `last_sync_time`, `last_error`, `files_added/updated/
  deleted` (last run), `library_file_count`. Lets HA dashboards/alerts see staleness.

### 4.3 Logs endpoint (unblocks Phase 4 analytics)

New `HomeAssistantView` (pattern: copy `pool_health` in `__init__.py`):
`GET /api/frame_art_shuffler/logs?type=events|summary|pending` → streams the file from
`/config/frame_art/logs/` (`events.json` is JSONL — return as `text/plain`; the manager
already parses JSONL via `parseJsonl`). `requires_auth = True` (long-lived token works).
Optional `?since=<iso>` filter for events to bound payload size.

### 4.4 Phase 2 verification (status 2026-07-29)

- [x] Unit tests: 6 new tests in `tests/test_library_sync.py` (ordering, adoption,
      deletion, corruption-blocks-metadata, auth), 57/57 suite green.
- [x] Live module run from the dev Mac against the real repo: adopted 653 files with
      zero downloads, converged to the same commit git reached. (~3.5 min one-time for
      serial pointer fetches; later runs = single tip check.)
- [x] Deployed to Madrone via `dev_deploy.sh --restart` (v0.2.0+dev20260729222116,
      commit e4b79bf). Setup verified: logs endpoint answers 401 (views register LAST in
      async_setup_entry, so 401 proves full setup incl. sync wiring), and the add-on's
      `/api/ha/tvs` template path returns both TVs with attributes.
- [ ] **Awaiting the read-only PAT (Billy, at computer):** integration Options →
      "Library sync settings" → paste token → call `frame_art_shuffler.sync_library` →
      expect on-box adoption of the existing checkout (state file written, sensor `ok`,
      nothing re-downloaded).
- [ ] After PAT: upload via the (still-active) Madrone add-on UI → push → run
      `sync_library` → must fetch the new file + metadata (NOT a no-op — the push moved
      the tip).
- [ ] After PAT: `curl -H "Authorization: Bearer <long-lived-token>"
      "http://ha.mad:8123/api/frame_art_shuffler/logs?type=events" | head`

---

## 5. Phase 3 — The flip (Fly becomes the writer)

Prereqs: Phases 1–2 verified. Do this in one sitting; each step is reversible.

1. **Swap Fly to a write key**: mint a second deploy key (`fly_frame_art_rw`), add to
   GitHub with "Allow write access", `fly secrets set GIT_SSH_KEY_B64=...` (replaces RO
   key), remove the RO deploy key from GitHub.
2. `fly.toml`: set `GIT_AUTO_PUSH_ON_CHANGE=true`; add the houses env (see §6.1
   `HOUSES_JSON`) with at least Madrone so pokes fire; `fly deploy`.
3. **Post-push poke** (small manager change, do in Phase 2/3 window — see §6.2 item 1):
   after successful push, POST each house's
   `{ha_url}/api/services/frame_art_shuffler/sync_library` with its token.
4. **Retire the Madrone add-on**: Settings → Add-ons → Frame Art Manager → Uninstall.
   (Keep the add-on repo listed for rollback; simply reinstalling restores status quo.)
5. **De-git the Madrone checkout** (reclaims ~3+ GB):
   `ssh ha` → `cd /config/www/frame_art && rm -rf .git` (leave `library/`,
   `metadata.json`; optionally `rm -rf thumbs originals` — nothing at the house uses them;
   library_sync state adoption already recorded).
6. **dnsmasq record**: add `frame.mad` → Fly node's tailscale 100.x IP (records live in
   the dnsmasq config on the HA box — see `network-management/README.md` "Static .mad DNS
   Records"; the README's own "return Tailscale IPs" pattern).
7. **Retire `art-manager.ancwbfw.com`**: remove the NPM proxy host + GoDaddy redirect, or
   repoint at the ts.net origin (documented in `local_ssl_certs/`).
8. **Rollback procedure** (if Fly misbehaves): reinstall the add-on from the add-on store
   (config still in HA), re-add the old SSH key to add-on options, restore
   `git clone` at `/config/www/frame_art` (`cd /config/www && mv frame_art frame_art.bak
   && git clone git@github.com:billyfw/frame_art.git frame_art` + LFS config per
   `GETTING_STARTED.md`), disable Fly pushes (`GIT_AUTO_PUSH_ON_CHANGE=false`). Nothing is
   lost in any failure mode because every committed state is on GitHub.

Verification:
- [ ] Upload from phone via `https://frame.tail9ddff9.ts.net` on LTE (not home Wi-Fi) →
      appears on GitHub (`git log`) → Madrone sensor shows new commit within seconds
      (poke) → image displayable on a TV.
- [ ] Pull the Fly machine's plug (`fly machine stop`): houses keep shuffling; timer sync
      no-ops against unchanged GitHub. Start it again; nothing lost.

---

## 6. Phase 4 — Multi-house UI + Maui onboarding

### 6.1 Houses config (manager)

Env `HOUSES_JSON` (Fly secret or fly.toml env), e.g.:

```json
[{"id":"madrone","name":"Madrone","ha_url":"http://100.81.0.118:8123","token_env":"HA_TOKEN_MADRONE"},
 {"id":"lau","name":"Launiupoko","ha_url":"http://<maui-ha-lan-ip>:8123","token_env":"HA_TOKEN_LAU"}]
```

- Tokens are HA long-lived access tokens (create in each HA: profile → Security), stored
  as individual Fly secrets named by `token_env`.
- **Address HA by IP, not `.mad`/`.lau` names** — the container's resolver doesn't do
  split DNS. Madrone: use HA's tailscale IP `100.81.0.118` (HA runs tailscaled directly).
  Maui: HA will NOT be a tailnet node; use its LAN IP (e.g. `10.32.1.x`) which the Fly
  node reaches via the Maui subnet router. Both are stable, static assignments.
- ⚠️ **Userspace tailscaled = outbound tailnet/subnet traffic must go through the SOCKS5/
  HTTP proxy on `localhost:1055`.** The axios calls in `routes/ha.js` (and the new poke)
  need a proxy agent for destinations in `100.64.0.0/10`, `192.168.1.0/24`, `10.32.1.0/24`.
  Implementation: `https-proxy-agent`/`socks-proxy-agent` (add dependency), applied via
  axios `httpAgent/httpsAgent` when `TAILSCALE_PROXY=socks5://localhost:1055` env is set.
  Git/SSH to GitHub is public internet — NO proxy (do not set global `ALL_PROXY`; scope
  the agent to the HA client only).

### 6.2 Manager changes (this repo)

1. **Poke on push** (`git_helper.js` or `routes/sync.js` post-push hook): for each house,
   `POST {ha_url}/api/services/frame_art_shuffler/sync_library` (headers: Bearer token),
   5 s timeout, failures logged but non-fatal (timer catches up). Also expose
   `POST /api/sync/poke-houses` for manual retriggers.
2. **House switcher**: `routes/ha.js` takes `?house=<id>` (default first house) and
   routes to that house's base URL + token; `requireHA` becomes "houses configured?";
   remove the supervisor-proxy default in the Fly context (keep as fallback so the code
   still works if ever run as an add-on again). UI: dropdown in the toolbar (the
   long-planned "Home" dropdown from `docs/FEATURES.md` — implemented as "which HA am I
   talking to", NOT as metadata).
3. **Analytics per house**: `routes/analytics.js` fetches
   `{ha_url}/api/frame_art_shuffler/logs?type=...` (Bearer token, via proxy agent)
   instead of reading `/config/frame_art/logs` from disk. Per-house view first;
   aggregation later if wanted.
4. **Server-side push sweep** (closes the unpushed-window): 60 s interval, if repo dirty
   or ahead → commit (existing semantic message code) + push + poke. Replaces reliance on
   page-load-triggered sync. Env `GIT_PUSH_SWEEP_SECONDS=60`, 0 disables.
5. **PWA-ify** (small): `manifest.webmanifest` + icons + minimal network-first service
   worker (copy the hand-rolled finbox pattern: `~/devprojects/finbox/apps/web/public/
   sw.js` — display/badge only, no offline caching), apple-touch meta in `index.html`.

### 6.3 Maui onboarding (when Maui HA exists — the 10-minute checklist)

1. HACS → add `billyfw/frame-art-shuffler` → install integration; config flow.
2. Options: paste the Lau read-only PAT (mint fresh, same scope), sync interval 15.
3. First sync pulls library-only (~2–3 GB) — watch `sensor.frame_art_library_sync`.
4. Add TVs in options flow (IP, MAC, sensors) once Frame TVs are installed; pair (token
   prompt appears on TV).
5. Madrone HA-independence check: nothing at Maui references Madrone.
6. Manager: add Lau to `HOUSES_JSON` + `fly secrets set HA_TOKEN_LAU=...`; verify house
   switcher shows Lau TVs; verify poke reaches Maui (`fly logs`).
7. `frame.lau` dnsmasq record on the Maui resolver → Fly 100.x IP.

---

## 7. Risk ledger (things a future session should not re-discover)

| Risk | Mitigation |
|---|---|
| DERP-relayed uploads (userspace tailscaled on PaaS often can't hole-punch) → 50 MB uploads slower | Acceptable for art. If painful later: Fly public ingress + auth is the escape hatch (deliberately not built now) |
| GitHub LFS bandwidth quota (house pulls double it; historically ~1 GiB/mo free + $5/50GB packs) | Check current usage on github.com/settings/billing before Phase 3. Library-only mirroring (no thumbs/originals) already cuts house pulls sharply. Escape hatch: self-hosted LFS backend (rudolfs) — a separate project, only if billing bites |
| Tailscale node key expiry takes the manager offline silently | Disable key expiry on the `frame` node in the admin console (step in §3.2); syshealth check later |
| `metadata.json` grows / contents API 1 MB limit | At 538 images ≈ 200 KB. The blobs-API fallback in §4.1 step 7 handles >1 MB indefinitely |
| Trees API `truncated:true` on huge repos | Guard in §4.1 step 2; not expected at this scale |
| Shuffler `entry.data["metadata_path"]` was frozen at config-flow time | It points at `/config/www/frame_art/metadata.json` which does not move. No change needed |
| Manager UI page-load sync assumed local write access; on Fly with houses read-only there is exactly one writer, so `/api/sync/full`'s pull-rebase-push remains safe | No change needed; conflicts structurally impossible once add-ons retired |
| `do_release.sh` still SSHes to `ha.mad` and updates the add-on | Harmless during Phases 1–2 (add-on still deployed). Phase 3: replace with `fly deploy --remote-only`; keep version bump + tag |
| Old committed secrets in `ha-config` repo (UniFi admin password etc., flagged in `maui-expansion.md` §8) | Out of scope here, but do not copy old patterns; all new secrets → Fly secrets / HA secrets.yaml |

## 8. Decision log

- 2026-07-29 — Architecture C1 chosen over C2/D (this doc §0). Amanda will be added to
  the tailnet (auth = tailnet membership, no passkey layer). Houses go shuffler-only; both
  add-ons retire. Library mirror via GitHub HTTPS APIs, not git, at houses. Poke = HA
  service call from the manager post-push. Canonical origin = ts.net name; `frame.mad` /
  `frame.lau` as dnsmasq conveniences. Region `lax`. Always-on machine (no auto-stop —
  incompatible with tailnet-only ingress). Phase 1 uses a read-only deploy key as a
  privilege gate.
