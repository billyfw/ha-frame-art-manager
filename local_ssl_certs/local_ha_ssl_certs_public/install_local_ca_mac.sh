#!/usr/bin/env bash
set -euo pipefail

# Resolve to the folder this script lives in (works no matter where you run it from)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CA_PEM="${SCRIPT_DIR}/rootCA.pem"
SERVER_PEM="${SCRIPT_DIR}/art-manager.ancwbfw.com.pem"  # optional

if [[ ! -f "$CA_PEM" ]]; then
  echo "❌ rootCA.pem not found next to this script.
Place it at: $CA_PEM
Hint: cp \"\$(mkcert -CAROOT)/rootCA.pem\" \"${SCRIPT_DIR}/\""
  exit 1
fi

echo "🔑 Installing mkcert CA into System keychain (admin password required)…"
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_PEM" || true

if [[ -f "$SERVER_PEM" ]]; then
  echo "📥 (Optional) Importing server cert into login keychain…"
  security add-trusted-cert -d -k ~/Library/Keychains/login.keychain-db "$SERVER_PEM" || true
fi

echo "✅ Done. Restart your browser and open: https://art-manager.ancwbfw.com"
