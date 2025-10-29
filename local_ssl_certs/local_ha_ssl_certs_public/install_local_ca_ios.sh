#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PEM_PATH="${SCRIPT_DIR}/rootCA.pem"
DER_PATH="${SCRIPT_DIR}/rootCA.cer"

echo "Preparing iOS/iPadOS trust profile..."

if ! command -v openssl >/dev/null 2>&1; then
	echo "Error: openssl command not found. Please install OpenSSL and retry." >&2
	exit 1
fi

if [[ ! -f "${PEM_PATH}" ]]; then
	echo "Error: PEM certificate not found at ${PEM_PATH}" >&2
	exit 1
fi

echo "Converting ${PEM_PATH} to DER format at ${DER_PATH}..."
openssl x509 -in "${PEM_PATH}" -outform der -out "${DER_PATH}"

cat <<'INSTRUCTIONS'

iOS/iPadOS follow-up steps:
	1. Transfer rootCA.cer to your device (AirDrop or email works well).
	2. On the device, open Settings → Profile Downloaded → Install to add the profile.
	3. Then go to Settings → General → About → Certificate Trust Settings.
	4. Enable "Full Trust" for the HA Frame Art Manager root CA.

The certificate profile is ready at rootCA.cer.

INSTRUCTIONS
