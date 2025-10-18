#!/usr/bin/with-contenv bashio

# Get options from add-on configuration
FRAME_ART_PATH=$(bashio::config 'frame_art_path')
PORT=$(bashio::config 'port')

# Log configuration
bashio::log.info "Starting Frame Art Manager..."
bashio::log.info "Frame Art Path: ${FRAME_ART_PATH}"
bashio::log.info "Port: ${PORT}"

# Set up SSH keys for Git if provided
if bashio::config.has_value 'ssh_private_key'; then
    bashio::log.info "Setting up SSH key for Git..."
    RAW_KEY_TEMP=$(mktemp)

    if bashio::config 'ssh_private_key' > "${RAW_KEY_TEMP}" 2>/dev/null; then
        RAW_KEY_BYTES=$(wc -c < "${RAW_KEY_TEMP}" | tr -d ' ')
        RAW_KEY_LINES=$(wc -l < "${RAW_KEY_TEMP}" | tr -d ' ')
        bashio::log.info "SSH key option retrieved: ${RAW_KEY_BYTES} bytes across ${RAW_KEY_LINES} line(s)"
    else
        bashio::log.warning "Unable to read ssh_private_key option"
    fi
    
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    
    # Write the private key to file using bashio (handles multi-line properly)
    TEMP_KEY=$(mktemp)
    if [ -f "${RAW_KEY_TEMP}" ]; then
        tr -d '\r' < "${RAW_KEY_TEMP}" > "${TEMP_KEY}"
    elif bashio::config 'ssh_private_key' > "${TEMP_KEY}" 2>/dev/null; then
        tr -d '\r' < "${TEMP_KEY}" > "${TEMP_KEY}.sanitized"
        mv "${TEMP_KEY}.sanitized" "${TEMP_KEY}"
    fi

    mv "${TEMP_KEY}" /root/.ssh/id_ed25519
    rm -f "${RAW_KEY_TEMP}" 2>/dev/null || true

    KEY_PATH=/root/.ssh/id_ed25519
    VALID_KEY=false

    if [ -s "${KEY_PATH}" ]; then
        SANITIZED_BYTES=$(wc -c < "${KEY_PATH}" | tr -d ' ')
        SANITIZED_LINES=$(wc -l < "${KEY_PATH}" | tr -d ' ')
        bashio::log.info "Sanitized SSH key size: ${SANITIZED_BYTES} bytes across ${SANITIZED_LINES} line(s)"

        # If there are no newline characters but we see literal \n, decode them
        if [ "${SANITIZED_LINES}" -eq 0 ] && grep -q '\\n' "${KEY_PATH}"; then
            bashio::log.info "Detected literal \\n sequences in SSH key; converting to real newlines"
            ESCAPED_CONTENT=$(cat "${KEY_PATH}")
            printf '%b' "${ESCAPED_CONTENT}" > "${KEY_PATH}.decoded"
            mv "${KEY_PATH}.decoded" "${KEY_PATH}"
            SANITIZED_LINES=$(wc -l < "${KEY_PATH}" | tr -d ' ')
            bashio::log.info "After decoding, SSH key has ${SANITIZED_LINES} line(s)"
        fi

        if ssh-keygen -y -f "${KEY_PATH}" >/dev/null 2>&1; then
            VALID_KEY=true
            FINGERPRINT=$(ssh-keygen -lf "${KEY_PATH}" 2>/dev/null | awk '{print $2}')
            if bashio::var.has_value "${FINGERPRINT}"; then
                bashio::log.info "SSH key fingerprint detected: ${FINGERPRINT}"
            fi
        else
            bashio::log.warning "SSH private key failed validation (ssh-keygen). Attempting to use it anyway."
            VALID_KEY=true
        fi
    fi

    if [ "${VALID_KEY}" = true ]; then
        chmod 600 "${KEY_PATH}"
            
            # Get the git remote host alias (default: github-billy)
            GIT_HOST_ALIAS=$(bashio::config 'git_remote_host_alias')
            if bashio::var.is_empty "${GIT_HOST_ALIAS}"; then
                GIT_HOST_ALIAS="github-billy"
            fi
            
            # Create SSH config for the git remote host
            cat > /root/.ssh/config <<EOF
Host ${GIT_HOST_ALIAS}
    HostName github.com
    User git
    IdentityFile /root/.ssh/id_ed25519
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
            chmod 600 /root/.ssh/config
            
            # Add GitHub to known_hosts
            ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
            
            bashio::log.info "SSH key configured for ${GIT_HOST_ALIAS}"
    else
        rm -f "${KEY_PATH}"
        bashio::log.error "SSH private key provided is invalid or empty"
        bashio::log.warning "Git sync will not work without a valid SSH key"
    fi
else
    bashio::log.info "No SSH private key configured"
    bashio::log.warning "Git sync will not work without an SSH key"
fi

# Verify that the Home Assistant config share is mounted when using /config paths
if [[ "${FRAME_ART_PATH}" == /config/* ]] && [ ! -d "/config/.storage" ]; then
    bashio::log.error "Home Assistant /config share is not mounted. Check add-on map configuration."
    bashio::exit.nok "Cannot proceed without access to /config"
fi

# Ensure the frame art directory exists and is accessible
if [ ! -d "${FRAME_ART_PATH}" ]; then
    bashio::log.info "Creating frame art directory: ${FRAME_ART_PATH}"
    mkdir -p "${FRAME_ART_PATH}"
fi

# Export environment variables for Node.js app
export FRAME_ART_PATH="${FRAME_ART_PATH}"
export PORT="${PORT}"
export NODE_ENV="production"

# Change to app directory
cd /app || bashio::exit.nok "Could not change to app directory"

# Start the application
bashio::log.info "Starting Node.js server..."
exec node server.js
