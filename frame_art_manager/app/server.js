// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Import route handlers
const imagesRouter = require('./routes/images');
const tagsRouter = require('./routes/tags');
const syncRouter = require('./routes/sync');
const haRouter = require('./routes/ha');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 8099;
const FRAME_ART_HOME = process.env.FRAME_ART_HOME || '';

// Get the frame art path from environment variable or use defaults
// Production (Home Assistant add-on): /config/www/frame_art
// Development: Set FRAME_ART_PATH in .env file
let FRAME_ART_PATH = process.env.FRAME_ART_PATH || 
  (process.env.NODE_ENV === 'production' 
    ? '/config/www/frame_art' 
    : null);

// Expand tilde (~) to home directory if present
if (FRAME_ART_PATH && FRAME_ART_PATH.startsWith('~/')) {
  FRAME_ART_PATH = path.join(os.homedir(), FRAME_ART_PATH.slice(2));
}

// Validate that FRAME_ART_PATH is set
if (!FRAME_ART_PATH) {
  console.error('ERROR: FRAME_ART_PATH environment variable is not set.');
  console.error('Please create a .env file based on .env.example and set your FRAME_ART_PATH.');
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Expose add-on configuration to templates/routes
app.locals.addonHome = FRAME_ART_HOME;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve image library and thumbnails
app.use('/library', express.static(path.join(FRAME_ART_PATH, 'library')));
app.use('/thumbs', express.static(path.join(FRAME_ART_PATH, 'thumbs')));

// Make FRAME_ART_PATH available to all routes
app.use((req, res, next) => {
  req.frameArtPath = FRAME_ART_PATH;
  req.frameArtHome = FRAME_ART_HOME;
  next();
});

// API Routes
app.use('/api/images', imagesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/ha', haRouter);
app.use('/api/analytics', analyticsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    frameArtPath: FRAME_ART_PATH,
    home: FRAME_ART_HOME || null,
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Get raw metadata endpoint
app.get('/api/metadata', async (req, res) => {
  try {
    const metadataPath = path.join(FRAME_ART_PATH, 'metadata.json');
    const data = await fs.readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(data);
    
    // Deprecate 'tvs' array - remove it if present
    if (parsed.tvs) {
      delete parsed.tvs;
    }
    
    res.json(parsed);
  } catch (error) {
    console.error('Error reading metadata:', error);
    res.status(500).json({ error: 'Failed to read metadata' });
  }
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize directories on startup
async function initializeDirectories() {
  try {
    const libraryPath = path.join(FRAME_ART_PATH, 'library');
  const thumbsPath = path.join(FRAME_ART_PATH, 'thumbs');
  const originalsPath = path.join(FRAME_ART_PATH, 'originals');
    const metadataPath = path.join(FRAME_ART_PATH, 'metadata.json');

    // Create directories if they don't exist
    await fs.mkdir(libraryPath, { recursive: true });
  await fs.mkdir(thumbsPath, { recursive: true });
  await fs.mkdir(originalsPath, { recursive: true });

    // Create metadata.json if it doesn't exist
    try {
      await fs.access(metadataPath);
    } catch {
      const initialMetadata = {
        version: "1.0",
        images: {},
        tags: []
      };
      await fs.writeFile(metadataPath, JSON.stringify(initialMetadata, null, 2));
      console.log('Created initial metadata.json');
    }

    console.log('Directories initialized successfully');
  } catch (error) {
    console.error('Error initializing directories:', error);
  }
}

// Verify Git repository configuration on startup
async function verifyGitConfiguration() {
  const GitHelper = require('./git_helper');
  
  try {
    console.log('\n🔍 Verifying Git configuration...');
    const git = new GitHelper(FRAME_ART_PATH);
    const verification = await git.verifyConfiguration();
    
    if (verification.isValid) {
      console.log('✅ Git configuration valid');
      console.log(`   - Repository: ${verification.checks.remoteUrl}`);
      console.log(`   - Branch: ${verification.checks.currentBranch}`);
      console.log(`   - Git LFS: Configured`);
      
      // Auto-sync on startup if enabled
      if (process.env.GIT_AUTO_PULL_ON_STARTUP !== 'false') {
        console.log('\n🔄 Syncing with remote...');
        const syncResult = await git.checkAndPullIfBehind();
        
        if (syncResult.success && syncResult.pulledChanges) {
          console.log(`✅ ${syncResult.message}`);
        } else if (syncResult.skipped) {
          console.warn(`⚠️  WARNING: ${syncResult.reason}`);
          if (syncResult.uncommittedFiles && syncResult.uncommittedFiles.length > 0) {
            console.warn('   Files:', syncResult.uncommittedFiles.join(', '));
          }
          console.warn('   Skipping auto-pull to avoid conflicts.');
          console.warn('   Please commit or stash changes manually, then restart or use manual sync.');
        } else if (!syncResult.success) {
          console.warn(`⚠️  Sync failed: ${syncResult.error}`);
          if (syncResult.hasConflicts) {
            console.warn('   Merge conflicts detected - manual resolution required.');
          }
        } else {
          console.log('✅ Already up to date');
        }
      }
    } else {
      console.warn('⚠️  WARNING: Git configuration issues detected:');
      verification.errors.forEach(error => {
        console.warn(`   - ${error}`);
      });
      console.warn('\n   Sync operations may not work correctly.');
      console.warn('   Please ensure FRAME_ART_PATH points to the billyfw/frame_art repository.');
    }
  } catch (error) {
    console.error('❌ Error verifying Git configuration:', error.message);
    console.error('   Sync features will be unavailable.');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Frame Art Manager running on port ${PORT}`);
  console.log(`Frame art path: ${FRAME_ART_PATH}`);
  await verifyGitConfiguration();
  await initializeDirectories();
  console.log('\n✨ Server ready!\n');
});
