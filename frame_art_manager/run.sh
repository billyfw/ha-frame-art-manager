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
    
    KEY_PATH=/root/.ssh/id_ed25519
    rm -f "${KEY_PATH}"
    
    # Get SSH key from config (bashio returns it as a plain string with the array joined)
    RAW_CONFIG=$(bashio::config 'ssh_private_key' 2>&1)
    
    if [ $? -ne 0 ]; then
        bashio::log.error "Failed to read SSH key configuration"
        bashio::exit.nok "Cannot read SSH key configuration"
    fi
    
    # Write the key to file
    echo "${RAW_CONFIG}" > "${KEY_PATH}"
    chmod 600 "${KEY_PATH}"
    
    # Validate the SSH key
    if ! ssh-keygen -y -f "${KEY_PATH}" > /dev/null 2>&1; then
        bashio::log.error "Invalid SSH key. Please verify your key is entered correctly (one line per entry)"
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
EOF
    chmod 600 /root/.ssh/config
    
    # Add GitHub to known_hosts
    ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
    
    bashio::log.info "✓ SSH key configured for ${GIT_HOST_ALIAS}"
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

# Ensure Git LFS uses the SSH remote when available
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
            if [ -z "${repo_path}" ]; then
                repo_path="${path_part}"
            fi

            ssh_base_url="ssh://${authority}/${repo_path}"
            ssh_endpoint="${authority}:${repo_path}"

            current_remote_lfs=$(git -C "${FRAME_ART_PATH}" config --get remote.origin.lfsurl 2>/dev/null || true)
            if [ "${current_remote_lfs}" != "${ssh_base_url}" ]; then
                git -C "${FRAME_ART_PATH}" config remote.origin.lfsurl "${ssh_base_url}"
            fi

            current_lfs_url=$(git -C "${FRAME_ART_PATH}" config --get lfs.url 2>/dev/null || true)
            if [ "${current_lfs_url}" != "${ssh_base_url}" ]; then
                git -C "${FRAME_ART_PATH}" config lfs.url "${ssh_base_url}"
            fi

            current_endpoint=$(git -C "${FRAME_ART_PATH}" config --get lfs.ssh.endpoint 2>/dev/null || true)
            if [ "${current_endpoint}" != "${ssh_endpoint}" ]; then
                git -C "${FRAME_ART_PATH}" config lfs.ssh.endpoint "${ssh_endpoint}"
            fi

            git -C "${FRAME_ART_PATH}" config --unset "lfs.https://github.com/${repo_path}.git/info/lfs.access" 2>/dev/null || true
            git -C "${FRAME_ART_PATH}" config --unset "lfs.https://github.com/${repo_path}/info/lfs.access" 2>/dev/null || true

            bashio::log.info "Configured Git LFS to use SSH endpoint for origin remote"
        fi
    fi
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
