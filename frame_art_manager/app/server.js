const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

// Import route handlers
const imagesRouter = require('./routes/images');
const tvsRouter = require('./routes/tvs');
const tagsRouter = require('./routes/tags');

const app = express();
const PORT = process.env.PORT || 8099;

// Get the frame art path from environment variable or use defaults
// Production (Home Assistant add-on): /config/www/frame_art
// Development: Local path
const FRAME_ART_PATH = process.env.FRAME_ART_PATH || 
  (process.env.NODE_ENV === 'production' 
    ? '/config/www/frame_art' 
    : '/Users/billywaldman/devprojects/ha-config/www/frame_art');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve image library and thumbnails
app.use('/library', express.static(path.join(FRAME_ART_PATH, 'library')));
app.use('/thumbs', express.static(path.join(FRAME_ART_PATH, 'thumbs')));

// Make FRAME_ART_PATH available to all routes
app.use((req, res, next) => {
  req.frameArtPath = FRAME_ART_PATH;
  next();
});

// API Routes
app.use('/api/images', imagesRouter);
app.use('/api/tvs', tvsRouter);
app.use('/api/tags', tagsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    frameArtPath: FRAME_ART_PATH,
    timestamp: new Date().toISOString()
  });
});

// Get raw metadata endpoint
app.get('/api/metadata', async (req, res) => {
  try {
    const metadataPath = path.join(FRAME_ART_PATH, 'metadata.json');
    const data = await fs.readFile(metadataPath, 'utf8');
    res.json(JSON.parse(data));
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
    const metadataPath = path.join(FRAME_ART_PATH, 'metadata.json');

    // Create directories if they don't exist
    await fs.mkdir(libraryPath, { recursive: true });
    await fs.mkdir(thumbsPath, { recursive: true });

    // Create metadata.json if it doesn't exist
    try {
      await fs.access(metadataPath);
    } catch {
      const initialMetadata = {
        version: "1.0",
        images: {},
        tvs: [],
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

// Start server
app.listen(PORT, async () => {
  console.log(`Frame Art Manager running on port ${PORT}`);
  console.log(`Frame art path: ${FRAME_ART_PATH}`);
  await initializeDirectories();
});
