/**
 * Perceptual hash utilities for duplicate image detection
 * Uses blockhash algorithm - resilient to resizing, compression, minor edits
 */

const sharp = require('sharp');
const { bmvbhash } = require('blockhash-core');

const DEFAULT_HASH_BITS = 16; // 16x16 = 256 bit hash (64 hex chars)
const DEFAULT_THRESHOLD = 10; // Hamming distance threshold for "similar"

/**
 * Compute perceptual hash from image buffer using Sharp for decoding
 * @param {Buffer} buffer - Image file buffer
 * @returns {Promise<string>} - Hex string hash
 */
async function computePerceptualHash(buffer) {
  // Decode image to raw RGBA pixels using Sharp
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // bmvbhash expects ImageData-like object: { width, height, data }
  const imageData = {
    width: info.width,
    height: info.height,
    data: data
  };

  // Compute blockhash (returns hex string)
  const hash = bmvbhash(imageData, DEFAULT_HASH_BITS);
  return hash;
}

/**
 * Compute Hamming distance between two hex hash strings
 * @param {string} hash1 - First hex hash
 * @param {string} hash2 - Second hex hash
 * @returns {number} - Number of differing bits
 */
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return Infinity;
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    // Count differing bits in this nibble
    let xor = n1 ^ n2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Find images similar to a given hash
 * @param {string} newHash - Hash to compare
 * @param {Object} images - Object of { filename: { sourceHash, ... } }
 * @param {number} threshold - Maximum Hamming distance to consider similar
 * @returns {Array<{filename: string, distance: number}>} - Similar images sorted by distance
 */
function findSimilarImages(newHash, images, threshold = DEFAULT_THRESHOLD) {
  const similar = [];

  for (const [filename, data] of Object.entries(images)) {
    if (!data.sourceHash) continue;

    const distance = hammingDistance(newHash, data.sourceHash);
    if (distance <= threshold) {
      similar.push({ filename, distance });
    }
  }

  // Sort by distance (closest matches first)
  similar.sort((a, b) => a.distance - b.distance);
  return similar;
}

/**
 * Group all images by similarity (for finding all duplicate groups)
 * @param {Object} images - Object of { filename: { sourceHash, ... } }
 * @param {number} threshold - Maximum Hamming distance to consider similar
 * @returns {Array<Array<string>>} - Array of duplicate groups (each group has 2+ filenames)
 */
function findDuplicateGroups(images, threshold = DEFAULT_THRESHOLD) {
  const filenames = Object.keys(images).filter(f => images[f].sourceHash);
  const visited = new Set();
  const groups = [];

  for (const filename of filenames) {
    if (visited.has(filename)) continue;

    const hash = images[filename].sourceHash;
    const group = [filename];
    visited.add(filename);

    // Find all other images similar to this one
    for (const other of filenames) {
      if (visited.has(other)) continue;

      const otherHash = images[other].sourceHash;
      const distance = hammingDistance(hash, otherHash);

      if (distance <= threshold) {
        group.push(other);
        visited.add(other);
      }
    }

    // Only include groups with 2+ images
    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups;
}

module.exports = {
  computePerceptualHash,
  hammingDistance,
  findSimilarImages,
  findDuplicateGroups,
  DEFAULT_THRESHOLD
};
