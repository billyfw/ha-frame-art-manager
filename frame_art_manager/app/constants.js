/**
 * Frame TV Art Display Options
 * These match the Samsung Frame TV's art mode settings
 * Queried from TV API via get_matte_list on 2024-12-26
 * 
 * IMPORTANT: Portrait images only support shadowbox and flexible mattes.
 * Landscape images support all matte types.
 * See frame-art-shuffler/docs/MATTE_BEHAVIOR.md for details.
 */

// Available matte types from Samsung Frame TV
const MATTE_TYPE_LIST = [
  'none',
  'modernthin',
  'modern',
  'modernwide',
  'flexible',
  'shadowbox',
  'panoramic',
  'triptych',
  'mix',
  'squares'
];

// Matte types that work for ALL images (landscape + portrait)
const UNIVERSAL_MATTE_TYPES = ['flexible', 'shadowbox'];

// Matte types that ONLY work for landscape images
const LANDSCAPE_ONLY_MATTE_TYPES = ['modernthin', 'modern', 'modernwide', 'panoramic', 'triptych', 'mix', 'squares'];

// Available matte colors from Samsung Frame TV
// Note: 'burgandy' is Samsung's spelling (not 'burgundy')
const MATTE_COLOR_LIST = [
  'black',
  'neutral',
  'antique',
  'warm',
  'polar',
  'sand',
  'seafoam',
  'sage',
  'burgandy',
  'navy',
  'apricot',
  'byzantine',
  'lavender',
  'redorange',
  'skyblue',
  'turquoise'
];

// Build full matte_id list: 'none' + all type_color combinations
const MATTE_TYPES = [
  'none',
  // Modern Thin family
  ...MATTE_COLOR_LIST.map(c => `modernthin_${c}`),
  // Modern family
  ...MATTE_COLOR_LIST.map(c => `modern_${c}`),
  // Modern Wide family
  ...MATTE_COLOR_LIST.map(c => `modernwide_${c}`),
  // Flexible family
  ...MATTE_COLOR_LIST.map(c => `flexible_${c}`),
  // Shadowbox family
  ...MATTE_COLOR_LIST.map(c => `shadowbox_${c}`),
  // Panoramic family
  ...MATTE_COLOR_LIST.map(c => `panoramic_${c}`),
  // Triptych family
  ...MATTE_COLOR_LIST.map(c => `triptych_${c}`),
  // Mix family
  ...MATTE_COLOR_LIST.map(c => `mix_${c}`),
  // Squares family
  ...MATTE_COLOR_LIST.map(c => `squares_${c}`)
];

// Mattes that work for portrait images (only shadowbox and flexible)
const PORTRAIT_MATTE_TYPES = [
  'none',
  ...MATTE_COLOR_LIST.map(c => `flexible_${c}`),
  ...MATTE_COLOR_LIST.map(c => `shadowbox_${c}`)
];

// Helper to check if a matte is valid for portrait images
function isMatteValidForPortrait(matte) {
  if (!matte || matte === 'none') return true;
  const matteType = matte.split('_')[0];
  return UNIVERSAL_MATTE_TYPES.includes(matteType);
}

// Get appropriate matte list based on image orientation
function getMattesForOrientation(isPortrait) {
  return isPortrait ? PORTRAIT_MATTE_TYPES : MATTE_TYPES;
}

const FILTER_TYPES = [
  'None',
  'Aqua',
  'ArtDeco',
  'Ink',
  'Wash',
  'Pastel',
  'Feuve'
];

const DEFAULT_MATTE = 'none';
const DEFAULT_FILTER = 'None';

function normalizeMatteValue(value) {
  if (value === undefined || value === null) {
    return DEFAULT_MATTE;
  }

  const candidate = String(value).trim();
  const match = MATTE_TYPES.find(option => option.toLowerCase() === candidate.toLowerCase());
  return match || DEFAULT_MATTE;
}

function normalizeFilterValue(value) {
  if (value === undefined || value === null) {
    return DEFAULT_FILTER;
  }

  const candidate = String(value).trim();
  const match = FILTER_TYPES.find(option => option.toLowerCase() === candidate.toLowerCase());
  return match || DEFAULT_FILTER;
}

module.exports = {
  MATTE_TYPES,
  PORTRAIT_MATTE_TYPES,
  UNIVERSAL_MATTE_TYPES,
  LANDSCAPE_ONLY_MATTE_TYPES,
  FILTER_TYPES,
  DEFAULT_MATTE,
  DEFAULT_FILTER,
  normalizeMatteValue,
  normalizeFilterValue,
  isMatteValidForPortrait,
  getMattesForOrientation
};
