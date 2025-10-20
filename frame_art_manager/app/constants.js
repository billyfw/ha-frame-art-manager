/**
 * Frame TV Art Display Options
 * These match the Samsung Frame TV's art mode settings
 */

const MATTE_TYPES = [
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
