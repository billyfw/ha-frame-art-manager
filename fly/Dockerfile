# Portable (non-HA) image for the central Frame Art Manager on Fly.io.
# Build context = repo root. Deploy from repo root with:
#   fly deploy --remote-only -c fly/fly.toml --dockerfile fly/Dockerfile
# See docs/MULTI_HOME_PLAN.md §3.

FROM node:20-alpine

# bash: entrypoint ports run.sh's bash-regex LFS logic. python3/make/g++: sharp fallback
# compile (normally uses prebuilt binaries; harmless to have).
RUN apk add --no-cache \
    bash \
    curl \
    git \
    git-lfs \
    openssh-client \
    ca-certificates \
    python3 \
    make \
    g++ \
    && git lfs install

# Tailscale binaries from the official image (userspace networking mode; see entrypoint)
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscaled /usr/local/bin/tailscale /usr/local/bin/

WORKDIR /app

COPY frame_art_manager/app/package*.json ./
RUN npm ci --only=production

COPY frame_art_manager/app/ ./

COPY fly/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8099

CMD ["/entrypoint.sh"]
