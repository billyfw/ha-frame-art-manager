const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const MetadataHelper = require('./metadata_helper');

function toPercent(value, fallback = 0) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return Math.max(0, Math.min(100, num));
  }
  return fallback;
}

function formatAspectRatio(width, height) {
  if (!width || !height) {
    return null;
  }
  return Math.round((width / height) * 100) / 100;
}

function getBackupFilename(filename) {
  const ext = path.extname(filename);
  const nameWithoutExt = filename.slice(0, filename.length - ext.length);
  return `${nameWithoutExt}_original${ext}`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

class ImageEditService {
  constructor(frameArtPath) {
    this.frameArtPath = frameArtPath;
    this.libraryPath = path.join(frameArtPath, 'library');
    this.originalsPath = path.join(frameArtPath, 'originals');
    this.helper = new MetadataHelper(frameArtPath);
  }

  async ensureDirectories() {
    await fs.mkdir(this.originalsPath, { recursive: true });
  }

  async ensureOriginalBackup(filename) {
    await this.ensureDirectories();

    const sourcePath = path.join(this.libraryPath, filename);
    const backupFilename = getBackupFilename(filename);
    const backupPath = path.join(this.originalsPath, backupFilename);

    if (await fileExists(backupPath)) {
      return { backupPath, created: false };
    }

    const tmpName = `${backupFilename}.tmp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = path.join(this.originalsPath, tmpName);

    await fs.copyFile(sourcePath, tmpPath);
    await fs.rename(tmpPath, backupPath);

    return { backupPath, created: true };
  }

  async removeOriginalBackup(filename) {
    await this.ensureDirectories();

    const backupFilename = getBackupFilename(filename);
    const backupPath = path.join(this.originalsPath, backupFilename);

    try {
      await fs.unlink(backupPath);
      return { removed: true, hasBackup: false };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { removed: false, hasBackup: false };
      }

      console.warn(`Failed to remove original backup for ${filename}:`, error.message);
      const stillExists = await fileExists(backupPath);
      return { removed: false, hasBackup: stillExists };
    }
  }

  sanitizeOperations(operations = {}) {
    const crop = operations.crop || {};
    const adjustments = operations.adjustments || {};
    const filter = typeof operations.filter === 'string' ? operations.filter : 'none';

    const sanitizedCrop = {
      top: toPercent(crop.top),
      right: toPercent(crop.right),
      bottom: toPercent(crop.bottom),
      left: toPercent(crop.left)
    };

    const sanitizedAdjustments = {
      brightness: Math.max(-100, Math.min(100, Number(adjustments.brightness) || 0)),
      contrast: Math.max(-100, Math.min(100, Number(adjustments.contrast) || 0))
    };

    return {
      crop: sanitizedCrop,
      adjustments: sanitizedAdjustments,
      filter: filter.toLowerCase()
    };
  }

  calculateCropRegion(metadata, crop) {
    const { width, height } = metadata;
    if (!width || !height) {
      throw new Error('Cannot determine image dimensions for cropping');
    }

    const left = Math.round((crop.left / 100) * width);
    const right = Math.round((crop.right / 100) * width);
    const top = Math.round((crop.top / 100) * height);
    const bottom = Math.round((crop.bottom / 100) * height);

    const croppedWidth = width - left - right;
    const croppedHeight = height - top - bottom;

    if (croppedWidth < 1 || croppedHeight < 1) {
      throw new Error('Crop settings result in an empty image');
    }

    return {
      left,
      top,
      width: croppedWidth,
      height: croppedHeight
    };
  }

  applyAdjustments(instance, adjustments) {
    const { brightness, contrast } = adjustments;

    const brightnessFactor = Math.max(0, 1 + brightness / 100);
    if (brightness !== 0) {
      instance = instance.modulate({ brightness: brightnessFactor });
    }

    if (contrast !== 0) {
      const contrastFactor = Math.max(0.1, 1 + contrast / 100);
      const intercept = 128 * (1 - contrastFactor);
      instance = instance.linear(contrastFactor, intercept);
    }

    return instance;
  }

  applyFilter(instance, filterName) {
    switch (filterName) {
      case 'gallery-soft':
        return instance
          .modulate({ saturation: 1.08, brightness: 1.03 })
          .linear(1.02, -4)
          .tint('#f5e4d3');
      case 'vivid-sky':
        return instance
          .modulate({ saturation: 1.2, brightness: 1.03 })
          .linear(1.04, -2)
          .tint('#e2f1ff');
      case 'dusk-haze':
        return instance
          .modulate({ saturation: 1.08, brightness: 0.98 })
          .tint('#d9c6ff')
          .linear(1.03, -6);
      case 'impressionist':
        return instance
          .modulate({ saturation: 1.22, brightness: 1.05 })
          .linear(0.93, 14);
      case 'deco-gold':
        return instance
          .recomb([
            [1.06, 0.02, 0],
            [0.02, 1.04, 0.01],
            [0.02, 0.06, 0.94]
          ])
          .modulate({ saturation: 1.12, brightness: 1.02 })
          .tint('#fbe4c6');
      case 'charcoal':
        return instance
          .greyscale()
          .linear(1.32, -34)
          .modulate({ brightness: 0.92 });
      case 'silver-tone':
      case 'monochrome':
      case 'grayscale':
        return instance
          .greyscale()
          .modulate({ brightness: 1.06 })
          .gamma(1.12)
          .linear(1, -2);
      case 'ink-sketch':
        return instance
          .greyscale()
          .median(1)
          .threshold(150)
          .linear(1.05, -10);
      default:
        return instance;
    }
  }

  async applyEdits(filename, operations = {}) {
    const sanitized = this.sanitizeOperations(operations);
    const sourcePath = path.join(this.libraryPath, filename);

    const metadata = await sharp(sourcePath).metadata();

    const { backupPath, created: backupCreated } = await this.ensureOriginalBackup(filename);

    let transformer = sharp(sourcePath);

    const cropNeeded = Object.values(sanitized.crop).some(value => value > 0.0001);
    if (cropNeeded) {
      const region = this.calculateCropRegion(metadata, sanitized.crop);
      transformer = transformer.extract(region);
    }

    transformer = this.applyAdjustments(transformer, sanitized.adjustments);
    transformer = this.applyFilter(transformer, sanitized.filter);

    const tmpName = `${filename}.edit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = path.join(this.libraryPath, tmpName);

    try {
      await transformer.toFile(tmpPath);
      await fs.rename(tmpPath, sourcePath);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => {});
      throw error;
    }

    const updatedMetadata = await sharp(sourcePath).metadata();
    const dimensions = {
      width: updatedMetadata.width,
      height: updatedMetadata.height
    };
    const aspectRatio = formatAspectRatio(dimensions.width, dimensions.height);

    try {
      await this.helper.updateImage(filename, { dimensions, aspectRatio });
    } catch (error) {
      // If metadata update fails, restore from backup immediately
      await this.restoreFromBackup(filename, backupPath);
      throw error;
    }

    try {
      await this.helper.generateThumbnail(filename);
    } catch (thumbError) {
      // Thumbnail errors aren't fatal; log and continue
      console.warn('Thumbnail regeneration failed after edit:', thumbError.message);
    }

    return {
      backupCreated,
      dimensions,
      aspectRatio,
      operations: sanitized
    };
  }

  async restoreFromBackup(filename, backupPath) {
    const sourcePath = path.join(this.libraryPath, filename);
    const tmpName = `${filename}.revert-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = path.join(this.libraryPath, tmpName);

    await fs.copyFile(backupPath, tmpPath);
    await fs.rename(tmpPath, sourcePath);
  }

  async revertToOriginal(filename) {
    const backupFilename = getBackupFilename(filename);
    const backupPath = path.join(this.originalsPath, backupFilename);

    if (!(await fileExists(backupPath))) {
      throw new Error('Original backup not found');
    }

    await this.restoreFromBackup(filename, backupPath);

    const metadata = await sharp(path.join(this.libraryPath, filename)).metadata();
    const dimensions = {
      width: metadata.width,
      height: metadata.height
    };
    const aspectRatio = formatAspectRatio(dimensions.width, dimensions.height);

    try {
      await this.helper.updateImage(filename, { dimensions, aspectRatio });
    } catch (error) {
      console.warn('Metadata update failed during revert:', error.message);
    }

    try {
      await this.helper.generateThumbnail(filename);
    } catch (thumbError) {
      console.warn('Thumbnail regeneration failed after revert:', thumbError.message);
    }

    const { hasBackup } = await this.removeOriginalBackup(filename);

    return {
      dimensions,
      aspectRatio,
      hasBackup
    };
  }

  async getEditState(filename) {
    const backupFilename = getBackupFilename(filename);
    const backupPath = path.join(this.originalsPath, backupFilename);
    const hasBackup = await fileExists(backupPath);

    return {
      hasBackup
    };
  }
}

module.exports = ImageEditService;
