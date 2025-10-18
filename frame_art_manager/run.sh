#!/usr/bin/with-contenv bashio

# Get options from add-on configuration
FRAME_ART_PATH=$(bashio::config 'frame_art_path')
PORT=$(bashio::config 'port')
SSH_KEY_PATH=$(bashio::config 'ssh_key_path')

# Log configuration
bashio::log.info "Starting Frame Art Manager..."
bashio::log.info "Frame Art Path: ${FRAME_ART_PATH}"
bashio::log.info "Port: ${PORT}"

# Set up SSH keys for Git if provided
if bashio::config.has_value 'ssh_key_path'; then
    bashio::log.info "Setting up SSH keys..."
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    
    # Check if key exists (could be in /ssh/ mounted directory or at specified path)
    KEY_SOURCE="${SSH_KEY_PATH}"
    
    # If path starts with /root/.ssh/, try to find it in /ssh/ mount instead
    if [[ "${SSH_KEY_PATH}" == /root/.ssh/* ]]; then
        KEY_NAME=$(basename "${SSH_KEY_PATH}")
        if [ -f "/ssh/${KEY_NAME}" ]; then
            KEY_SOURCE="/ssh/${KEY_NAME}"
            bashio::log.info "Found SSH key in /ssh/ mount: ${KEY_NAME}"
        fi
    fi
    
    if [ -f "${KEY_SOURCE}" ]; then
        KEY_NAME=$(basename "${KEY_SOURCE}")
        cp "${KEY_SOURCE}" /root/.ssh/"${KEY_NAME}"
        chmod 600 /root/.ssh/"${KEY_NAME}"
        
        # Also copy public key if it exists
        if [ -f "${KEY_SOURCE}.pub" ]; then
            cp "${KEY_SOURCE}.pub" /root/.ssh/"${KEY_NAME}.pub"
        fi
        
        # Create SSH config to use this key
        cat > /root/.ssh/config <<EOF
Host github.com
    HostName github.com
    User git
    IdentityFile /root/.ssh/${KEY_NAME}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
        chmod 600 /root/.ssh/config
        
        # Add GitHub to known hosts
        ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
        bashio::log.info "SSH keys configured successfully with ${KEY_NAME}"
    else
        bashio::log.warning "SSH key not found at ${KEY_SOURCE}"
    fi
fi

# Create directories if they don't exist
mkdir -p "${FRAME_ART_PATH}/library"
mkdir -p "${FRAME_ART_PATH}/thumbs"

# Export environment variables for Node.js app
export FRAME_ART_PATH="${FRAME_ART_PATH}"
export PORT="${PORT}"
export NODE_ENV="production"

# Change to app directory
cd /app || bashio::exit.nok "Could not change to app directory"

# Initialize git if not already initialized
if [ ! -d "${FRAME_ART_PATH}/.git" ]; then
    bashio::log.info "Initializing git repository..."
    cd "${FRAME_ART_PATH}" || bashio::exit.nok "Could not change to frame art directory"
    git init
    git lfs install
    cd /app || bashio::exit.nok "Could not change back to app directory"
fi

# Start the application
bashio::log.info "Starting Node.js server..."
exec node server.js
