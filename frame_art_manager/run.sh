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
    
    # Write the private key to file using bashio (handles multi-line properly)
    if bashio::config 'ssh_private_key' > /root/.ssh/id_ed25519 2>/dev/null; then
        # Check if key was written successfully and is not empty
        if [ -s /root/.ssh/id_ed25519 ]; then
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
            bashio::log.info "SSH private key is empty, skipping SSH setup"
            bashio::log.warning "Git sync will not work without an SSH key"
        fi
    else
        bashio::log.warning "Failed to write SSH key, skipping SSH setup"
        bashio::log.warning "Git sync will not work without an SSH key"
    fi
else
    bashio::log.info "No SSH private key configured"
    bashio::log.warning "Git sync will not work without an SSH key"
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
