const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const heicConvert = require('heic-convert');
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

const LIBRARY_DIR = 'library';
const THUMBS_DIR = 'thumbs';
const ORIGINALS_DIR = 'originals';
const FALLBACK_BASE_NAME = 'image';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence'
]);

function sanitizeBaseName(rawName, fallback = FALLBACK_BASE_NAME) {
  if (!rawName || typeof rawName !== 'string') {
    return fallback;
  }

  const normalized = rawName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

function determineExtension(file) {
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  if (originalExt) {
    return originalExt;
  }

  const mimetype = (file.mimetype || '').toLowerCase();
  switch (mimetype) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/avif':
      return '.avif';
    case 'image/heic':
    case 'image/heif':
    case 'image/heic-sequence':
    case 'image/heif-sequence':
      return '.heic';
    default:
      return '.jpg';
  }
}

function extractUuidSegment(filename) {
  const match = filename.match(/-([0-9a-f]{8})(\.[^.]+)$/i);
  return match ? match[1] : null;
}

function baseWithoutUuid(filename) {
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  return nameWithoutExt.replace(/-([0-9a-f]{8})$/i, '');
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to remove file ${filePath}:`, error);
    }
  }
}

async function applyCustomUploadName({
  frameArtPath,
  currentFilename,
  currentFilePath,
  customName,
  uploadContext
}) {
  const extension = path.extname(currentFilename).toLowerCase();
  const libraryPath = path.join(frameArtPath, LIBRARY_DIR);

  const context = {
    originalBase: uploadContext?.originalBase || baseWithoutUuid(currentFilename) || FALLBACK_BASE_NAME,
    uuid: uploadContext?.uuid || extractUuidSegment(currentFilename) || crypto.randomUUID().split('-')[0],
    originalExt: uploadContext?.originalExt || extension
  };

  let targetBase = context.originalBase;
  if (typeof customName === 'string' && customName.trim()) {
    const sanitizedCustom = sanitizeBaseName(customName, context.originalBase);
    if (sanitizedCustom) {
      targetBase = sanitizedCustom;
    }
  }

  let candidateFilename = `${targetBase}-${context.uuid}${extension}`;
  let candidatePath = path.join(libraryPath, candidateFilename);

  if (candidateFilename === currentFilename) {
    return {
      filename: currentFilename,
      filepath: currentFilePath,
      context: { ...context, originalBase: targetBase, originalExt: extension }
    };
  }

  while (true) {
    try {
      await fs.access(candidatePath);
      context.uuid = crypto.randomUUID().split('-')[0];
      candidateFilename = `${targetBase}-${context.uuid}${extension}`;
      candidatePath = path.join(libraryPath, candidateFilename);
    } catch (error) {
      if (error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }

  await fs.rename(currentFilePath, candidatePath);

  return {
    filename: candidateFilename,
    filepath: candidatePath,
    context: { ...context, originalBase: targetBase, originalExt: extension }
  };
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const libraryPath = path.join(req.frameArtPath, LIBRARY_DIR);
    fs.mkdir(libraryPath, { recursive: true })
      .then(() => cb(null, libraryPath))
      .catch(cb);
  },
  filename(req, file, cb) {
    try {
      const extension = determineExtension(file);
      const originalBase = sanitizeBaseName(
        path.basename(file.originalname || '', path.extname(file.originalname || '')),
        FALLBACK_BASE_NAME
      );
      const uuidSegment = crypto.randomUUID().split('-')[0];
      const finalFilename = `${originalBase}-${uuidSegment}${extension}`;
      req.uploadContext = {
        originalBase,
        uuid: uuidSegment,
        originalExt: extension
      };
      cb(null, finalFilename);
    } catch (error) {
      cb(error);
    }
  }
});

const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence'
]);

function imageFileFilter(req, file, cb) {
  const mimetype = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ALLOWED_MIME_TYPES.has(mimetype) || HEIC_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else if (mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    const error = new Error('Unsupported file type');
    error.statusCode = 400;
    cb(error);
  }
}

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

const previewUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

function isHeicType({ mimetype, ext }) {
  const normalizedMime = (mimetype || '').toLowerCase();
  const normalizedExt = (ext || '').toLowerCase();
  return HEIC_MIME_TYPES.has(normalizedMime) || HEIC_EXTENSIONS.has(normalizedExt);
}

function extensionToContentType(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}

async function convertHeicBufferToJpeg(buffer, quality = 0.95) {
  return heicConvert({
    buffer,
    format: 'JPEG',
    quality
  });
}

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

router.get('/options', (req, res) => {
  res.json({
    matteTypes: MATTE_TYPES,
    filterTypes: FILTER_TYPES
  });
});

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

router.post('/preview', previewUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const ext = determineExtension(req.file);
    const isHeic = isHeicType({ mimetype: req.file.mimetype, ext });
    const contentType = isHeic
      ? 'image/jpeg'
      : req.file.mimetype || extensionToContentType(ext);

    const outputBuffer = isHeic
      ? await convertHeicBufferToJpeg(req.file.buffer, 0.9)
      : req.file.buffer;

    res.set('Content-Type', contentType || extensionToContentType(ext));
    res.set('Cache-Control', 'no-store');
    res.send(outputBuffer);
  } catch (error) {
    console.error('Error generating preview image:', error);
    res.status(500).json({ error: 'Failed to generate preview image.' });
  }
});

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const helper = new MetadataHelper(req.frameArtPath);
    const { matte = DEFAULT_MATTE, filter = DEFAULT_FILTER, tags = '' } = req.body;

    const tagArray = Array.isArray(tags)
      ? tags.map(tag => String(tag).trim()).filter(Boolean)
      : typeof tags === 'string'
        ? tags.split(',').map(tag => tag.trim()).filter(Boolean)
        : [];

    const normalizedMatte = normalizeMatteValue(matte);
    const normalizedFilter = normalizeFilterValue(filter);

    let finalFilename = req.file.filename;
    let finalFilePath = req.file.path;

    const fileExt = path.extname(finalFilename).toLowerCase();
    if (isHeicType({ mimetype: req.file.mimetype, ext: fileExt })) {

      const originalPath = req.file.path;
      const jpegFilename = finalFilename.replace(/\.(heic|heif)$/i, '.jpg');
      const jpegPath = path.join(req.frameArtPath, LIBRARY_DIR, jpegFilename);

      try {
        const inputBuffer = await fs.readFile(originalPath);
        const outputBuffer = await convertHeicBufferToJpeg(inputBuffer, 0.95);

        await fs.writeFile(jpegPath, outputBuffer);
        await fs.unlink(originalPath);

        finalFilename = jpegFilename;
        finalFilePath = jpegPath;
        if (req.uploadContext) {
          req.uploadContext.originalExt = '.jpg';
        }

        req.file.filename = finalFilename;
        req.file.path = finalFilePath;
      } catch (conversionError) {
        console.error('Error converting HEIC to JPEG:', conversionError);
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

    const renameResult = await applyCustomUploadName({
      frameArtPath: req.frameArtPath,
      currentFilename: finalFilename,
      currentFilePath: finalFilePath,
      customName: req.body.customName,
      uploadContext: req.uploadContext || {}
    });

    finalFilename = renameResult.filename;
    finalFilePath = renameResult.filepath;
    req.uploadContext = renameResult.context;
    req.file.filename = finalFilename;
    req.file.path = finalFilePath;

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
    const status = error.statusCode || 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Failed to upload image' });
  }
});

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

router.post('/:filename/edit', async (req, res) => {
  const filename = req.params.filename;

  try {
    const service = new ImageEditService(req.frameArtPath);
    const operations = req.body && typeof req.body === 'object'
      ? {
          crop: req.body.crop,
          adjustments: req.body.adjustments,
          filter: req.body.filter,
          cropPreset: req.body.cropPreset,
          targetResolution: req.body.targetResolution
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

router.post('/:filename/rename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const oldFilename = req.params.filename;
    const { newBaseName } = req.body;

    if (!newBaseName || !newBaseName.trim()) {
      return res.status(400).json({ error: 'New base name is required' });
    }

    const sanitizedBaseName = sanitizeBaseName(newBaseName, FALLBACK_BASE_NAME);
    const ext = path.extname(oldFilename);
    const uuid = extractUuidSegment(oldFilename);

    if (!uuid) {
      return res.status(400).json({ error: 'Could not extract UUID from filename' });
    }

    const newFilename = `${sanitizedBaseName}-${uuid}${ext}`;
    const newImagePath = path.join(req.frameArtPath, LIBRARY_DIR, newFilename);

    try {
      await fs.access(newImagePath);
      return res.status(400).json({ error: 'A file with this name already exists' });
    } catch (accessError) {
      if (accessError.code !== 'ENOENT') {
        throw accessError;
      }
    }

    const GitHelper = require('../git_helper');
    const git = new GitHelper(req.frameArtPath);

    await git.git.mv(
      path.join(LIBRARY_DIR, oldFilename),
      path.join(LIBRARY_DIR, newFilename)
    );

    const oldThumb = path.join(req.frameArtPath, THUMBS_DIR, `thumb_${oldFilename}`);
    const newThumb = path.join(req.frameArtPath, THUMBS_DIR, `thumb_${newFilename}`);

    try {
      await fs.access(oldThumb);
      await git.git.mv(
        path.join(THUMBS_DIR, `thumb_${oldFilename}`),
        path.join(THUMBS_DIR, `thumb_${newFilename}`)
      );
    } catch (thumbError) {
      if (thumbError.code !== 'ENOENT') {
        console.warn('[RENAME] Thumbnail rename issue:', thumbError.message);
      }
    }

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

router.put('/:filename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const { matte, filter, tags } = req.body || {};

    const updates = {};
    if (matte !== undefined) {
      updates.matte = normalizeMatteValue(matte);
    }
    if (filter !== undefined) {
      updates.filter = normalizeFilterValue(filter);
    }
    if (tags !== undefined) {
      updates.tags = Array.isArray(tags)
        ? tags
        : typeof tags === 'string'
          ? tags.split(',').map(tag => tag.trim()).filter(Boolean)
          : [];
    }

    const imageData = await helper.updateImage(req.params.filename, updates);
    res.json({ success: true, data: imageData });
  } catch (error) {
    console.error('Error updating image:', error);
    res.status(404).json({ error: error.message });
  }
});

router.delete('/:filename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const filename = req.params.filename;
    const service = new ImageEditService(req.frameArtPath);

    await helper.deleteImage(filename);

    const imagePath = path.join(req.frameArtPath, LIBRARY_DIR, filename);
    await removeFileIfExists(imagePath);

    const thumbPath = path.join(req.frameArtPath, THUMBS_DIR, `thumb_${filename}`);
    await removeFileIfExists(thumbPath);

    await service.removeOriginalBackup(filename);

    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

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

router.get('/:filename', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const images = await helper.getAllImages();
    const image = images[req.params.filename];

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json(image);
  } catch (error) {
    console.error('Error getting image details:', error);
    res.status(500).json({ error: 'Failed to retrieve image metadata' });
  }
});

module.exports = router;
