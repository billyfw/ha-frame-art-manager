const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const {
  DEFAULT_MATTE,
  DEFAULT_FILTER,
  normalizeMatteValue,
  normalizeFilterValue
} = require('./constants');

class MetadataHelper {
  constructor(frameArtPath) {
    this.frameArtPath = frameArtPath;
    this.metadataPath = path.join(frameArtPath, 'metadata.json');
    this.libraryPath = path.join(frameArtPath, 'library');
    this.thumbsPath = path.join(frameArtPath, 'thumbs');
  }

  /**
   * Normalize MAC address to standard format (lowercase with colons)
   * Accepts: AA:BB:CC:DD:EE:FF, aa-bb-cc-dd-ee-ff, aabbccddeeff, etc.
   * Returns: aa:bb:cc:dd:ee:ff or null if invalid
   */
  normalizeMacAddress(mac) {
    if (!mac || typeof mac !== 'string') {
      return null;
    }

    // Remove all non-hex characters
    const cleaned = mac.replace(/[^0-9a-fA-F]/g, '');
    
    // MAC address should be exactly 12 hex characters
    if (cleaned.length !== 12) {
      return null;
    }

    // Format as lowercase with colons: aa:bb:cc:dd:ee:ff
    const formatted = cleaned.toLowerCase().match(/.{1,2}/g).join(':');
    return formatted;
  }

  /**
   * Read metadata.json
   */
  async readMetadata() {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading metadata:', error);
      return { version: "1.0", images: {}, tags: [] };
    }
  }

  /**
   * Write metadata.json
   */
  async writeMetadata(data) {
    try {
      await fs.writeFile(this.metadataPath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error writing metadata:', error);
      throw error;
    }
  }

  /**
   * Add new image entry to metadata
   */
  async addImage(filename, matte = DEFAULT_MATTE, filter = DEFAULT_FILTER, tags = []) {
    const metadata = await this.readMetadata();

    const normalizedMatte = normalizeMatteValue(matte);
    const normalizedFilter = normalizeFilterValue(filter);
    
    // Get image dimensions using sharp
    const imagePath = path.join(this.libraryPath, filename);
    let dimensions = null;
    let aspectRatio = null;

    try {
      const stats = await fs.stat(imagePath);
      if (!stats.size) {
        throw new Error('File is empty');
      }

      const imageMetadata = await sharp(imagePath).metadata();
      if (!imageMetadata.width || !imageMetadata.height) {
        throw new Error('Missing image dimensions');
      }

      dimensions = {
        width: imageMetadata.width,
        height: imageMetadata.height
      };

      // Calculate aspect ratio (rounded to 2 decimals)
      aspectRatio = Math.round((imageMetadata.width / imageMetadata.height) * 100) / 100;
    } catch (error) {
      console.error(`Error reading image data for ${filename}:`, error);
      throw new Error(`Invalid image file: ${filename}`);
    }
    
    metadata.images[filename] = {
      matte: normalizedMatte,
      filter: normalizedFilter,
      tags,
      dimensions,
      aspectRatio,
      added: new Date().toISOString()
    };

    // Auto-add any new tags to the global tag library
    if (tags && Array.isArray(tags)) {
      if (!metadata.tags) {
        metadata.tags = [];
      }
      tags.forEach(tag => {
        if (tag && !metadata.tags.includes(tag)) {
          metadata.tags.push(tag);
        }
      });
    }

    await this.writeMetadata(metadata);
    return metadata.images[filename];
  }

  /**
   * Update existing image metadata
   */
  async updateImage(filename, updates) {
    const metadata = await this.readMetadata();
    
    if (!metadata.images[filename]) {
      throw new Error(`Image ${filename} not found in metadata`);
    }

    const sanitizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'matte')) {
      sanitizedUpdates.matte = normalizeMatteValue(sanitizedUpdates.matte);
    }
    if (Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'filter')) {
      sanitizedUpdates.filter = normalizeFilterValue(sanitizedUpdates.filter);
    }

    metadata.images[filename] = {
      ...metadata.images[filename],
      ...sanitizedUpdates,
      updated: new Date().toISOString()
    };

    // Auto-add any new tags to the global tag library
    if (updates.tags && Array.isArray(updates.tags)) {
      if (!metadata.tags) {
        metadata.tags = [];
      }
      updates.tags.forEach(tag => {
        if (tag && !metadata.tags.includes(tag)) {
          metadata.tags.push(tag);
        }
      });
    }

    // Clean up unused tags from global list
    await this.cleanupUnusedTags(metadata);

    await this.writeMetadata(metadata);
    return metadata.images[filename];
  }

  /**
   * Delete image entry from metadata
   */
  async deleteImage(filename) {
    const metadata = await this.readMetadata();
    
    if (!metadata.images[filename]) {
      throw new Error(`Image ${filename} not found in metadata`);
    }

    delete metadata.images[filename];

    // Clean up unused tags from global list
    await this.cleanupUnusedTags(metadata);

    await this.writeMetadata(metadata);
    return true;
  }

  /**
   * Rename image in metadata
   */
  async renameImage(oldFilename, newFilename) {
    const metadata = await this.readMetadata();
    
    if (!metadata.images[oldFilename]) {
      throw new Error(`Image ${oldFilename} not found in metadata`);
    }
    
    if (metadata.images[newFilename]) {
      throw new Error(`Image ${newFilename} already exists in metadata`);
    }
    
    // Copy the metadata to the new filename
    metadata.images[newFilename] = metadata.images[oldFilename];
    
    // Delete the old entry
    delete metadata.images[oldFilename];
    
    await this.writeMetadata(metadata);
    return metadata.images[newFilename];
  }

  /**
   * Get images by tag
   */
  async getImagesByTag(tag) {
    const metadata = await this.readMetadata();
    const results = {};

    for (const [filename, data] of Object.entries(metadata.images)) {
      if (data.tags && data.tags.includes(tag)) {
        results[filename] = data;
      }
    }

    return results;
  }

  /**
   * Get all images
   */
  async getAllImages() {
    const metadata = await this.readMetadata();
    return metadata.images;
  }

  /**
   * Generate thumbnail for an image
   */
  async generateThumbnail(filename, thumbSize = { width: 400, height: 300 }) {
    const imagePath = path.join(this.libraryPath, filename);
    const thumbFilename = `thumb_${filename}`;
    const thumbPath = path.join(this.thumbsPath, thumbFilename);

    try {
      await sharp(imagePath)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(thumbSize.width, thumbSize.height, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .toFile(thumbPath);

      return thumbFilename;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      throw error;
    }
  }

  /**
   * Verify sync between files and metadata
   */
  async verifySync() {
    const metadata = await this.readMetadata();
    const results = {
      inMetadataNotOnDisk: [],
      onDiskNotInMetadata: [],
      synced: []
    };

    try {
      // Get all files in library directory
      const files = await fs.readdir(this.libraryPath);
      const imageFiles = files.filter(f => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
      );

      // Check metadata entries against disk
      for (const filename of Object.keys(metadata.images)) {
        if (imageFiles.includes(filename)) {
          results.synced.push(filename);
        } else {
          results.inMetadataNotOnDisk.push(filename);
        }
      }

      // Check disk files against metadata
      for (const filename of imageFiles) {
        if (!metadata.images[filename]) {
          results.onDiskNotInMetadata.push(filename);
        }
      }

      return results;
    } catch (error) {
      console.error('Error verifying sync:', error);
      throw error;
    }
  }

  /**
   * Add a tag to the library
   */
  async addTag(tagName) {
    const metadata = await this.readMetadata();
    
    if (!metadata.tags) {
      metadata.tags = [];
    }

    if (!metadata.tags.includes(tagName)) {
      metadata.tags.push(tagName);
      await this.writeMetadata(metadata);
    }

    return metadata.tags;
  }

  /**
   * Remove a tag from the library (and all images)
   */
  async removeTag(tagName) {
    const metadata = await this.readMetadata();
    
    // Remove from tag list
    metadata.tags = (metadata.tags || []).filter(t => t !== tagName);
    
    // Remove from all images
    for (const filename of Object.keys(metadata.images)) {
      if (metadata.images[filename].tags) {
        metadata.images[filename].tags = metadata.images[filename].tags.filter(t => t !== tagName);
      }
    }

    await this.writeMetadata(metadata);
    return metadata.tags;
  }

  /**
   * Get all tags
   */
  async getAllTags() {
    const metadata = await this.readMetadata();
    return metadata.tags || [];
  }

  /**
   * Clean up unused tags from global tag list
   * Removes tags that are not used by any image entry
   * Note: This method modifies the metadata object passed to it
   */
  async cleanupUnusedTags(metadata) {
    if (!metadata.tags || metadata.tags.length === 0) {
      return;
    }

    // Collect all tags currently in use by images
    const tagsInUse = new Set();
    for (const imageData of Object.values(metadata.images)) {
      if (imageData.tags && Array.isArray(imageData.tags)) {
        imageData.tags.forEach(tag => tagsInUse.add(tag));
      }
    }

    // Filter global tags to only include those in use
    const originalLength = metadata.tags.length;
    metadata.tags = metadata.tags.filter(tag => tagsInUse.has(tag));

    // Log if any tags were removed
    const removedCount = originalLength - metadata.tags.length;
    if (removedCount > 0) {
      console.log(`[CLEANUP] Removed ${removedCount} unused tag(s) from global list`);
    }
  }
}

module.exports = MetadataHelper;
