#!/usr/bin/env node

/**
 * Migration script to add dimensions and aspect ratio to existing images
 */

const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

const FRAME_ART_PATH = process.env.FRAME_ART_PATH || '/config/www/frame_art';
const METADATA_FILE = path.join(FRAME_ART_PATH, 'metadata.json');

async function readMetadata() {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading metadata:', error);
    throw error;
  }
}

async function writeMetadata(metadata) {
  try {
    await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error('Error writing metadata:', error);
    throw error;
  }
}

async function getImageDimensions(filename) {
  const imagePath = path.join(FRAME_ART_PATH, 'library', filename);
  try {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      aspectRatio: Math.round((metadata.width / metadata.height) * 100) / 100
    };
  } catch (error) {
    console.error(`Error reading ${filename}:`, error.message);
    return null;
  }
}

async function migrate() {
  console.log('🔍 Reading metadata...');
  const metadata = await readMetadata();
  
  const images = Object.keys(metadata.images || {});
  console.log(`📊 Found ${images.length} images in metadata\n`);
  
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const filename of images) {
    const imageData = metadata.images[filename];
    
    // Skip if already has dimensions
    if (imageData.dimensions && imageData.aspectRatio) {
      console.log(`⏭️  ${filename} - Already has dimensions`);
      skipped++;
      continue;
    }
    
    console.log(`📐 ${filename} - Analyzing...`);
    const dims = await getImageDimensions(filename);
    
    if (dims) {
      metadata.images[filename].dimensions = {
        width: dims.width,
        height: dims.height
      };
      metadata.images[filename].aspectRatio = dims.aspectRatio;
      
      const is16x9 = Math.abs(dims.aspectRatio - 1.78) < 0.05;
      console.log(`   ✅ ${dims.width}x${dims.height} (${dims.aspectRatio})${is16x9 ? ' [16:9]' : ''}`);
      updated++;
    } else {
      console.log(`   ❌ Failed to read dimensions`);
      errors++;
    }
  }
  
  if (updated > 0) {
    console.log(`\n💾 Saving updated metadata...`);
    await writeMetadata(metadata);
    console.log(`✅ Metadata saved successfully!\n`);
  }
  
  console.log('📈 Summary:');
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${images.length}`);
}

// Run migration
migrate()
  .then(() => {
    console.log('\n✨ Migration complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });
