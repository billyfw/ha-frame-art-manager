const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

class MetadataHelper {
  constructor(frameArtPath) {
    this.frameArtPath = frameArtPath;
    this.metadataPath = path.join(frameArtPath, 'metadata.json');
    this.libraryPath = path.join(frameArtPath, 'library');
    this.thumbsPath = path.join(frameArtPath, 'thumbs');
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
      return { version: "1.0", images: {}, tvs: [], tags: [] };
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
  async addImage(filename, matte = 'none', filter = 'none', tags = []) {
    const metadata = await this.readMetadata();
    
    // Get image dimensions using sharp
    const imagePath = path.join(this.libraryPath, filename);
    let dimensions = null;
    let aspectRatio = null;
    
    try {
      const imageMetadata = await sharp(imagePath).metadata();
      dimensions = {
        width: imageMetadata.width,
        height: imageMetadata.height
      };
      
      // Calculate aspect ratio (rounded to 2 decimals)
      aspectRatio = Math.round((imageMetadata.width / imageMetadata.height) * 100) / 100;
    } catch (error) {
      console.error(`Error reading image dimensions for ${filename}:`, error);
    }
    
    metadata.images[filename] = {
      matte,
      filter,
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

    metadata.images[filename] = {
      ...metadata.images[filename],
      ...updates,
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
   * Add a TV to the list
   */
  async addTV(name, ip, home = 'Madrone') {
    const metadata = await this.readMetadata();
    
    const tv = {
      id: Date.now().toString(),
      name,
      ip,
      // Default or provided home
      home: (home === 'Madrone' || home === 'Maui') ? home : 'Madrone',
      added: new Date().toISOString()
    };

    metadata.tvs.push(tv);
    await this.writeMetadata(metadata);
    return tv;
  }

  /**
   * Remove a TV from the list
   */
  async removeTV(tvId) {
    const metadata = await this.readMetadata();
    metadata.tvs = metadata.tvs.filter(tv => tv.id !== tvId);
    await this.writeMetadata(metadata);
    return true;
  }

  /**
   * Get all TVs
   */
  async getAllTVs() {
    const metadata = await this.readMetadata();
    return metadata.tvs || [];
  }

  /**
   * Update tags for a TV
   */
  async updateTVTags(tvId, tags) {
    const metadata = await this.readMetadata();
    const tv = metadata.tvs.find(t => t.id === tvId);
    
    if (!tv) {
      throw new Error('TV not found');
    }

    tv.tags = tags || [];
    await this.writeMetadata(metadata);
    return tv;
  }

  /**
   * Update TV name and IP
   */
  async updateTV(tvId, name, ip, home) {
    const metadata = await this.readMetadata();
    const tv = metadata.tvs.find(t => t.id === tvId);
    
    if (!tv) {
      throw new Error('TV not found');
    }

    tv.name = name;
    tv.ip = ip;
    if (home === 'Madrone' || home === 'Maui') {
      tv.home = home;
    }
    await this.writeMetadata(metadata);
    return tv;
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
}

module.exports = MetadataHelper;
