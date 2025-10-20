const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const MetadataHelper = require('../metadata_helper');
const ImageEditService = require('../image_edit_service');
const {
  MATTE_TYPES,
  FILTER_TYPES,
  DEFAULT_MATTE,
  DEFAULT_FILTER,
  normalizeMatteValue,
  normalizeFilterValue
} = require('../constants');

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to remove file ${filePath}:`, error);
    }
  }
}

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
    // Accept image files including HEIC/HEIF (which will be converted to JPEG)
    if (file.mimetype.startsWith('image/') || 
        file.mimetype === 'application/octet-stream' && 
        (file.originalname.toLowerCase().endsWith('.heic') || 
         file.originalname.toLowerCase().endsWith('.heif'))) {
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

// GET display options
router.get('/options', (req, res) => {
  res.json({
    matteTypes: MATTE_TYPES,
    filterTypes: FILTER_TYPES
  });
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
  const { matte = DEFAULT_MATTE, filter = DEFAULT_FILTER, tags = '' } = req.body;
    const tagArray = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];

  const normalizedMatte = normalizeMatteValue(matte);
  const normalizedFilter = normalizeFilterValue(filter);

    let finalFilename = req.file.filename;
    let finalFilePath = path.join(req.frameArtPath, 'library', finalFilename);
    
    // Convert HEIC files to JPEG for browser compatibility
    const fileExt = path.extname(req.file.filename).toLowerCase();
    if (fileExt === '.heic' || fileExt === '.heif') {
      console.log(`Converting HEIC file to JPEG: ${req.file.filename}`);
      
      const convert = require('heic-convert');
      const originalPath = req.file.path;
      const jpegFilename = req.file.filename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
      const jpegPath = path.join(req.frameArtPath, 'library', jpegFilename);
      
      try {
        // Read the HEIC file
        const inputBuffer = await fs.readFile(originalPath);
        
        // Convert HEIC to JPEG with high quality (0-1 scale, 0.95 = 95%)
        const outputBuffer = await convert({
          buffer: inputBuffer,
          format: 'JPEG',
          quality: 0.95
        });
        
        // Write the JPEG file
        await fs.writeFile(jpegPath, outputBuffer);
        
        // Delete the original HEIC file
        await fs.unlink(originalPath);
        
        finalFilename = jpegFilename;
        finalFilePath = jpegPath;
        console.log(`Successfully converted to: ${finalFilename}`);
      } catch (conversionError) {
        console.error('Error converting HEIC to JPEG:', conversionError);
        // Clean up if conversion failed
        try {
          await fs.unlink(originalPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        return res.status(500).json({ 
          error: 'Failed to convert HEIC image. Please try uploading as JPEG or PNG.',
          details: conversionError.message
        });
      }
    }

    // Ensure the uploaded file is not empty before proceeding
    try {
      const stats = await fs.stat(finalFilePath);
      if (!stats.size) {
        await removeFileIfExists(finalFilePath);
        return res.status(400).json({ error: 'Uploaded file is empty.' });
      }
    } catch (statError) {
      await removeFileIfExists(finalFilePath);
      return res.status(400).json({ error: 'Uploaded file could not be accessed.' });
    }

    // Add to metadata
    let imageData;
    try {
      imageData = await helper.addImage(
        finalFilename,
        normalizedMatte,
        normalizedFilter,
        tagArray
      );
    } catch (validationError) {
      await removeFileIfExists(finalFilePath);
      console.error('Error validating uploaded image:', validationError);
      return res.status(400).json({
        error: 'Uploaded file is not a valid image.',
        details: validationError.message
      });
    }

    // Generate thumbnail
    try {
      await helper.generateThumbnail(finalFilename);
    } catch (thumbError) {
      console.error('Error generating thumbnail:', thumbError);
      // Continue even if thumbnail generation fails
    }

    res.json({
      success: true,
      filename: finalFilename,
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
  if (matte !== undefined) updates.matte = normalizeMatteValue(matte);
  if (filter !== undefined) updates.filter = normalizeFilterValue(filter);
    if (tags !== undefined) updates.tags = tags;

    const imageData = await helper.updateImage(req.params.filename, updates);
    res.json({ success: true, data: imageData });
  } catch (error) {
    console.error('Error updating image:', error);
    res.status(404).json({ error: error.message });
  }
});

// POST apply image edits (crop, adjustments, filters)
router.post('/:filename/edit', async (req, res) => {
  const filename = req.params.filename;

  try {
    const service = new ImageEditService(req.frameArtPath);
    const operations = req.body && typeof req.body === 'object'
      ? {
          crop: req.body.crop,
          adjustments: req.body.adjustments,
          filter: req.body.filter
        }
      : {};

    const result = await service.applyEdits(filename, operations);

    res.json({
      success: true,
      backupCreated: result.backupCreated,
      hasBackup: true,
      dimensions: result.dimensions,
      aspectRatio: result.aspectRatio,
      operations: result.operations
    });
  } catch (error) {
    console.error('Error applying edits:', error);
    res.status(400).json({ error: error.message || 'Failed to apply edits' });
  }
});

// POST revert image to original backup
router.post('/:filename/revert', async (req, res) => {
  const filename = req.params.filename;

  try {
    const service = new ImageEditService(req.frameArtPath);
    const result = await service.revertToOriginal(filename);

    res.json({
      success: true,
      hasBackup: !!result.hasBackup,
      dimensions: result.dimensions,
      aspectRatio: result.aspectRatio
    });
  } catch (error) {
    console.error('Error reverting to original:', error);
    res.status(400).json({ error: error.message || 'Failed to revert image' });
  }
});

// GET edit state (e.g., backup availability)
router.get('/:filename/edit-state', async (req, res) => {
  const filename = req.params.filename;

  try {
    const service = new ImageEditService(req.frameArtPath);
    const state = await service.getEditState(filename);
    res.json({ success: true, ...state });
  } catch (error) {
    console.error('Error loading edit state:', error);
    res.status(500).json({ error: 'Failed to load edit state' });
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
    
    // Use git mv for atomic rename operation
    const GitHelper = require('../git_helper');
    const git = new GitHelper(req.frameArtPath);
    
    console.log(`[RENAME] Starting rename: ${oldFilename} -> ${newFilename}`);
    
    // 1. Use git mv to rename the image file
    // This stages the rename automatically
    try {
      console.log(`[RENAME] Calling git mv for image...`);
      await git.git.mv(
        path.join('library', oldFilename),
        path.join('library', newFilename)
      );
      console.log(`[RENAME] git mv succeeded for image`);
    } catch (gitMvError) {
      console.error('[RENAME] git mv failed for image:', gitMvError);
      throw new Error(`Failed to rename image file: ${gitMvError.message}`);
    }
    
    // 2. Rename the thumbnail if it exists (also using git mv)
    const oldThumbPath = path.join(req.frameArtPath, 'thumbs', `thumb_${oldFilename}`);
    try {
      await fs.access(oldThumbPath);
      // Thumbnail exists, use git mv
      console.log(`[RENAME] Calling git mv for thumbnail...`);
      await git.git.mv(
        path.join('thumbs', `thumb_${oldFilename}`),
        path.join('thumbs', `thumb_${newFilename}`)
      );
      console.log(`[RENAME] git mv succeeded for thumbnail`);
    } catch (thumbError) {
      // Thumbnail might not exist or git mv failed - log but continue
      console.warn('[RENAME] Thumbnail rename issue:', thumbError.message);
    }
    
    // 3. Update metadata and stage it
    await helper.renameImage(oldFilename, newFilename);
    await git.git.add('metadata.json');
    
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
    const service = new ImageEditService(req.frameArtPath);

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

    await service.removeOriginalBackup(filename);

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
