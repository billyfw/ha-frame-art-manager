/**
 * Frame TV Art Display Options
 * These match the Samsung Frame TV's art mode settings
 */

const MATTE_TYPES = [
  'none',
  // Modern family
  'modern_polar',
  'modern_antique',
  'modern_warm',
  'modern_black',
  'modernthin_polar',
  'modernthin_antique',
  'modernthin_warm',
  'modernthin_black',
  'modernwide_polar',
  'modernwide_antique',
  'modernwide_warm',
  'modernwide_black',
  // Flexible family
  'flexible_polar',
  'flexible_antique',
  'flexible_warm',
  'flexible_black',
  // Shadowbox family
  'shadowbox_polar',
  'shadowbox_antique',
  'shadowbox_warm',
  'shadowbox_black'
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
