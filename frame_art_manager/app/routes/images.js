const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const MetadataHelper = require('../metadata_helper');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const libraryPath = path.join(req.frameArtPath, 'library');
    cb(null, libraryPath);
  },
  filename: (req, file, cb) => {
    // Generate UUID
    const uuid = crypto.randomUUID().split('-')[0]; // Use first segment (8 chars)
    
    // Get file extension
    const ext = path.extname(file.originalname);
    
    // Use custom name if provided, otherwise use original filename without extension
    const customName = req.body.customName;
    let baseName;
    
    if (customName && customName.trim()) {
      // Use custom name, sanitize it
      baseName = customName.trim()
        .replace(/[^a-z0-9_-]/gi, '-') // Replace invalid chars with dash
        .replace(/-+/g, '-')            // Remove consecutive dashes
        .toLowerCase();
    } else {
      // Use original filename without extension
      baseName = path.basename(file.originalname, ext)
        .replace(/[^a-z0-9_-]/gi, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
    }
    
    // Construct final filename: basename-uuid.ext
    const finalFilename = `${baseName}-${uuid}${ext}`;
    cb(null, finalFilename);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// GET all images
router.get('/', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const images = await helper.getAllImages();
    res.json(images);
  } catch (error) {
    console.error('Error getting images:', error);
    res.status(500).json({ error: 'Failed to retrieve images' });
  }
});

// GET images by tag
router.get('/tag/:tagName', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const images = await helper.getImagesByTag(req.params.tagName);
    res.json(images);
  } catch (error) {
    console.error('Error getting images by tag:', error);
    res.status(500).json({ error: 'Failed to retrieve images by tag' });
  }
});

// POST upload new image
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const helper = new MetadataHelper(req.frameArtPath);
    const { matte = 'none', filter = 'none', tags = '' } = req.body;
    const tagArray = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];

    // Add to metadata
    const imageData = await helper.addImage(
      req.file.filename,
      matte,
      filter,
      tagArray
    );

    // Generate thumbnail
    try {
      await helper.generateThumbnail(req.file.filename);
    } catch (thumbError) {
      console.error('Error generating thumbnail:', thumbError);
      // Continue even if thumbnail generation fails
    }

    res.json({
      success: true,
      filename: req.file.filename,
      data: imageData
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// PUT update image metadata
router.put('/:filename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const { matte, filter, tags } = req.body;
    
    const updates = {};
    if (matte !== undefined) updates.matte = matte;
    if (filter !== undefined) updates.filter = filter;
    if (tags !== undefined) updates.tags = tags;

    const imageData = await helper.updateImage(req.params.filename, updates);
    res.json({ success: true, data: imageData });
  } catch (error) {
    console.error('Error updating image:', error);
    res.status(404).json({ error: error.message });
  }
});

// POST rename image (change base name, keep UUID)
router.post('/:filename/rename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const oldFilename = req.params.filename;
    const { newBaseName } = req.body;
    
    if (!newBaseName || !newBaseName.trim()) {
      return res.status(400).json({ error: 'New base name is required' });
    }
    
    // Sanitize the new base name
    const sanitizedBaseName = newBaseName.trim()
      .replace(/[^a-z0-9_-]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    
    // Extract UUID and extension from old filename
    const ext = path.extname(oldFilename);
    const nameWithoutExt = path.basename(oldFilename, ext);
    const uuidMatch = nameWithoutExt.match(/-([0-9a-f]{8})$/i);
    
    if (!uuidMatch) {
      return res.status(400).json({ error: 'Could not extract UUID from filename' });
    }
    
    const uuid = uuidMatch[1];
    const newFilename = `${sanitizedBaseName}-${uuid}${ext}`;
    
    // Check if new filename already exists
    const newImagePath = path.join(req.frameArtPath, 'library', newFilename);
    try {
      await fs.access(newImagePath);
      return res.status(400).json({ error: 'A file with this name already exists' });
    } catch {
      // File doesn't exist, we can proceed
    }
    
    // Rename the actual file
    const oldImagePath = path.join(req.frameArtPath, 'library', oldFilename);
    await fs.rename(oldImagePath, newImagePath);
    
    // Rename the thumbnail if it exists
    const oldThumbPath = path.join(req.frameArtPath, 'thumbs', `thumb_${oldFilename}`);
    const newThumbPath = path.join(req.frameArtPath, 'thumbs', `thumb_${newFilename}`);
    try {
      await fs.rename(oldThumbPath, newThumbPath);
    } catch {
      // Thumbnail might not exist, that's ok
    }
    
    // Update metadata
    await helper.renameImage(oldFilename, newFilename);
    
    res.json({ 
      success: true, 
      oldFilename,
      newFilename,
      message: 'Image renamed successfully' 
    });
  } catch (error) {
    console.error('Error renaming image:', error);
    res.status(500).json({ error: 'Failed to rename image' });
  }
});

// DELETE image
router.delete('/:filename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const filename = req.params.filename;

    // Delete from metadata
    await helper.deleteImage(filename);

    // Delete actual file
    const imagePath = path.join(req.frameArtPath, 'library', filename);
    await fs.unlink(imagePath);

    // Delete thumbnail if it exists
    const thumbPath = path.join(req.frameArtPath, 'thumbs', `thumb_${filename}`);
    try {
      await fs.unlink(thumbPath);
    } catch {
      // Thumbnail might not exist, that's ok
    }

    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// POST generate thumbnail for existing image
router.post('/:filename/thumbnail', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const thumbFilename = await helper.generateThumbnail(req.params.filename);
    res.json({ success: true, thumbnail: thumbFilename });
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});

// GET verify sync between files and metadata
router.get('/verify', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const results = await helper.verifySync();
    res.json(results);
  } catch (error) {
    console.error('Error verifying sync:', error);
    res.status(500).json({ error: 'Failed to verify sync' });
  }
});

module.exports = router;
