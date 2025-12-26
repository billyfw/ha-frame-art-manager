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

function normalizeTargetResolution(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const width = Math.round(Number(target.width));
  const height = Math.round(Number(target.height));

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

const PRESET_TARGET_RESOLUTIONS = {
  '16:9sam': { width: 3840, height: 2160 }
};

/**
 * Calculate the largest axis-aligned inscribed rectangle after rotation.
 * When an image is rotated by an arbitrary angle, the corners extend beyond
 * the original bounds. This function computes the largest rectangle that
 * fits entirely within the rotated image without showing any background.
 * 
 * @param {number} width - Original image width
 * @param {number} height - Original image height  
 * @param {number} angleDegrees - Rotation angle in degrees
 * @returns {{ width: number, height: number, offsetX: number, offsetY: number }}
 */
function getInscribedRectangle(width, height, angleDegrees) {
  if (!width || !height) return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  if (Math.abs(angleDegrees) < 0.01) return { width, height, offsetX: 0, offsetY: 0 };
  
  const angle = Math.abs(angleDegrees) * Math.PI / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  
  // After rotation, the rotated image has new bounding box dimensions
  const rotatedWidth = width * cosA + height * sinA;
  const rotatedHeight = width * sinA + height * cosA;
  
  // For the largest inscribed axis-aligned rectangle within the rotated image,
  // we use the formula for the largest rectangle that fits inside a rotated rectangle
  const aspectRatio = width / height;
  
  let inscribedWidth, inscribedHeight;
  
  if (aspectRatio >= 1) {
    // Landscape or square
    const scale = cosA - sinA / aspectRatio;
    inscribedWidth = width * scale;
    inscribedHeight = height * scale;
  } else {
    // Portrait
    const scale = cosA - sinA * aspectRatio;
    inscribedWidth = width * scale;
    inscribedHeight = height * scale;
  }
  
  // Ensure positive dimensions
  inscribedWidth = Math.max(1, Math.floor(inscribedWidth));
  inscribedHeight = Math.max(1, Math.floor(inscribedHeight));
  
  // Calculate offset to center the inscribed rectangle in the rotated bounding box
  const offsetX = Math.floor((rotatedWidth - inscribedWidth) / 2);
  const offsetY = Math.floor((rotatedHeight - inscribedHeight) / 2);
  
  return { 
    width: inscribedWidth, 
    height: inscribedHeight,
    offsetX,
    offsetY
  };
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

const EDGE_ENHANCE_KERNEL = {
  width: 3,
  height: 3,
  kernel: [
    -1, -1, -1,
    -1, 8, -1,
    -1, -1, -1
  ]
};

async function generateEdgeOverlay(source, {
  scale = 4,
  bias = 0,
  tint = null,
  invert = false,
  opacity = 0.5,
  blend = 'multiply'
} = {}) {
  const { data, info } = await source
    .clone()
    .toColourspace('srgb')
    .ensureAlpha()
    .greyscale()
  .convolve(EDGE_ENHANCE_KERNEL)
  .linear(scale, bias, { clamp: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let edgeImage = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  });

  edgeImage = edgeImage.toColourspace('srgb').ensureAlpha();

  if (invert) {
    edgeImage = edgeImage.negate({ alpha: false });
  }

  if (tint) {
    edgeImage = edgeImage.tint(tint);
  }

  const overlayBuffer = await edgeImage.ensureAlpha().png().toBuffer();

  return {
    input: overlayBuffer,
    blend,
    opacity
  };
}

async function quantizeToPalette(source, palette) {
  const { data, info } = await source
    .clone()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const output = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let j = 0; j < palette.length; j++) {
      const [pr, pg, pb] = palette[j];
      const distance = (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = j;
      }
    }

    const [nr, ng, nb] = palette[bestIndex];
    output[i] = nr;
    output[i + 1] = ng;
    output[i + 2] = nb;
    if (channels === 4) {
      output[i + 3] = data[i + 3];
    }
  }

  let quantized = sharp(output, {
    raw: {
      width,
      height,
      channels
    }
  }).toColourspace('srgb');

  if (channels === 4) {
    quantized = quantized.ensureAlpha();
  }

  return quantized;
}

function getOrientedDimensions(metadata) {
  if (!metadata) {
    return { width: null, height: null };
  }

  const orientation = metadata.orientation || 1;
  const swapDimensions = orientation >= 5 && orientation <= 8;

  const width = swapDimensions ? metadata.height : metadata.width;
  const height = swapDimensions ? metadata.width : metadata.height;

  return {
    width: width ? Math.max(1, Math.round(width)) : width,
    height: height ? Math.max(1, Math.round(height)) : height
  };
}

function uniqueOverlayId(prefix = 'overlay') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildSvgPattern({ width, height, patternSize, dotRadius, dotColor, background, patternId, gradientId, stops, angle }) {
  if (stops && stops.length) {
    const stopTags = stops
      .map(({ offset, color, opacity = 1 }) => {
        const clampedOffset = Math.max(0, Math.min(1, Number(offset)));
        return `<stop offset="${(clampedOffset * 100).toFixed(2)}%" stop-color="${color}" stop-opacity="${opacity}"/>`;
      })
      .join('');

    return Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs>` +
      `<linearGradient id="${gradientId}" gradientUnits="objectBoundingBox" gradientTransform="rotate(${angle} 0.5 0.5)">` +
      `${stopTags}` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="100%" height="100%" fill="url(#${gradientId})"/>` +
      `</svg>`
    );
  }

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${patternSize}" height="${patternSize}">` +
    `<rect width="${patternSize}" height="${patternSize}" fill="${background}"/>` +
    `<circle cx="${patternSize / 2}" cy="${patternSize / 2}" r="${dotRadius}" fill="${dotColor}"/>` +
    `</pattern>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="url(#${patternId})"/>` +
    `</svg>`
  );
}

function createSvgPatternOverlay(width, height, {
  patternSize = 24,
  dotRadius = patternSize / 3,
  dotColor = '#0a0a0a',
  background = 'rgba(255,255,255,0)',
  opacity = 0.35,
  blend = 'overlay'
} = {}) {
  if (!width || !height) {
    return null;
  }

  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const patternId = uniqueOverlayId('pattern');
  const buffer = buildSvgPattern({
    width: targetWidth,
    height: targetHeight,
    patternSize,
    dotRadius,
    dotColor,
    background,
    patternId
  });

  return {
    input: buffer,
    blend,
    opacity
  };
}

function createGradientOverlay(width, height, {
  stops = [
    { offset: 0, color: '#111625', opacity: 0.85 },
    { offset: 0.58, color: '#f7c978', opacity: 0.55 },
    { offset: 1, color: '#fff2d6', opacity: 0.25 }
  ],
  angle = 35,
  opacity = 0.45,
  blend = 'soft-light'
} = {}) {
  if (!width || !height) {
    return null;
  }

  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const gradientId = uniqueOverlayId('gradient');
  const buffer = buildSvgPattern({
    width: targetWidth,
    height: targetHeight,
    gradientId,
    stops,
    angle
  });

  return {
    input: buffer,
    blend,
    opacity
  };
}

async function createNoiseOverlay(width, height, {
  intensity = 0.25,
  opacity = 0.18,
  blend = 'overlay'
} = {}) {
  if (!width || !height) {
    return null;
  }

  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const channels = 1;
  const total = targetWidth * targetHeight * channels;
  const buffer = Buffer.allocUnsafe(total);
  const clampIntensity = Math.max(0, Math.min(1, intensity));
  const amplitude = Math.round(127 * clampIntensity);

  for (let i = 0; i < total; i += 1) {
    const random = Math.random() * 2 - 1; // -1 → 1
    const value = 128 + Math.round(random * amplitude);
    buffer[i] = Math.max(0, Math.min(255, value));
  }

  const overlayBuffer = await sharp(buffer, {
    raw: {
      width: targetWidth,
      height: targetHeight,
      channels
    }
  })
    .toColourspace('b-w')
    .ensureAlpha()
    .png()
    .toBuffer();

  return {
    input: overlayBuffer,
    blend,
    opacity
  };
}

async function getImageDimensions(instance) {
  try {
    const { info } = await instance
      .clone()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info && info.width && info.height) {
      return {
        width: Math.max(1, Math.round(info.width)),
        height: Math.max(1, Math.round(info.height))
      };
    }
  } catch (rawError) {
    // Fall back to metadata path below
  }

  const meta = await instance.clone().metadata();
  if (meta && meta.width && meta.height) {
    return {
      width: Math.max(1, Math.round(meta.width)),
      height: Math.max(1, Math.round(meta.height))
    };
  }

  throw new Error('Unable to determine image dimensions for overlay generation');
}

const LEGACY_FILTER_MAP = {
  'gallery-soft': 'watercolor',
  'gallery': 'watercolor',
  'vivid-sky': 'pop-art',
  'dusk-haze': 'watercolor',
  'impressionist': 'impressionist',
  'deco-gold': 'art-deco',
  'artdeco': 'art-deco',
  'art deco': 'art-deco',
  'charcoal': 'sketch',
  'pencil': 'sketch',
  'sketch': 'sketch',
  'silver-tone': 'silver-pearl',
  'monochrome': 'silver-pearl',
  'grayscale': 'silver-pearl',
  'ink-sketch': 'sketch',
  'ink': 'graphite-ink',
  'wash': 'watercolor',
  'pastel': 'watercolor',
  'pastel-wash': 'watercolor',
  'aqua': 'watercolor',
  'feuve': 'impressionist',
  'luminous-portrait': 'art-deco',
  'golden-hour': 'art-deco',
  'ember-glow': 'oil-paint',
  'arctic-mist': 'watercolor',
  'verdant-matte': 'impressionist',
  'forest-depth': 'oil-paint',
  'retro-fade': 'impressionist',
  'cobalt-pop': 'pop-art',
  'sunlit-sienna': 'art-deco',
  'coastal-breeze': 'watercolor',
  'film-classic': 'oil-paint',
  'watercolour': 'watercolor',
  'pop art': 'pop-art',
  'popart': 'pop-art',
  'neural': 'neural-style',
  'neural-style': 'neural-style'
};

const EDITING_FILTERS = [
  'none',
  'sketch',
  'oil-paint',
  'watercolor',
  'impressionist',
  'pop-art',
  'art-deco',
  'neural-style',
  'noir-cinema',
  'silver-pearl',
  'graphite-ink'
];

const AVAILABLE_FILTERS = new Set(EDITING_FILTERS);

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
    const cropPreset = typeof operations.cropPreset === 'string' ? operations.cropPreset : null;
    const rotation = Math.max(-45, Math.min(45, Number(operations.rotation) || 0));
    let targetResolution = normalizeTargetResolution(operations.targetResolution);

    if (!targetResolution && cropPreset && PRESET_TARGET_RESOLUTIONS[cropPreset]) {
      const fallback = PRESET_TARGET_RESOLUTIONS[cropPreset];
      targetResolution = { width: fallback.width, height: fallback.height };
    }

    const sanitizedCrop = {
      top: toPercent(crop.top),
      right: toPercent(crop.right),
      bottom: toPercent(crop.bottom),
      left: toPercent(crop.left)
    };

    const sanitizedAdjustments = {
      brightness: Math.max(-100, Math.min(100, Number(adjustments.brightness) || 0)),
      contrast: Math.max(-100, Math.min(100, Number(adjustments.contrast) || 0)),
      hue: Math.max(-180, Math.min(180, Number(adjustments.hue) || 0)),
      saturation: Math.max(-100, Math.min(100, Number(adjustments.saturation) || 0)),
      lightness: Math.max(-100, Math.min(100, Number(adjustments.lightness) || 0))
    };

    let normalizedFilter = LEGACY_FILTER_MAP[filter.toLowerCase()] || filter.toLowerCase();
    if (!AVAILABLE_FILTERS.has(normalizedFilter)) {
      normalizedFilter = 'none';
    }

    return {
      crop: sanitizedCrop,
      adjustments: sanitizedAdjustments,
      filter: normalizedFilter,
      rotation,
      cropPreset: cropPreset || null,
      targetResolution
    };
  }

  calculateCropRegion(dimensions, crop) {
    const { width, height } = dimensions;
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
    const {
      brightness = 0,
      contrast = 0,
      hue = 0,
      saturation = 0,
      lightness = 0
    } = adjustments || {};

    const brightnessFactor = Math.max(0.1, 1 + brightness / 100);
    const lightnessFactor = Math.max(0.1, 1 + lightness / 100);
    const combinedBrightness = Math.max(0.1, brightnessFactor * lightnessFactor);
    const saturationFactor = Math.max(0, 1 + saturation / 100);

    const modulateOptions = {};
    if (Math.abs(combinedBrightness - 1) > 1e-3) {
      modulateOptions.brightness = combinedBrightness;
    }
    if (Math.abs(saturation) > 1e-3) {
      modulateOptions.saturation = saturationFactor;
    }
    if (Math.abs(hue) > 1e-3) {
      modulateOptions.hue = hue;
    }

    if (Object.keys(modulateOptions).length > 0) {
      instance = instance.modulate(modulateOptions);
    }

    if (contrast !== 0) {
      const contrastFactor = Math.max(0.1, 1 + contrast / 100);
      const intercept = 128 * (1 - contrastFactor);
      instance = instance.linear(contrastFactor, intercept);
    }

    return instance;
  }

  async applyFilter(instance, filterName) {
    const candidate = typeof filterName === 'string' ? filterName.toLowerCase() : 'none';
    const normalizedFilter = LEGACY_FILTER_MAP[candidate] || candidate;

    if (!AVAILABLE_FILTERS.has(normalizedFilter)) {
      return instance;
    }

    switch (normalizedFilter) {
      case 'none':
        return instance;
      case 'sketch':
        return this.applySketchFilter(instance);
      case 'oil-paint':
        return this.applyOilPaintFilter(instance);
      case 'watercolor':
        return this.applyWatercolorFilter(instance);
      case 'impressionist':
        return this.applyImpressionistFilter(instance);
      case 'pop-art':
        return this.applyPopArtFilter(instance);
      case 'art-deco':
        return this.applyArtDecoFilter(instance);
      case 'neural-style':
        return this.applyNeuralStyleFilter(instance);
      case 'noir-cinema':
        return instance
          .greyscale()
          .linear(1.4, -38)
          .gamma(1.08)
          .modulate({ brightness: 0.96 });
      case 'silver-pearl':
        return instance
          .greyscale()
          .modulate({ brightness: 1.08 })
          .gamma(1.12)
          .linear(0.94, 12);
      case 'graphite-ink':
        return instance
          .greyscale()
          .median(1)
          .linear(1.18, -16)
          .modulate({ brightness: 1.02 });
      default:
        return instance;
    }
  }

  async applySketchFilter(instance) {
  const { width, height } = await getImageDimensions(instance);

    const edgeOverlay = await generateEdgeOverlay(instance, {
      scale: 6.2,
      bias: -12,
      tint: '#f9f6ee',
      invert: true,
      opacity: 0.9,
      blend: 'colour-dodge'
    });

    const paperOverlay = await createNoiseOverlay(width, height, {
      intensity: 0.35,
      opacity: 0.22,
      blend: 'multiply'
    });

    const overlays = [edgeOverlay, paperOverlay].filter(Boolean);

    let stylized = instance
      .greyscale()
      .median(1)
      .blur(0.45)
      .linear(1.45, -28)
      .modulate({ brightness: 1.12, saturation: 0.08 })
      .gamma(1.08);

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyOilPaintFilter(instance) {
  const { width, height } = await getImageDimensions(instance);

    const edgeOverlay = await generateEdgeOverlay(instance, {
      scale: 3.1,
      bias: 48,
      tint: '#f9d89a',
      opacity: 0.35,
      blend: 'soft-light'
    });

    const gradientOverlay = createGradientOverlay(width, height, {
      stops: [
        { offset: 0, color: '#47240f', opacity: 0.85 },
        { offset: 0.55, color: '#ffb347', opacity: 0.55 },
        { offset: 1, color: '#ffe9c5', opacity: 0.32 }
      ],
      angle: 18,
      opacity: 0.58,
      blend: 'soft-light'
    });

    const textureOverlay = await createNoiseOverlay(width, height, {
      intensity: 0.28,
      opacity: 0.2,
      blend: 'overlay'
    });

    const overlays = [edgeOverlay, gradientOverlay, textureOverlay].filter(Boolean);

    let stylized = instance
      .median(5)
      .blur(1.6)
      .sharpen({ sigma: 1.45, m1: 1.28, m2: 0, x1: 1.6 })
      .modulate({ saturation: 1.48, brightness: 1.08 })
      .linear(1.22, -18)
      .gamma(1.13);

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyWatercolorFilter(instance) {
    // Palette inspired by the open-source "Peach Beach" watercolour set on Lospec (CC0)
    const palette = [
      [229, 244, 255],
      [196, 226, 255],
      [167, 214, 250],
      [255, 222, 211],
      [240, 247, 233],
      [212, 233, 255]
    ];

    const quantized = await quantizeToPalette(instance, palette);
    const { width, height } = await getImageDimensions(quantized);

    const flowOverlay = createGradientOverlay(width, height, {
      stops: [
        { offset: 0, color: '#93d1ff', opacity: 0.55 },
        { offset: 0.65, color: '#ffe6f0', opacity: 0.4 },
        { offset: 1, color: '#fdfdfd', opacity: 0.25 }
      ],
      angle: -24,
      opacity: 0.5,
      blend: 'screen'
    });

    const edgeOverlay = await generateEdgeOverlay(quantized, {
      scale: 4.6,
      bias: 118,
      tint: '#6fb4ff',
      opacity: 0.48,
      blend: 'lighten'
    });

    const paperOverlay = await createNoiseOverlay(width, height, {
      intensity: 0.24,
      opacity: 0.2,
      blend: 'multiply'
    });

    const overlays = [flowOverlay, edgeOverlay, paperOverlay].filter(Boolean);

    let stylized = quantized
      .blur(2.1)
      .median(1)
      .modulate({ saturation: 1.34, brightness: 1.12 })
      .gamma(1.08);

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyImpressionistFilter(instance) {
    // Palette adapted from the open-source "Mizu 16" collection on Lospec (CC0)
    const palette = [
      [255, 214, 170],
      [255, 186, 122],
      [236, 160, 114],
      [115, 159, 214],
      [78, 115, 168],
      [230, 237, 201]
    ];

    const stylizedBase = await quantizeToPalette(instance, palette);
    const { width, height } = await getImageDimensions(stylizedBase);

    const gradientOverlay = createGradientOverlay(width, height, {
      stops: [
        { offset: 0, color: '#3e4a7a', opacity: 0.55 },
        { offset: 0.58, color: '#f3c06d', opacity: 0.5 },
        { offset: 1, color: '#ffead4', opacity: 0.3 }
      ],
      angle: 28,
      opacity: 0.58,
      blend: 'soft-light'
    });

    const edgeOverlay = await generateEdgeOverlay(stylizedBase, {
      scale: 3.8,
      bias: 94,
      tint: '#ffda7b',
      opacity: 0.36,
      blend: 'overlay'
    });

    const brushOverlay = await createNoiseOverlay(width, height, {
      intensity: 0.32,
      opacity: 0.22,
      blend: 'overlay'
    });

    const overlays = [gradientOverlay, edgeOverlay, brushOverlay].filter(Boolean);

    let stylized = stylizedBase
      .median(2)
      .blur(0.9)
      .sharpen({ sigma: 1.05, m1: 1.1, m2: 0 })
      .modulate({ saturation: 1.42, brightness: 1.08 })
      .gamma(1.09);

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyPopArtFilter(instance) {
    // Palette adapted from the open-source "Pop Star 4" palette (CC0)
    const palette = [
      [18, 34, 197],
      [255, 45, 119],
      [255, 231, 0],
      [0, 218, 178]
    ];

    const quantized = await quantizeToPalette(instance, palette);
    const { width, height } = await getImageDimensions(quantized);

    const halftoneOverlay = createSvgPatternOverlay(width, height, {
      patternSize: 22,
      dotRadius: 5.5,
      dotColor: '#0b0b0b',
      background: 'rgba(255,255,255,0)',
      opacity: 0.45,
      blend: 'multiply'
    });

    const highlightOverlay = await generateEdgeOverlay(quantized, {
      scale: 6.2,
      bias: 150,
      tint: '#ffffff',
      opacity: 0.55,
      blend: 'screen'
    });

    const overlays = [halftoneOverlay, highlightOverlay].filter(Boolean);

    let stylized = quantized
      .modulate({ saturation: 2.4, brightness: 1.08 })
      .linear(1.32, -22)
      .gamma(1.05)
      .sharpen({ sigma: 0.85, m1: 1.24, m2: 0 });

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyArtDecoFilter(instance) {
    const { width, height } = await getImageDimensions(instance);

    const gradientOverlay = createGradientOverlay(width, height, {
      stops: [
        { offset: 0, color: '#101626', opacity: 0.88 },
        { offset: 0.45, color: '#1e3a5f', opacity: 0.6 },
        { offset: 1, color: '#f5c872', opacity: 0.48 }
      ],
      angle: 24,
      opacity: 0.65,
      blend: 'soft-light'
    });

    const edgeOverlay = await generateEdgeOverlay(instance, {
      scale: 3.4,
      bias: 112,
      tint: '#f7d693',
      opacity: 0.48,
      blend: 'screen'
    });

    const textureOverlay = await createNoiseOverlay(width, height, {
      intensity: 0.26,
      opacity: 0.18,
      blend: 'overlay'
    });

    const overlays = [gradientOverlay, edgeOverlay, textureOverlay].filter(Boolean);

    let stylized = instance
      .modulate({ saturation: 1.22, brightness: 1.06 })
      .linear(1.16, -10)
      .gamma(1.07);

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyNeuralStyleFilter(instance) {
    // Palette adapted from the open-source "Cyberpunk City" palette (CC0)
    const palette = [
      [65, 95, 255],
      [236, 58, 141],
      [252, 201, 88],
      [32, 240, 182],
      [20, 20, 28]
    ];

    const stylizedBase = await quantizeToPalette(instance, palette);
    const { width, height } = await getImageDimensions(stylizedBase);

    const neonOverlay = createGradientOverlay(width, height, {
      stops: [
        { offset: 0, color: '#301860', opacity: 0.7 },
        { offset: 0.5, color: '#ff4fd8', opacity: 0.5 },
        { offset: 1, color: '#58fff7', opacity: 0.35 }
      ],
      angle: 52,
      opacity: 0.6,
      blend: 'soft-light'
    });

    const edgeOverlay = await generateEdgeOverlay(stylizedBase, {
      scale: 5.2,
      bias: 138,
      tint: '#c7b5ff',
      opacity: 0.5,
      blend: 'screen'
    });

    const textureOverlay = await createNoiseOverlay(width, height, {
      intensity: 0.3,
      opacity: 0.16,
      blend: 'overlay'
    });

    const overlays = [neonOverlay, edgeOverlay, textureOverlay].filter(Boolean);

    let stylized = stylizedBase
      .blur(0.8)
      .median(1)
      .modulate({ saturation: 1.68, brightness: 1.08 })
      .linear(1.12, -10)
      .gamma(1.14);

    if (overlays.length) {
      stylized = stylized.composite(overlays);
    }

    return stylized;
  }

  async applyEdits(filename, operations = {}) {
    const sanitized = this.sanitizeOperations(operations);
    const sourcePath = path.join(this.libraryPath, filename);

    const metadata = await sharp(sourcePath).metadata();
    const orientedDimensions = getOrientedDimensions(metadata);

    const { backupPath, created: backupCreated } = await this.ensureOriginalBackup(filename);

    // Apply arbitrary rotation if specified
    const rotationAngle = sanitized.rotation || 0;
    let workingDimensions = { ...orientedDimensions };
    
    // Start with EXIF-based auto-rotation to normalize orientation
    // Then apply arbitrary rotation if needed (in a single rotate call to avoid issues)
    let transformer;
    
    if (Math.abs(rotationAngle) >= 0.01) {
      // Calculate the inscribed rectangle dimensions
      const inscribed = getInscribedRectangle(
        orientedDimensions.width, 
        orientedDimensions.height, 
        rotationAngle
      );
      
      // First normalize EXIF orientation, then get buffer, then apply arbitrary rotation
      const normalizedBuffer = await sharp(sourcePath).rotate().toBuffer();
      
      // Now apply arbitrary rotation with transparent background, then extract inscribed rectangle
      transformer = sharp(normalizedBuffer)
        .rotate(rotationAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extract({
          left: inscribed.offsetX,
          top: inscribed.offsetY,
          width: inscribed.width,
          height: inscribed.height
        });
      
      // Update working dimensions to the inscribed rectangle
      workingDimensions = { width: inscribed.width, height: inscribed.height };
    } else {
      // No arbitrary rotation - just normalize EXIF orientation
      transformer = sharp(sourcePath).rotate();
    }

    // Apply user crop on top of the rotation-adjusted dimensions
    const cropNeeded = Object.values(sanitized.crop).some(value => value > 0.0001);
    if (cropNeeded) {
      const region = this.calculateCropRegion(workingDimensions, sanitized.crop);
      transformer = transformer.extract(region);
    }

    transformer = this.applyAdjustments(transformer, sanitized.adjustments);
    transformer = await this.applyFilter(transformer, sanitized.filter);

    if (sanitized.targetResolution) {
      const targetWidth = sanitized.targetResolution.width;
      const targetHeight = sanitized.targetResolution.height;

      if (Number.isFinite(targetWidth) && Number.isFinite(targetHeight)) {
        transformer = transformer.resize(targetWidth, targetHeight, {
          fit: sharp.fit.fill,
          kernel: sharp.kernel.lanczos3
        });
      }
    }

    if (metadata.format) {
      transformer = transformer.toFormat(metadata.format);
    }

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
