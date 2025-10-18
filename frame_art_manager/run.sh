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
    
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    
    # The SSH private key is provided as a list of strings (one per line)
    # bashio::config returns it as JSON, use jq to extract each line
    bashio::log.info "Reading SSH private key from list format..."
    
    KEY_PATH=/root/.ssh/id_ed25519
    rm -f "${KEY_PATH}"
    
    # Debug: Check if jq is available
    if ! command -v jq >/dev/null 2>&1; then
        bashio::log.error "jq is not installed!"
        bashio::exit.nok "jq is required but not found"
    fi
    bashio::log.info "✓ jq is available: $(jq --version 2>&1)"
    
    # Debug: Get the raw config output
    bashio::log.info "Getting raw SSH key config..."
    RAW_CONFIG=$(bashio::config 'ssh_private_key' 2>&1)
    CONFIG_EXIT_CODE=$?
    
    if [ $CONFIG_EXIT_CODE -ne 0 ]; then
        bashio::log.error "Failed to read ssh_private_key config. Exit code: ${CONFIG_EXIT_CODE}"
        bashio::log.error "Error output: ${RAW_CONFIG}"
        bashio::exit.nok "Cannot read SSH key configuration"
    fi
    
    bashio::log.info "Raw config output (first 200 chars): ${RAW_CONFIG:0:200}"
    
    # Try to parse with jq
    bashio::log.info "Parsing SSH key array with jq..."
    echo "${RAW_CONFIG}" | jq -r '.[]' > "${KEY_PATH}" 2>/tmp/jq_error.log
    JQ_EXIT_CODE=$?
    
    if [ $JQ_EXIT_CODE -ne 0 ]; then
        bashio::log.error "Failed to parse SSH key with jq. Exit code: ${JQ_EXIT_CODE}"
        if [ -f /tmp/jq_error.log ]; then
            bashio::log.error "jq error output:"
            cat /tmp/jq_error.log | while IFS= read -r line; do
                bashio::log.error "  ${line}"
            done
        fi
        bashio::exit.nok "Failed to parse SSH key configuration with jq"
    fi
    
    bashio::log.info "✓ jq parsing succeeded"
    
    if [ -s "${KEY_PATH}" ]; then
        KEY_LINES=$(wc -l < "${KEY_PATH}" | tr -d ' ')
        KEY_BYTES=$(wc -c < "${KEY_PATH}" | tr -d ' ')
        bashio::log.info "SSH key reconstructed: ${KEY_BYTES} bytes across ${KEY_LINES} line(s)"
        
        # Verify it looks like a valid key format
        FIRST_LINE=$(head -n 1 "${KEY_PATH}")
        LAST_LINE=$(tail -n 1 "${KEY_PATH}")
        bashio::log.info "Key starts with: ${FIRST_LINE}"
        bashio::log.info "Key ends with: ${LAST_LINE}"
        
        chmod 600 "${KEY_PATH}"
        
        # Test if we can extract the public key
        bashio::log.info "Validating SSH key with ssh-keygen..."
        if ssh-keygen -y -f "${KEY_PATH}" > /tmp/test_pubkey 2>/tmp/ssh-keygen-error.log; then
            bashio::log.info "✓ SSH key is valid"
            FINGERPRINT=$(ssh-keygen -lf "${KEY_PATH}" 2>/dev/null | awk '{print $2}')
            if bashio::var.has_value "${FINGERPRINT}"; then
                bashio::log.info "SSH key fingerprint: ${FINGERPRINT}"
            fi
        else
            bashio::log.error "✗ SSH key validation failed. Error:"
            cat /tmp/ssh-keygen-error.log | while IFS= read -r line; do
                bashio::log.error "  ${line}"
            done
            bashio::log.error "Please verify your SSH key is entered correctly (one line per entry)"
            rm -f "${KEY_PATH}"
            bashio::exit.nok "Invalid SSH key"
        fi
        
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
    LogLevel DEBUG3
EOF
        chmod 600 /root/.ssh/config
        
        bashio::log.info "SSH config created:"
        cat /root/.ssh/config | while IFS= read -r line; do
            bashio::log.info "  ${line}"
        done
        
        # Add GitHub to known_hosts
        ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
        bashio::log.info "Added github.com to known_hosts"
        
        # Test SSH connection
        bashio::log.info "Testing SSH connection to ${GIT_HOST_ALIAS}..."
        if ssh -T git@${GIT_HOST_ALIAS} 2>&1 | tee /tmp/ssh-test.log; then
            bashio::log.info "SSH test output: $(cat /tmp/ssh-test.log)"
        else
            bashio::log.warning "SSH test failed. Output:"
            cat /tmp/ssh-test.log | while IFS= read -r line; do
                bashio::log.warning "  ${line}"
            done
        fi
        
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
