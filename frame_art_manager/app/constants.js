/**
 * Frame TV Art Display Options
 * These match the Samsung Frame TV's art mode settings
 * Queried from TV API via get_matte_list on 2024-12-26
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
  FILTER_TYPES,
  DEFAULT_MATTE,
  DEFAULT_FILTER,
  normalizeMatteValue,
  normalizeFilterValue
};
