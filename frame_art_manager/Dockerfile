ARG BUILD_FROM
FROM $BUILD_FROM

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install Node.js, git, and git-lfs
RUN apk add --no-cache \
    nodejs \
    npm \
    git \
    git-lfs \
    openssh-client \
    python3 \
    make \
    g++ \
    jq \
    && git lfs install

# Set working directory
WORKDIR /app

# Copy package files
COPY app/package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy application files
COPY app/ ./

# Add-on users sync their own art library, not billyfw/frame_art: accept any origin
# remote (PR #3). Patched here, in the add-on build only, so the app code Billy's
# hosted instance runs stays untouched. The grep fails the build if that line changes.
RUN sed -i "s|this.expectedRemote = 'billyfw/frame_art';|this.expectedRemote = '';|" git_helper.js \
    && grep -q "this.expectedRemote = '';" git_helper.js

# Create run script
COPY run.sh /
RUN chmod a+x /run.sh

# Expose port
EXPOSE 8099

# Run the add-on
CMD [ "/run.sh" ]
