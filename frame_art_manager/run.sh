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
if bashio::config.has_value 'ssh_private_key'; then
    bashio::log.info "Setting up SSH key for Git..."
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    
    # Write the private key to file
    bashio::config 'ssh_private_key' > /root/.ssh/id_ed25519
    chmod 600 /root/.ssh/id_ed25519
    
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
    bashio::log.warning "No SSH private key provided in configuration"
    bashio::log.warning "Git sync will not work without an SSH key"
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
