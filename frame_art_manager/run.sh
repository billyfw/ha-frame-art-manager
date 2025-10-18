#!/usr/bin/with-contenv bashio

# Get options from add-on configuration
FRAME_ART_PATH=$(bashio::config 'frame_art_path')
PORT=$(bashio::config 'port')

# Log configuration
bashio::log.info "Starting Frame Art Manager..."
bashio::log.info "Frame Art Path: ${FRAME_ART_PATH}"
bashio::log.info "Port: ${PORT}"

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
