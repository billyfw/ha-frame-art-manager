#!/bin/bash
# Entrypoint for the Fly.io deployment. Replaces the HA add-on's bashio run.sh.
# Responsibilities: tailscale up (tailnet-only ingress), SSH key from secret,
# clone-on-first-boot, LFS-over-SSH config normalization, exec node.
# See docs/MULTI_HOME_PLAN.md §3.
set -euo pipefail

: "${FRAME_ART_PATH:=/data/frame_art}"
: "${PORT:=8099}"
: "${TS_STATE_DIR:=/data/tailscale}"
: "${TS_HOSTNAME:=frame}"
LIBRARY_REMOTE="${LIBRARY_REMOTE:-git@github.com:billyfw/frame_art.git}"

# ---------------------------------------------------------------- tailscale --
mkdir -p "$TS_STATE_DIR" /var/run/tailscale

# Userspace networking (no /dev/net/tun on Fly). Inbound tailnet traffic works
# natively; OUTBOUND connections to tailnet/subnet-routed IPs must go through the
# SOCKS5 (1055) or HTTP (1056) proxy — used by the HA-calls code in Phase 4
# (TAILSCALE_PROXY env). Git/SSH to GitHub is public internet: no proxy.
/usr/local/bin/tailscaled \
  --state="$TS_STATE_DIR/tailscaled.state" \
  --socket=/var/run/tailscale/tailscaled.sock \
  --tun=userspace-networking \
  --socks5-server=localhost:1055 \
  --outbound-http-proxy-listen=localhost:1056 \
  &

# Wait for tailscaled's socket, then bring the node up. TS_AUTHKEY (Fly secret) is
# only required on first join; afterwards identity lives in $TS_STATE_DIR on the volume.
for i in $(seq 1 15); do
  [ -S /var/run/tailscale/tailscaled.sock ] && break
  sleep 1
done

# --accept-routes: required to reach subnet-routed LAN IPs (Madrone 192.168.1.0/24,
# Maui 10.32.1.0/24) for HA calls and pokes in Phase 3/4.
if [ -n "${TS_AUTHKEY:-}" ]; then
  /usr/local/bin/tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" --accept-routes
else
  /usr/local/bin/tailscale up --hostname="$TS_HOSTNAME" --accept-routes
fi

# HTTPS on the tailnet: https://frame.<tailnet>.ts.net -> localhost:$PORT with an
# auto-provisioned cert. Requires the HTTPS/Serve feature enabled ONCE per tailnet
# (admin console; serve prints an enable link if not). If not yet enabled, serve BLOCKS
# waiting — hence the timeout so boot always proceeds to the clone/app. Re-run later
# without a restart via: fly ssh console -C "tailscale serve --bg localhost:8099"
timeout 20 /usr/local/bin/tailscale serve --bg "localhost:${PORT}" \
  || echo "WARN: tailscale serve not active (feature not enabled yet?); UI reachable at http://<tailscale-ip>:${PORT}"
# Plain HTTP on :80 of the tailnet IP so vanity names (frame.mad / frame.lau)
# work bare in a browser. Canonical PWA origin remains the https ts.net name.
timeout 20 /usr/local/bin/tailscale serve --bg --http=80 "localhost:${PORT}" \
  || echo "WARN: tailscale serve :80 not active"

# ------------------------------------------------------------------ ssh key --
if [ -n "${GIT_SSH_KEY_B64:-}" ]; then
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  echo "$GIT_SSH_KEY_B64" | base64 -d > /root/.ssh/id_ed25519
  chmod 600 /root/.ssh/id_ed25519
  if ! ssh-keygen -y -f /root/.ssh/id_ed25519 > /dev/null 2>&1; then
    echo "ERROR: GIT_SSH_KEY_B64 does not decode to a valid SSH private key" >&2
    exit 1
  fi
  ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null || true
else
  echo "WARN: GIT_SSH_KEY_B64 not set; git sync will not work"
fi

# --------------------------------------------------------- clone first boot --
if [ ! -d "${FRAME_ART_PATH}/.git" ]; then
  echo "First boot: cloning ${LIBRARY_REMOTE} into ${FRAME_ART_PATH} (LFS ~3.4GB, several minutes)..."
  mkdir -p "$(dirname "${FRAME_ART_PATH}")"
  git clone "${LIBRARY_REMOTE}" "${FRAME_ART_PATH}"
fi

# ------------------------------- LFS-over-SSH normalization (from run.sh) --
# Port of frame_art_manager/run.sh lines 85-136: force LFS to use the SSH remote
# so it never falls back to unauthenticated HTTPS.
if git -C "${FRAME_ART_PATH}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  remote_url=$(git -C "${FRAME_ART_PATH}" remote get-url origin 2>/dev/null || true)

  if [ -n "${remote_url}" ] && [[ ${remote_url} != http* ]]; then
    user_part=""
    host_part=""
    path_part=""
    authority=""

    if [[ "${remote_url}" =~ ^([^@]+@)?([^:]+):(.+)$ ]]; then
      user_part="${BASH_REMATCH[1]}"
      host_part="${BASH_REMATCH[2]}"
      path_part="${BASH_REMATCH[3]}"
      authority="${user_part}${host_part}"
    elif [[ "${remote_url}" == ssh://* ]]; then
      trimmed="${remote_url#ssh://}"
      authority="${trimmed%%/*}"
      path_part="${trimmed#*/}"
    fi

    if [ -n "${authority}" ] && [ -n "${path_part}" ]; then
      repo_path="${path_part%.git}"
      [ -z "${repo_path}" ] && repo_path="${path_part}"

      ssh_base_url="ssh://${authority}/${repo_path}"
      ssh_endpoint="${authority}:${repo_path}"

      git -C "${FRAME_ART_PATH}" config remote.origin.lfsurl "${ssh_base_url}"
      git -C "${FRAME_ART_PATH}" config lfs.url "${ssh_base_url}"
      git -C "${FRAME_ART_PATH}" config lfs.ssh.endpoint "${ssh_endpoint}"
      git -C "${FRAME_ART_PATH}" config --unset "lfs.https://github.com/${repo_path}.git/info/lfs.access" 2>/dev/null || true
      git -C "${FRAME_ART_PATH}" config --unset "lfs.https://github.com/${repo_path}/info/lfs.access" 2>/dev/null || true

      echo "Configured Git LFS to use SSH endpoint for origin remote"
    fi
  fi
fi

git -C "${FRAME_ART_PATH}" config user.name "${GIT_COMMIT_USER_NAME:-Frame Art Manager}"
git -C "${FRAME_ART_PATH}" config user.email "${GIT_COMMIT_USER_EMAIL:-frame-art@fly.io}"

# ---------------------------------------------------------------- run app --
export FRAME_ART_PATH PORT
cd /app
echo "Starting Frame Art Manager on port ${PORT} (library: ${FRAME_ART_PATH})"
exec node server.js
