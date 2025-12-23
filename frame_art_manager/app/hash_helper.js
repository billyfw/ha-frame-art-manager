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
 * Group all images by similarity using Union-Find for proper transitive grouping
 * If A~B and B~C, they all end up in the same group even if A~C distance > threshold
 * @param {Object} images - Object of { filename: { sourceHash, ... } }
 * @param {number} threshold - Maximum Hamming distance to consider similar
 * @param {boolean} includeDistances - Whether to include pairwise distance map
 * @returns {Object} - { groups: Array<Array<string>>, distances: Object } where distances maps "fileA|fileB" to distance
 */
function findDuplicateGroups(images, threshold = DEFAULT_THRESHOLD, includeDistances = false) {
  const filenames = Object.keys(images).filter(f => images[f].sourceHash);
  
  // Union-Find data structure
  const parent = {};
  const rank = {};
  
  // Initialize each filename as its own parent
  for (const f of filenames) {
    parent[f] = f;
    rank[f] = 0;
  }
  
  // Find with path compression
  function find(x) {
    if (parent[x] !== x) {
      parent[x] = find(parent[x]);
    }
    return parent[x];
  }
  
  // Union by rank
  function union(x, y) {
    const rootX = find(x);
    const rootY = find(y);
    if (rootX === rootY) return;
    
    if (rank[rootX] < rank[rootY]) {
      parent[rootX] = rootY;
    } else if (rank[rootX] > rank[rootY]) {
      parent[rootY] = rootX;
    } else {
      parent[rootY] = rootX;
      rank[rootX]++;
    }
  }
  
  // Pairwise distance map (only for pairs within threshold)
  const distances = {};
  
  // Compare all pairs and union those within threshold
  for (let i = 0; i < filenames.length; i++) {
    const file1 = filenames[i];
    const hash1 = images[file1].sourceHash;
    
    for (let j = i + 1; j < filenames.length; j++) {
      const file2 = filenames[j];
      const hash2 = images[file2].sourceHash;
      const distance = hammingDistance(hash1, hash2);
      
      if (distance <= threshold) {
        union(file1, file2);
        if (includeDistances) {
          // Store distance for both directions using a canonical key
          const key = file1 < file2 ? `${file1}|${file2}` : `${file2}|${file1}`;
          distances[key] = distance;
        }
      }
    }
  }
  
  // Collect groups by root
  const groupMap = {};
  for (const f of filenames) {
    const root = find(f);
    if (!groupMap[root]) {
      groupMap[root] = [];
    }
    groupMap[root].push(f);
  }
  
  // Filter to groups with 2+ images
  const groups = Object.values(groupMap).filter(g => g.length > 1);
  
  if (includeDistances) {
    return { groups, distances };
  }
  return groups;
}

/**
 * Get all unique threshold values where new images would be added to similar groups
 * Uses Union-Find to properly track when images join groups
 * @param {Object} images - Object of { filename: { sourceHash, ... } }
 * @param {number} maxThreshold - Maximum threshold to check
 * @returns {Array<{threshold: number, addedImages: number, totalImages: number}>} - Thresholds where images are added
 */
function getThresholdBreakpoints(images, maxThreshold = 60) {
  const filenames = Object.keys(images).filter(f => images[f].sourceHash);
  
  // Collect all pairwise distances with their file pairs
  const pairs = [];
  for (let i = 0; i < filenames.length; i++) {
    const hash1 = images[filenames[i]].sourceHash;
    for (let j = i + 1; j < filenames.length; j++) {
      const hash2 = images[filenames[j]].sourceHash;
      const distance = hammingDistance(hash1, hash2);
      if (distance <= maxThreshold) {
        pairs.push({ distance, file1: filenames[i], file2: filenames[j] });
      }
    }
  }

  // Sort by distance
  pairs.sort((a, b) => a.distance - b.distance);
  
  // Union-Find to track group membership
  const parent = {};
  const rank = {};
  
  for (const f of filenames) {
    parent[f] = f;
    rank[f] = 0;
  }
  
  function find(x) {
    if (parent[x] !== x) {
      parent[x] = find(parent[x]);
    }
    return parent[x];
  }
  
  function union(x, y) {
    const rootX = find(x);
    const rootY = find(y);
    if (rootX === rootY) return false; // Already in same group
    
    if (rank[rootX] < rank[rootY]) {
      parent[rootX] = rootY;
    } else if (rank[rootX] > rank[rootY]) {
      parent[rootY] = rootX;
    } else {
      parent[rootY] = rootX;
      rank[rootX]++;
    }
    return true; // Union performed
  }
  
  // Track which images are in groups (size >= 2)
  function getImagesInGroups() {
    const groupMap = {};
    for (const f of filenames) {
      const root = find(f);
      if (!groupMap[root]) groupMap[root] = [];
      groupMap[root].push(f);
    }
    let count = 0;
    for (const group of Object.values(groupMap)) {
      if (group.length >= 2) count += group.length;
    }
    return count;
  }
  
  const breakpoints = [];
  let lastDistance = -1;
  let lastImageCount = 0;
  
  for (const pair of pairs) {
    const beforeCount = getImagesInGroups();
    union(pair.file1, pair.file2);
    const afterCount = getImagesInGroups();
    
    const addedImages = afterCount - beforeCount;
    
    if (pair.distance !== lastDistance) {
      // New threshold value
      if (addedImages > 0) {
        breakpoints.push({
          threshold: pair.distance,
          addedImages: addedImages,
          totalImages: afterCount
        });
      }
      lastDistance = pair.distance;
      lastImageCount = afterCount;
    } else {
      // Same threshold, accumulate added images
      if (breakpoints.length > 0 && breakpoints[breakpoints.length - 1].threshold === pair.distance) {
        breakpoints[breakpoints.length - 1].addedImages += addedImages;
        breakpoints[breakpoints.length - 1].totalImages = afterCount;
      } else if (addedImages > 0) {
        breakpoints.push({
          threshold: pair.distance,
          addedImages: addedImages,
          totalImages: afterCount
        });
      }
    }
  }

  return breakpoints;
}

module.exports = {
  computePerceptualHash,
  hammingDistance,
  findSimilarImages,
  findDuplicateGroups,
  getThresholdBreakpoints,
  DEFAULT_THRESHOLD
};
