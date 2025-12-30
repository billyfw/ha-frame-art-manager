// API Base URL
const API_BASE = 'api';

// Global state
let libraryPath = null; // Store library path for tooltips
let isSyncInProgress = false; // Track if a sync operation is currently running
let appEnvironment = 'development'; // 'development' or 'production'

/**
 * Extract base name from a hashed filename (e.g., "photo-abc123.jpg" -> "photo")
 * @param {string} filename - The filename with hash
 * @returns {string} - The base name without hash or extension
 */
function getBaseName(filename) {
  const lastDot = filename.lastIndexOf('.');
  const nameWithoutExt = lastDot > 0 ? filename.substring(0, lastDot) : filename;
  const lastDash = nameWithoutExt.lastIndexOf('-');
  // Check if the part after the last dash looks like a hash (8 hex chars)
  if (lastDash > 0) {
    const possibleHash = nameWithoutExt.substring(lastDash + 1);
    if (/^[a-f0-9]{8}$/i.test(possibleHash)) {
      return nameWithoutExt.substring(0, lastDash);
    }
  }
  return nameWithoutExt;
}

// State
const navigationContext = detectNavigationContext();
const isInitialTabLoad = navigationContext.isFirstLoadInTab;

const SORT_PREFERENCE_STORAGE_KEY = 'frameArt.sortPreference';

function loadSortPreference() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SORT_PREFERENCE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.order !== 'name' && parsed.order !== 'date')) {
      return null;
    }

    return {
      order: parsed.order,
      ascending: typeof parsed.ascending === 'boolean' ? parsed.ascending : true
    };
  } catch (error) {
    console.warn('Failed to load sort preference:', error);
    return null;
  }
}

function saveSortPreference(order, ascending) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      SORT_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        order,
        ascending: !!ascending
      })
    );
  } catch (error) {
    console.warn('Failed to save sort preference:', error);
  }
}

const storedSortPreference = loadSortPreference();
const initialSortOrderPreference = storedSortPreference?.order || 'modified';
let sortAscending = typeof storedSortPreference?.ascending === 'boolean' ? storedSortPreference.ascending : false;


let allImages = {};
let allTags = [];
let allTVs = [];
let currentImage = null;
let selectedImages = new Set();
let lastClickedIndex = null;
let galleryHasLoadedAtLeastOnce = false;
let currentUploadPreviewUrl = null;
let activeUploadPreviewToken = 0;
let thumbnailCacheBusters = {}; // Map of filename -> timestamp for cache busting edited thumbnails

// Chunked gallery rendering state
const GALLERY_CHUNK_SIZE = 100; // Initial and incremental load size
let currentFilteredImages = []; // Store filtered/sorted results for chunked loading
let renderedCount = 0; // How many images currently rendered
let isLoadingMoreImages = false; // Prevent multiple simultaneous loads

const createDefaultEditState = () => ({
  active: false,
  hasBackup: false,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  adjustments: { brightness: 0, contrast: 0, hue: 0, saturation: 0, lightness: 0 },
  filter: 'none',
  naturalWidth: 0,
  naturalHeight: 0,
  rotation: 0, // degrees, -45 to +45
  cropPreset: 'free',
  targetResolution: null,
  userSelectedCropPreset: false,
  autoPresetApplied: false,
  activeTool: null,
  isDirty: false,
  previewEnabled: true
});

const FILTER_ALIASES = {
  'gallery-soft': 'watercolor',
  'gallery': 'watercolor',
  'vivid-sky': 'pop-art',
  'dusk-haze': 'watercolor',
  'impressionist': 'impressionist',
  'oil painting': 'oil-paint',
  'oilpaint': 'oil-paint',
  'oil-painting': 'oil-paint',
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

const AVAILABLE_FILTERS = new Set([
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
]);

const METADATA_DEFAULT_MATTE = 'none';
const METADATA_DEFAULT_FILTER = 'None';

// Matte types that work for portrait images (Samsung firmware limitation)
// See frame-art-shuffler/docs/MATTE_BEHAVIOR.md for details
const PORTRAIT_MATTE_TYPES = ['flexible', 'shadowbox'];
const LANDSCAPE_ONLY_MATTE_TYPES = ['modernthin', 'modern', 'modernwide', 'panoramic', 'triptych', 'mix', 'squares'];

// Track current upload image orientation for matte filtering
let currentUploadIsPortrait = false;

/**
 * Check if a matte type is valid for portrait images
 */
function isMatteValidForPortrait(matte) {
  if (!matte || matte === 'none') return true;
  const matteType = matte.split('_')[0];
  return PORTRAIT_MATTE_TYPES.includes(matteType);
}

/**
 * Update matte dropdown to show only valid options based on image orientation
 * @param {string} selectId - ID of the select element
 * @param {boolean} isPortrait - Whether the image is portrait orientation
 * @param {string} currentValue - Current selected value to preserve if valid
 */
function updateMatteOptionsForOrientation(selectId, isPortrait, currentValue = null) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  const optgroups = Array.from(select.querySelectorAll('optgroup'));
  let newValue = currentValue || select.value;
  
  // Remove any existing separator
  const existingSeparator = select.querySelector('.portrait-separator');
  if (existingSeparator) {
    existingSeparator.remove();
  }
  
  // Map display labels to matte type prefixes
  const typeMap = {
    'modernthin': 'modernthin',
    'modern': 'modern',
    'modernwide': 'modernwide',
    'flexible': 'flexible',
    'shadowbox': 'shadowbox',
    'panoramic': 'panoramic',
    'triptych': 'triptych',
    'mix': 'mix',
    'squares': 'squares'
  };
  
  // Categorize optgroups
  const enabledGroups = [];
  const disabledGroups = [];
  
  optgroups.forEach(group => {
    const label = group.getAttribute('label') || '';
    const matteType = label.toLowerCase().replace(/\s+/g, '');
    const actualType = typeMap[matteType] || matteType;
    const isLandscapeOnly = LANDSCAPE_ONLY_MATTE_TYPES.includes(actualType);
    
    if (isPortrait && isLandscapeOnly) {
      group.disabled = true;
      group.classList.add('matte-disabled');
      disabledGroups.push(group);
    } else {
      group.disabled = false;
      group.classList.remove('matte-disabled');
      enabledGroups.push(group);
    }
  });
  
  // Reorder: enabled groups first, then separator (if portrait), then disabled groups
  // Get the 'none' option to keep it at the top
  const noneOption = select.querySelector('option[value="none"]');
  
  // Clear and rebuild select (keeping 'none' at top)
  select.innerHTML = '';
  if (noneOption) {
    select.appendChild(noneOption);
  }
  
  // Add enabled groups
  enabledGroups.forEach(group => select.appendChild(group));
  
  // Add separator and disabled groups if portrait
  if (isPortrait && disabledGroups.length > 0) {
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.className = 'portrait-separator';
    separator.textContent = '── Landscape only ──';
    select.appendChild(separator);
    
    disabledGroups.forEach(group => select.appendChild(group));
  } else {
    // For landscape, just add remaining groups in original order
    disabledGroups.forEach(group => select.appendChild(group));
  }
  
  // If current value is invalid for portrait, reset to 'none'
  if (isPortrait && !isMatteValidForPortrait(newValue)) {
    select.value = 'none';
  } else if (currentValue) {
    select.value = currentValue;
  }
}

/**
 * Detect if an image file is portrait orientation
 * @param {File} file - The image file to check
 * @returns {Promise<boolean>} - True if portrait (height > width)
 */
function detectImageOrientation(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      const isPortrait = img.naturalHeight > img.naturalWidth;
      URL.revokeObjectURL(url);
      resolve(isPortrait);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Default to landscape on error (shows all mattes)
      resolve(false);
    };
    
    img.src = url;
  });
}

// Similar Images filter - groups visually related images with adjustable threshold
// When similarFilterActive is true, an implicit "similar" sort mode is engaged
// that groups related images together, sorted by hamming distance (most similar first).
// This sort mode does NOT appear in the sort dropdown - it auto-activates when
// entering the filter and restores the previous sort state when exiting.
let similarFilterActive = false;
let similarGroups = []; // Cache of similar groups from server (arrays of filenames)
let similarDistances = {}; // Map of "fileA|fileB" -> distance
let similarBreakpoints = []; // Breakpoints for slider ticks
let preSimilarSortState = null; // Saved sort state before entering similar filter
let similarThreshold = 38; // Default threshold for similar images (adjustable via slider)

// Non 16:9 filter - shows images that are not 16:9 aspect ratio
let non169FilterActive = false;

// Portrait filter - shows images where height > width (aspect ratio < 1)
let portraitFilterActive = false;

// Recently Displayed filter - shows current and previous images from each TV
let recentlyDisplayedFilterActive = false;
let recentlyDisplayedData = {}; // Map of filename -> [{ tv_id, tv_name, time, timestamp }]
let preRecentSortState = null; // Saved sort state before entering recently displayed filter

/**
 * Fetch recently displayed images from all TVs
 * Returns map of filename -> [{ tv_id, tv_name, time, timestamp }]
 */
async function fetchRecentlyDisplayed() {
  try {
    const response = await fetch(`${API_BASE}/ha/recently-displayed`);
    if (!response.ok) throw new Error('Failed to fetch recently displayed');
    const data = await response.json();
    recentlyDisplayedData = data.images || {};
    return recentlyDisplayedData;
  } catch (error) {
    console.error('Error fetching recently displayed:', error);
    recentlyDisplayedData = {};
    return {};
  }
}

/**
 * Get set of filenames that are recently displayed
 */
function getRecentlyDisplayedFilenames() {
  return new Set(Object.keys(recentlyDisplayedData));
}

/**
 * Format time ago for recently displayed badge
 * @param {string|number} time - 'now' or timestamp
 * @returns {string} - Formatted time like 'Now', '5m ago', '2h ago', '1d ago'
 */
function formatRecentTimeAgo(time) {
  if (time === 'now') return 'Now';
  
  const timestamp = typeof time === 'number' ? time : new Date(time).getTime();
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMinutes < 1) return '1m ago';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Clear the recently displayed filter
 */
function clearRecentlyDisplayedFilter() {
  recentlyDisplayedFilterActive = false;
  const checkbox = document.querySelector('.recently-displayed-checkbox');
  if (checkbox) checkbox.checked = false;
}

/**
 * Get recently displayed info for an image
 * Returns array of { tvName: string, timeAgo: string } for badge display
 */
function getRecentlyDisplayedInfoForFile(filename) {
  if (!recentlyDisplayedFilterActive) return [];
  
  const entries = recentlyDisplayedData[filename] || [];
  if (entries.length === 0) return [];
  
  // Max TV name length for truncation
  const MAX_TV_NAME_LENGTH = 12;
  
  return entries.map(entry => {
    let tvName = entry.tv_name || 'Unknown TV';
    // Truncate long TV names
    if (tvName.length > MAX_TV_NAME_LENGTH) {
      tvName = tvName.substring(0, MAX_TV_NAME_LENGTH - 1) + '…';
    }
    const timeAgo = formatRecentTimeAgo(entry.time);
    return { tvName, timeAgo };
  });
}

/**
 * Check if an aspect ratio is approximately 16:9
 * Uses same tolerance as badge display (~1.78 ± 0.05)
 */
function isAspectRatio16x9(aspectRatio) {
  if (!aspectRatio) return false;
  return Math.abs(aspectRatio - 1.78) < 0.05;
}

/**
 * Count landscape images that are NOT 16:9 aspect ratio
 */
function countNon169Images() {
  let count = 0;
  for (const [filename, data] of Object.entries(allImages)) {
    // Only count landscape images (not portrait) that are not 16:9
    if (!isPortrait(data.aspectRatio) && !isAspectRatio16x9(data.aspectRatio)) {
      count++;
    }
  }
  return count;
}

/**
 * Check if an image is portrait orientation (height > width)
 */
function isPortrait(aspectRatio) {
  return aspectRatio && aspectRatio < 1.0;
}

/**
 * Count images that are portrait orientation
 */
function countPortraitImages() {
  let count = 0;
  for (const [filename, data] of Object.entries(allImages)) {
    if (isPortrait(data.aspectRatio)) {
      count++;
    }
  }
  return count;
}

/**
 * Check if a file might be a duplicate of existing images
 * @param {File} file - The file to check
 * @returns {Promise<{duplicates: string[]}>}
 */
async function checkForDuplicates(file) {
  try {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`${API_BASE}/images/check-duplicate`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Duplicate check failed');
    }

    return await response.json();
  } catch (error) {
    console.warn('Duplicate check error:', error);
    return { duplicates: [] };
  }
}

/**
 * Show duplicate warning in upload form
 * @param {string[]} duplicates - Array of duplicate filenames
 */
function showDuplicateWarning(duplicates) {
  const warningEl = document.getElementById('duplicate-warning');
  if (!warningEl) return;

  if (!duplicates || duplicates.length === 0) {
    warningEl.classList.add('hidden');
    warningEl.innerHTML = '';
    return;
  }

  // Build thumbnails for each duplicate
  const thumbsHtml = duplicates.map(filename => 
    `<div class="dupe-thumb-item">
      <img src="thumbs/thumb_${encodeURIComponent(filename)}" alt="${escapeHtml(filename)}" onerror="this.style.display='none'">
      <span class="dupe-thumb-name">${escapeHtml(filename)}</span>
    </div>`
  ).join('');

  warningEl.innerHTML = `
    <div class="dupe-warning-text">⚠️ This image is potentially a duplicate of:</div>
    <div class="dupe-thumbs">${thumbsHtml}</div>
  `;
  warningEl.classList.remove('hidden');
}

/**
 * Fetch all similar image groups from server (higher threshold than duplicates)
 * @param {number} threshold - Optional threshold override
 */
async function fetchSimilarGroups(threshold = similarThreshold) {
  try {
    const response = await fetch(`${API_BASE}/images/similar?threshold=${threshold}`);
    if (!response.ok) throw new Error('Failed to fetch similar images');
    const data = await response.json();
    similarGroups = data.groups || [];
    similarDistances = data.distances || {};
    return similarGroups;
  } catch (error) {
    console.error('Error fetching similar groups:', error);
    similarGroups = [];
    similarDistances = {};
    return [];
  }
}

/**
 * Fetch threshold breakpoints for the slider ticks
 */
async function fetchSimilarBreakpoints() {
  try {
    const response = await fetch(`${API_BASE}/images/similar/breakpoints`);
    if (!response.ok) throw new Error('Failed to fetch breakpoints');
    const data = await response.json();
    similarBreakpoints = data.breakpoints || [];
    return similarBreakpoints;
  } catch (error) {
    console.error('Error fetching similar breakpoints:', error);
    similarBreakpoints = [];
    return [];
  }
}

/**
 * Get set of filenames that are similar images
 */
function getSimilarFilenames() {
  const filenames = new Set();
  for (const group of similarGroups) {
    for (const filename of group) {
      filenames.add(filename);
    }
  }
  return filenames;
}

/**
 * Get counts for duplicates (threshold<=10) and similar (threshold<=38) from breakpoints
 * Breakpoints are sorted by threshold ascending, each has totalImages at that threshold
 * @returns {{ dupeCount: number, simCount: number }}
 */
function getSimilarBreakpointCounts() {
  if (!similarBreakpoints || similarBreakpoints.length === 0) {
    return { dupeCount: 0, simCount: 0 };
  }
  
  let dupeCount = 0;
  let totalAt38 = 0;
  
  // Find the highest totalImages at or below each threshold
  for (const bp of similarBreakpoints) {
    if (bp.threshold <= 10) {
      dupeCount = bp.totalImages || 0;
    }
    if (bp.threshold <= 38) {
      totalAt38 = bp.totalImages || 0;
    }
  }
  
  // simCount is images that are similar but not duplicates
  const simCount = totalAt38 - dupeCount;
  return { dupeCount, simCount: Math.max(0, simCount) };
}

const ADVANCED_TAB_DEFAULT = 'settings';
const VALID_ADVANCED_TABS = new Set(['settings', 'metadata', 'sync']);

function normalizeEditingFilterName(name) {
  if (!name) return 'none';
  const key = String(name).toLowerCase();
  const mapped = FILTER_ALIASES[key] || key;
  return AVAILABLE_FILTERS.has(mapped) ? mapped : 'none';
}

let editState = createDefaultEditState();
let editControls = null;
let cropInteraction = null;

function detectNavigationContext() {
  const defaultType = 'navigate';
  let detectedType = defaultType;

  try {
    if (typeof performance !== 'undefined') {
      if (typeof performance.getEntriesByType === 'function') {
        const entries = performance.getEntriesByType('navigation');
        if (entries && entries.length > 0) {
          detectedType = entries[0]?.type || defaultType;
        }
      } else if (performance.navigation) {
        switch (performance.navigation.type) {
          case performance.navigation.TYPE_RELOAD:
            detectedType = 'reload';
            break;
          case performance.navigation.TYPE_BACK_FORWARD:
            detectedType = 'back_forward';
            break;
          case performance.navigation.TYPE_NAVIGATE:
            detectedType = 'navigate';
            break;
          default:
            detectedType = defaultType;
            break;
        }
      }
    }
  } catch (error) {
    console.warn('Navigation context detection failed:', error);
  }

  if (!['navigate', 'reload', 'back_forward', 'prerender'].includes(detectedType)) {
    detectedType = defaultType;
  }

  return {
    navigationType: detectedType,
    isReloadNavigation: detectedType === 'reload',
    isBackForwardNavigation: detectedType === 'back_forward',
    isFirstLoadInTab: detectedType === 'navigate'
  };
}

// Hash-based routing
function handleRoute() {
  const hash = window.location.hash.slice(1) || '/'; // Remove '#' and default to '/'
  const [path, queryString] = hash.split('?');
  const params = new URLSearchParams(queryString || '');
  
  if (path.startsWith('/advanced')) {
    const parts = path.split('/');
    const requestedTab = parts[2] || ADVANCED_TAB_DEFAULT; // /advanced/sync -> 'sync'
    // Redirect old analytics URL to new location
    if (requestedTab === 'analytics') {
      navigateTo('/analytics');
      return;
    }
    const subTab = VALID_ADVANCED_TABS.has(requestedTab) ? requestedTab : ADVANCED_TAB_DEFAULT;
    switchToTab('advanced');
    switchToAdvancedSubTab(subTab);
  } else if (path === '/analytics') {
    switchToTab('analytics');
    const imageParam = params.get('image');
    loadAnalytics(imageParam);
  } else if (path === '/upload') {
    switchToTab('upload');
  } else {
    // Default to gallery
    switchToTab('gallery');
  }
}

function navigateTo(path) {
  window.location.hash = '#' + path;
  // handleRoute will be called automatically by hashchange event
}

function switchToAdvancedSubTab(tabName) {
  const requested = typeof tabName === 'string' ? tabName.trim().toLowerCase() : '';
  const targetTab = VALID_ADVANCED_TABS.has(requested) ? requested : ADVANCED_TAB_DEFAULT;

  document.querySelectorAll('.advanced-tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === targetTab);
  });

  document.querySelectorAll('.advanced-tab-content').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `advanced-${targetTab}-content`);
  });

  if (targetTab === 'sync') {
    setTimeout(() => {
      loadSyncStatus();
      loadSyncLogs();
    }, 0);
  } else if (targetTab === 'metadata') {
    loadMetadata();
  }
}

// Debug flag: force the tag filter dropdown to always be visible
let DEBUG_ALWAYS_SHOW_TAG_DROPDOWN = false;

// Dropdown portal state for reliable visibility/positioning
const tagDropdownState = {
  isOpen: false,
  originalParent: null,
  originalNextSibling: null,
  resizeHandler: null,
  scrollHandler: null,
};

function getTagFilterElements() {
  return {
    btn: document.getElementById('tag-filter-btn'),
    dropdown: document.getElementById('tag-filter-dropdown'),
    text: document.getElementById('tag-filter-text')
  };
}

function positionTagDropdownToButton() {
  const { btn, dropdown } = getTagFilterElements();
  if (!btn || !dropdown) return;
  // Ensure it's visible to measure size
  dropdown.style.visibility = 'hidden';
  dropdown.style.display = 'block';
  // Use fixed positioning relative to viewport
  dropdown.style.position = 'fixed';
  const rect = btn.getBoundingClientRect();
  // Minimum width matches the button
  dropdown.style.minWidth = `${Math.max(rect.width, 150)}px`;
  const dropdownWidth = dropdown.offsetWidth;
  const margin = 6; // small gap below the button
  // Align the dropdown's right edge with the button's right edge
  let left = rect.right - dropdownWidth;
  let top = rect.bottom + margin;
  // Prevent overflow to the right
  if (left + dropdownWidth > window.innerWidth - 8) {
    const targetRight = Math.min(rect.right, window.innerWidth - 8);
    left = targetRight - dropdownWidth;
  }
  // Prevent overflow to the left
  if (left < 8) left = 8;
  // Prevent overflow to the bottom
  const dropdownHeight = dropdown.offsetHeight;
  if (top + dropdownHeight > window.innerHeight - 8) {
    // Try placing above the button
    const aboveTop = rect.top - dropdownHeight - margin;
    if (aboveTop >= 8) {
      top = aboveTop;
    } else {
      // Clamp to viewport and let it scroll internally
      top = Math.max(8, window.innerHeight - dropdownHeight - 8);
    }
  }
  dropdown.style.left = `${left}px`;
  dropdown.style.top = `${top}px`;
  dropdown.style.visibility = 'visible';
}

function openTagDropdownPortal() {
  const { btn, dropdown } = getTagFilterElements();
  if (!btn || !dropdown) return;
  if (tagDropdownState.isOpen) return;

  // Save original placement
  tagDropdownState.originalParent = dropdown.parentNode;
  tagDropdownState.originalNextSibling = dropdown.nextSibling;

  // Remove any existing shield first
  const existingShield = document.getElementById('dropdown-click-shield');
  if (existingShield) existingShield.remove();
  
  // Create fresh click shield to catch outside clicks without triggering elements underneath
  const shield = document.createElement('div');
  shield.id = 'dropdown-click-shield';
  shield.className = 'dropdown-click-shield';
  
  // Absorb all touch events to prevent them reaching cards underneath
  shield.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  shield.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Close on touchend instead of touchstart, so shield absorbs the full touch sequence
    closeTagDropdownPortal();
  }, { passive: false });
  shield.addEventListener('touchmove', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  // Also handle click for mouse/desktop
  shield.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeTagDropdownPortal();
  });
  document.body.appendChild(shield);

  // Disable hover effects on gallery cards while dropdown is open
  document.body.classList.add('dropdown-open');

  // Move to body and show
  document.body.appendChild(dropdown);
  dropdown.classList.add('active');
  dropdown.classList.remove('debug-visible');
  dropdown.style.display = 'block';
  dropdown.style.pointerEvents = 'auto'; // Re-enable clicks when open
  dropdown.style.zIndex = '9999';
  dropdown.style.right = 'auto';
  positionTagDropdownToButton();

  // Mark button active
  btn.classList.add('active');
  btn.setAttribute('aria-expanded', 'true');
  dropdown.setAttribute('aria-hidden', 'false');

  // Ensure options exist on first open
  const optionsContainer = dropdown.querySelector('.multiselect-options');
  if (optionsContainer && optionsContainer.children.length === 0) {
    try { void loadTagsForFilter(); } catch {}
  }

  // Reposition on resize/scroll while open (but ignore scroll events from within the dropdown)
  tagDropdownState.resizeHandler = () => positionTagDropdownToButton();
  tagDropdownState.scrollHandler = (e) => {
    // Don't reposition if scrolling inside the dropdown itself
    if (dropdown.contains(e.target)) return;
    positionTagDropdownToButton();
  };
  window.addEventListener('resize', tagDropdownState.resizeHandler);
  window.addEventListener('scroll', tagDropdownState.scrollHandler, true);

  tagDropdownState.isOpen = true;
}

function closeTagDropdownPortal() {
  const { btn, dropdown } = getTagFilterElements();
  
  // Remove click shield and re-enable hover effects
  const shield = document.getElementById('dropdown-click-shield');
  if (shield) shield.remove();
  // Delay removing dropdown-open class to ensure hover suppression stays active through touch end
  setTimeout(() => document.body.classList.remove('dropdown-open'), 300);
  
  if (!dropdown || !tagDropdownState.isOpen) {
    // Also ensure inline display is off even if we think it's closed
    if (dropdown) {
      dropdown.classList.remove('active');
      dropdown.style.display = 'none';
      dropdown.style.pointerEvents = 'none'; // Ensure it can't intercept clicks
      dropdown.setAttribute('aria-hidden', 'true');
    }
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  // Hide and restore to original parent
  dropdown.classList.remove('active');
  dropdown.style.display = 'none';
  dropdown.style.pointerEvents = 'none'; // Ensure it can't intercept clicks when closed
  dropdown.style.position = '';
  dropdown.style.left = '';
  dropdown.style.top = '';
  dropdown.style.minWidth = '';
  dropdown.style.right = '';
  dropdown.style.zIndex = ''; // Reset z-index

  if (tagDropdownState.originalParent) {
    if (tagDropdownState.originalNextSibling && tagDropdownState.originalNextSibling.parentNode === tagDropdownState.originalParent) {
      tagDropdownState.originalParent.insertBefore(dropdown, tagDropdownState.originalNextSibling);
    } else {
      tagDropdownState.originalParent.appendChild(dropdown);
    }
  }

  // Button state
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
  dropdown.setAttribute('aria-hidden', 'true');

  // Remove handlers
  if (tagDropdownState.resizeHandler) {
    window.removeEventListener('resize', tagDropdownState.resizeHandler);
    tagDropdownState.resizeHandler = null;
  }
  if (tagDropdownState.scrollHandler) {
    window.removeEventListener('scroll', tagDropdownState.scrollHandler, true);
    tagDropdownState.scrollHandler = null;
  }

  tagDropdownState.isOpen = false;
}

const UUID_SUFFIX_PATTERN = /-[0-9a-f]{8}$/i;

function extractBaseComponents(fn) {
  const lastDotIndex = fn.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return {
      base: fn,
      ext: '',
      hasUuid: false
    };
  }

  const ext = fn.substring(lastDotIndex);
  const nameWithoutExt = fn.substring(0, lastDotIndex);

  if (UUID_SUFFIX_PATTERN.test(nameWithoutExt)) {
    return {
      base: nameWithoutExt.substring(0, nameWithoutExt.lastIndexOf('-')),
      ext,
      hasUuid: true
    };
  }

  return {
    base: nameWithoutExt,
    ext,
    hasUuid: false
  };
}

// Helper function to get display name without UUID
function getDisplayName(filename) {
  const { base, hasUuid } = extractBaseComponents(filename);
  if (!hasUuid) {
    return filename;
  }

  const allFilenames = Object.keys(allImages);
  const sharedBaseCount = allFilenames.filter(fn => {
    const parsed = extractBaseComponents(fn);
    return parsed.base === base;
  }).length;

  if (sharedBaseCount > 1) {
    return filename;
  }

  return base;
}

// Helper function to get similar images for a filename (excluding itself)
// Returns array of {filename, distance} objects with actual pairwise distances
function getSimilarImagesForFile(filename) {
  if (!similarFilterActive || similarGroups.length === 0) return [];
  
  // Find the group containing this filename
  const group = similarGroups.find(g => g.includes(filename));
  if (!group) return [];
  
  // Return other images in the group with their pairwise distances to this file
  return group
    .filter(other => other !== filename)
    .map(other => {
      // Look up distance using canonical key (alphabetically sorted)
      const key = filename < other ? `${filename}|${other}` : `${other}|${filename}`;
      const distance = similarDistances[key] || 0;
      return { filename: other, distance };
    })
    .sort((a, b) => a.distance - b.distance); // Sort by distance
}

// Helper function to format date
function formatDate(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  
  return `${month} ${day}, ${year}`;
}

// Short date format for mobile: m/d/yy
function formatDateShort(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  
  return `${month}/${day}/${year}`;
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  loadLibraryPath();
  initCloudSyncButton(); // Initialize cloud sync button in toolbar - BEFORE checking sync
  
  const sortOrderSelect = document.getElementById('sort-order');
  if (sortOrderSelect) {
    sortOrderSelect.value = initialSortOrderPreference;
  }

  updateSortDirectionIcon();
  saveSortPreference(sortOrderSelect ? sortOrderSelect.value : initialSortOrderPreference, sortAscending);

  // Set up hash-based routing
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('load', handleRoute);
  
  // Load UI first so user can start working immediately
  loadGallery();
  loadTags();
  loadTVs();
  initUploadForm();
  initBatchUploadForm(); // Initialize batch upload
  initTagForm();
  initModal();
  initMetadataViewer();
  initSyncDetail();
  initBulkActions();
  initSettingsNavigation();
  initUploadNavigation();
  initTvModal();
  initGalleryInfiniteScroll(); // Initialize infinite scroll for gallery
  
  // Pre-fetch similar groups for filter counts
  fetchSimilarGroups();
  fetchSimilarBreakpoints();
  
  // Pre-fetch recently displayed for filter counts
  fetchRecentlyDisplayed();
  
  // Handle initial route
  handleRoute();
  
  // Check for sync updates in the background (after UI is loaded)
  checkSyncOnLoad();
  
  // Load analytics data in background for gallery "last display" info
  loadAnalyticsDataForGallery();
});

// Check for sync updates on page load
async function checkSyncOnLoad() {
  // Check if sync is already in progress
  if (isSyncInProgress) {
    console.log('Sync already in progress, skipping load check...');
    return;
  }
  
  try {
    isSyncInProgress = true; // Mark as in progress
    
    // Show checking state
    updateSyncButtonState('syncing', 'Syncing...', null, null, null);
    
    console.log('Checking for cloud updates...');
    const response = await fetch(`${API_BASE}/sync/check`);
    const data = await response.json();
    
    if (data.success && (data.pulledChanges || data.autoResolvedConflict)) {
      console.log(`✅ ${data.message}`);
      if (data.autoResolvedConflict) {
        alertLostLocalChanges(data.lostChangesSummary);
      }
      // Release lock before fetching new data
      isSyncInProgress = false;
      await refreshGalleryAfterSync(data);
      await loadTags();
      await updateSyncStatus();
      await loadSyncLogs();
      return; // Skip the finally block since we already released
    } else if (data.skipped) {
      console.log(`⚠️ Sync skipped: ${data.reason}`);
      // There are uncommitted local changes - auto-push them
      console.log('Auto-pushing local changes...');
      isSyncInProgress = false; // Clear before calling autoPush (it sets its own flag)
      await autoPushLocalChanges();
      return; // autoPushLocalChanges will clear the flag
    } else if (!data.success && data.error) {
      console.warn(`⚠️ Sync check failed: ${data.error}`);
      updateSyncButtonState('error', 'Error', null, null, data.error);
    } else {
  console.log('✅ Already up to date');
  // We're synced - release lock before checking for local changes
  isSyncInProgress = false;
  // Check if there are local changes
  await updateSyncStatus();
  return; // Skip the finally block since we already released
    }
  } catch (error) {
    console.error('Error checking sync on load:', error);
    // Fail silently - don't block page load if sync check fails
    updateSyncButtonState('error', 'Error', null, null, error.message);
    await loadSyncLogs();
  } finally {
    isSyncInProgress = false; // Always clear flag
  }
}

// Auto-push local changes on page load
async function autoPushLocalChanges() {
  const callId = Math.random().toString(36).substring(7);
  console.log(`\n🟦 [FE-${callId}] autoPushLocalChanges() called`);
  
  // Check if sync is already in progress
  if (isSyncInProgress) {
    console.log(`⏸️  [FE-${callId}] Sync already in progress (frontend lock), skipping...`);
    return;
  }
  
  try {
    isSyncInProgress = true; // Mark as in progress
    console.log(`🔒 [FE-${callId}] Frontend lock acquired`);
    console.log(`📡 [FE-${callId}] Calling /api/sync/full...`);
    
    // Use atomic full sync endpoint (same as manual sync)
    const syncResponse = await fetch(`${API_BASE}/sync/full`, {
      method: 'POST'
    });
    
    console.log(`📨 [FE-${callId}] Response status: ${syncResponse.status}`);
    const syncData = await syncResponse.json();
    console.log(`📦 [FE-${callId}] Response data:`, syncData);
    
    if (syncData.success) {
      console.log(`✅ [FE-${callId}] Auto-sync successful:`, syncData.message);
      if (syncData.autoResolvedConflict) {
        alertLostLocalChanges(syncData.lostChangesSummary);
      }
      await refreshGalleryAfterSync(syncData);
      await loadTags();
      // Update status to show we're synced
      await updateSyncStatus();
      await loadSyncLogs();
    } else {
      const validationDetails = formatValidationErrors(syncData.validationErrors);

      if (validationDetails) {
        const message = `Uploaded files failed validation and were removed.\n\n${validationDetails}`;
        console.error(`❌ [FE-${callId}] Auto-sync validation failure:`, syncData.validationErrors);
        alert(message);
        updateSyncButtonState('error', 'Error', null, null, message);
      } else {
        console.error(`❌ [FE-${callId}] Auto-sync failed:`, syncData.error);
        updateSyncButtonState('error', 'Error', null, null, syncData.error);
      }
      // Fetch the current sync status to show proper badge/tooltip
      await updateSyncStatus();
      await loadSyncLogs();
    }
  } catch (error) {
    console.error(`💥 [FE-${callId}] Error during auto-sync:`, error);
    // Fetch the current sync status to show proper badge/tooltip
    await updateSyncStatus();
    await loadSyncLogs();
  } finally {
    console.log(`🔓 [FE-${callId}] Frontend lock released\n`);
    isSyncInProgress = false; // Always clear flag
  }
}

// Update sync button status
async function updateSyncStatus() {
  // Don't update status if sync is in progress - let the sync operation control the button state
  if (isSyncInProgress) {
    console.log('⏸️  Skipping status update - sync in progress');
    return;
  }
  
  console.log('🔍 updateSyncStatus() called');
  
  try {
    const response = await fetch(`${API_BASE}/sync/status`);
    const data = await response.json();
    
    console.log('📊 Sync status response:', data);
    
    if (!data.success) {
      console.error('❌ Sync status check failed');
      updateSyncButtonState('error', 'Error', null, null, null);
      return;
    }
    
    const status = data.status;
    
    // Determine state based on status
    if (status.hasChanges) {
      console.log('⚠️  Has changes - setting unsynced state');
      updateSyncButtonState('unsynced', 'Unsynced', status, null, null);
    } else {
      console.log('✅ No changes - setting synced state');
      updateSyncButtonState('synced', 'Synced', null, null, null);
    }
    
  } catch (error) {
    console.error('Error updating sync status:', error);
    updateSyncButtonState('error', 'Error', null, null, error.message);
  }
}

// Update sync button visual state
function updateSyncButtonState(state, text, syncStatus, _unused, errorMessage) {
  console.log(`🎨 updateSyncButtonState() called with state: ${state}, text: ${text}`);
  
  const syncBtn = document.getElementById('sync-btn');
  const syncIcon = document.getElementById('sync-icon');
  const syncText = document.getElementById('sync-text');
  const syncBadge = document.getElementById('sync-badge');
  
  if (!syncBtn) {
    console.error('❌ Sync button element not found!');
    return;
  }
  
  // Remove all state classes
  syncBtn.classList.remove('synced', 'syncing', 'unsynced', 'error');
  
  // Add current state class
  syncBtn.classList.add(state);
  
  // Set icon based on state
  const icons = {
    synced: '✅',
    syncing: '🔄',
    unsynced: '⚠️',
    error: '❌'
  };
  syncIcon.textContent = icons[state] || '☁️';
  
  // Set text label
  if (syncText) {
    syncText.textContent = text;
  }
  
  // Update badge with up/down triangle format
  if (state === 'unsynced' && syncStatus) {
    const uploadCount = syncStatus.upload.count;
    const downloadCount = syncStatus.download.count;
    
    let badgeText = '';
    if (uploadCount > 0 && downloadCount > 0) {
      badgeText = `${uploadCount}▲/${downloadCount}▼`;
    } else if (uploadCount > 0) {
      badgeText = `${uploadCount}▲`;
    } else if (downloadCount > 0) {
      badgeText = `${downloadCount}▼`;
    }
    
    if (badgeText) {
      syncBadge.textContent = badgeText;
      syncBadge.style.display = 'block';
    } else {
      syncBadge.style.display = 'none';
    }
  } else {
    syncBadge.style.display = 'none';
  }
  
  // Update tooltip
  let tooltip;
  
  if (state === 'synced') {
    tooltip = libraryPath 
      ? `Frame Art Gallery is synced to cloud Git LFS repo at ${libraryPath}`
      : 'All changes synced to cloud';
  } else if (state === 'unsynced' && syncStatus) {
    // Build multi-line tooltip
    const lines = [];
    
    // Upload changes
    if (syncStatus.upload.newImages > 0) {
      const plural = syncStatus.upload.newImages !== 1 ? 's' : '';
      lines.push(`${syncStatus.upload.newImages} new image${plural} to upload`);
    }
    // Combine modifications and renames
    const uploadModCount = (syncStatus.upload.modifiedImages || 0) + (syncStatus.upload.renamedImages || 0);
    if (uploadModCount > 0) {
      const text = uploadModCount === 1 ? 'image modification' : 'image modifications';
      lines.push(`${uploadModCount} ${text} to upload`);
    }
    if (syncStatus.upload.deletedImages > 0) {
      const count = syncStatus.upload.deletedImages;
      const text = count === 1 ? 'image deletion' : 'image deletions';
      lines.push(`${count} ${text} to upload`);
    }
    
    // Download changes
    if (syncStatus.download.newImages > 0) {
      const plural = syncStatus.download.newImages !== 1 ? 's' : '';
      lines.push(`${syncStatus.download.newImages} new image${plural} to download`);
    }
    // Combine modifications and renames
    const downloadModCount = (syncStatus.download.modifiedImages || 0) + (syncStatus.download.renamedImages || 0);
    if (downloadModCount > 0) {
      const text = downloadModCount === 1 ? 'image modification' : 'image modifications';
      lines.push(`${downloadModCount} ${text} to download`);
    }
    if (syncStatus.download.deletedImages > 0) {
      const count = syncStatus.download.deletedImages;
      const text = count === 1 ? 'image deletion' : 'image deletions';
      lines.push(`${count} ${text} to download`);
    }
    
    // Add blank line before "Click to sync" if there are any changes
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Click to sync');
    tooltip = lines.join('\n');
  } else if (state === 'error' && errorMessage) {
    // Show the actual error in the tooltip
    tooltip = `Sync error: ${errorMessage}. Click to retry.`;
  } else {
    const tooltips = {
      syncing: 'Syncing with cloud...',
      unsynced: 'Changes not synced - click to sync',
      error: 'Sync error - click to retry'
    };
    tooltip = tooltips[state] || 'Sync with cloud';
  }
  
  syncBtn.title = tooltip;
  
  // Disable button when syncing
  syncBtn.disabled = (state === 'syncing');
}

// Initialize cloud sync button (toolbar)
function initCloudSyncButton() {
  const syncBtn = document.getElementById('sync-btn');
  if (!syncBtn) {
    console.warn('Cloud sync button not found - skipping initialization');
    return;
  }
  
  syncBtn.addEventListener('click', async () => {
    await manualSync();
  });
}

function alertLostLocalChanges(lostChangesSummary) {
  const lines = Array.isArray(lostChangesSummary) && lostChangesSummary.length > 0
    ? lostChangesSummary
    : ['Local changes were discarded in favor of the cloud version.'];
  const message = ['Sync completed using the cloud version.', 'Local changes were discarded:', '']
    .concat(lines)
    .join('\n');
  alert(message);
}

function formatValidationErrors(validationErrors) {
  if (!Array.isArray(validationErrors) || validationErrors.length === 0) {
    return null;
  }

  return validationErrors
    .map(err => {
      const file = err?.file || 'Unknown file';
      const reason = err?.reason || 'Unknown reason';
      return `• ${file}: ${reason}`;
    })
    .join('\n');
}

function hasRemoteNewImages(syncData) {
  if (!syncData) return false;
  const summaries = [];

  if (Array.isArray(syncData.remoteChangesSummary)) {
    summaries.push(...syncData.remoteChangesSummary);
  }

  if (Array.isArray(syncData.remoteChanges)) {
    summaries.push(...syncData.remoteChanges);
  }

  return summaries.some(entry => typeof entry === 'string' && /remote added image/i.test(entry));
}

function setGallerySortToNewestFirst() {
  sortAscending = false;
  const sortOrderSelect = document.getElementById('sort-order');
  let changeDispatched = false;

  if (sortOrderSelect) {
    if (sortOrderSelect.value !== 'date') {
      sortOrderSelect.value = 'date';
      const changeEvent = new Event('change', { bubbles: true });
      sortOrderSelect.dispatchEvent(changeEvent);
      changeDispatched = true;
    }
  }

  updateSortDirectionIcon();

  if (!changeDispatched) {
    renderGallery();
  }

  const orderValue = sortOrderSelect ? sortOrderSelect.value : 'date';
  saveSortPreference(orderValue, sortAscending);
}

async function refreshGalleryAfterSync(syncData) {
  const hadGalleryBefore = galleryHasLoadedAtLeastOnce;
  const previousKeys = new Set(Object.keys(allImages || {}));
  await loadGallery();
  const currentKeys = Object.keys(allImages || {});
  const addedKeys = currentKeys.filter(key => !previousKeys.has(key));

  const hasNewImagesFromRemote = hasRemoteNewImages(syncData);
  if ((hadGalleryBefore && addedKeys.length > 0) || hasNewImagesFromRemote) {
    setGallerySortToNewestFirst();
  }

  return addedKeys;
}

// Manual sync (commit, pull, then push)
async function manualSync() {
  const callId = Math.random().toString(36).substring(7);
  console.log(`\n🟩 [FE-${callId}] manualSync() called (user clicked sync button)`);
  
  // Check if sync is already in progress
  if (isSyncInProgress) {
    console.log(`⏸️  [FE-${callId}] Sync already in progress (frontend lock), skipping...`);
    return;
  }
  
  try {
    // Mark sync as in progress
    isSyncInProgress = true;
    console.log(`🔒 [FE-${callId}] Frontend lock acquired`);
    
    // Set syncing state
    updateSyncButtonState('syncing', 'Syncing...', null, null, null);
    
    console.log(`📡 [FE-${callId}] Calling /api/sync/full...`);
    
    // Use the atomic full sync endpoint (commit → pull → push in one transaction)
    const syncResponse = await fetch(`${API_BASE}/sync/full`, {
      method: 'POST'
    });
    
    console.log(`📨 [FE-${callId}] Response status: ${syncResponse.status}`);
    const syncData = await syncResponse.json();
    console.log(`📦 [FE-${callId}] Response data:`, syncData);
    
    // Check both HTTP status and success flag
    if (!syncResponse.ok || !syncData.success) {
      // Check if another sync is in progress (backend lock)
      if (syncData.syncInProgress) {
        console.log(`⚠️  [FE-${callId}] Backend sync in progress, will retry automatically`);
        updateSyncButtonState('syncing', 'Syncing...', null, null, null);
        isSyncInProgress = false; // Clear frontend flag
        return;
      }
      
      const validationDetails = formatValidationErrors(syncData.validationErrors);

      if (validationDetails) {
        const message = `Uploaded files failed validation and were removed.\n\n${validationDetails}`;
        console.error(`❌ [FE-${callId}] Validation failure:`, syncData.validationErrors);
        alert(message);
        updateSyncButtonState('error', 'Error', null, null, message);
      }
      // Check for conflicts
      else if (syncData.hasConflicts) {
        console.error(`❌ [FE-${callId}] Sync conflict detected:`, syncData.error);
        alert('Git sync conflict detected!\n\nThis requires manual resolution. Please check the Sync Detail tab in Advanced settings.');
        updateSyncButtonState('error', 'Conflict', null, null, syncData.error);
      } else {
        console.error(`❌ [FE-${callId}] Sync failed:`, syncData.error);
        alert(`Sync failed: ${syncData.error}`);
        updateSyncButtonState('error', 'Error', null, null, syncData.error);
      }
      await loadSyncLogs();
      isSyncInProgress = false; // Clear flag
      return;
    }
    
    console.log(`✅ [FE-${callId}] Full sync complete:`, syncData.message);

    if (syncData.autoResolvedConflict) {
      alertLostLocalChanges(syncData.lostChangesSummary);
    }
    
    // Reload gallery to show any new images from pull
    await refreshGalleryAfterSync(syncData);
    await loadTags();
    await loadSyncLogs();
    
    // Release lock before updating status so the status update isn't skipped
    console.log(`🔓 [FE-${callId}] Frontend lock released\n`);
    isSyncInProgress = false; // Clear flag on success
    
    // Update sync status (now that lock is released)
    try {
      await updateSyncStatus();
    } catch (statusError) {
      console.error(`⚠️  [FE-${callId}] Failed to update sync status:`, statusError);
      // Fallback: ensure button is at least set to synced state
      updateSyncButtonState('synced', 'Synced', null, null, null);
    }
    
  } catch (error) {
    console.error(`💥 [FE-${callId}] Error during manual sync:`, error);
    const errorMsg = error.message || 'Network error or server unavailable';
    alert(`Sync error: ${errorMsg}`);
    updateSyncButtonState('error', 'Error', null, null, errorMsg);
    await loadSyncLogs();
    console.log(`🔓 [FE-${callId}] Frontend lock released (error path)\n`);
    isSyncInProgress = false; // Clear flag on exception
  }
}

// Load and display library path
async function loadLibraryPath() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    const pathValue = data.frameArtPath || 'Unknown';
    
    // Store globally
    libraryPath = pathValue;
    appEnvironment = data.env || 'development';
    
    // Update advanced tab path display
    const advancedPathElement = document.getElementById('advanced-path-value');
    if (advancedPathElement) {
      advancedPathElement.textContent = pathValue;
    }
  } catch (error) {
    console.error('Error loading library path:', error);
    const advancedPathElement = document.getElementById('advanced-path-value');
    if (advancedPathElement) {
      advancedPathElement.textContent = 'Error loading path';
    }
  }
}

// Tab Navigation (simplified - no actual tabs, just for switchToTab function)
function initTabs() {
  // No tab buttons anymore, but keep function for compatibility
}

// Programmatic tab switching (used by gear/home/add buttons)
function switchToTab(tabName) {
  const tabContents = document.querySelectorAll('.tab-content');

  // Clear active state from all
  tabContents.forEach(content => content.classList.remove('active'));

  // Show target tab content
  const targetContent = document.getElementById(`${tabName}-tab`);
  if (targetContent) {
    targetContent.classList.add('active');
  }

  // Reload data similar to initTabs click behavior
  if (tabName === 'gallery') {
    loadGallery();
  }
  if (tabName === 'advanced') {
    loadLibraryPath();
    loadTags();
    loadMetadata();
  }
  if (tabName === 'upload') {
    // Render suggested tags when entering upload tab
    renderUploadTvTagsHelper();
    renderUploadAppliedTags();
  }
}

function initUploadNavigation() {
  const openUploadBtn = document.getElementById('open-upload-btn');
  const goHomeUploadBtn = document.getElementById('go-home-upload-btn');

  if (openUploadBtn) {
    openUploadBtn.addEventListener('click', () => {
      navigateTo('/upload');
    });
  }

  if (goHomeUploadBtn) {
    goHomeUploadBtn.addEventListener('click', () => {
      navigateTo('/');
    });
  }
}

function initSettingsNavigation() {
  const openAdvancedBtn = document.getElementById('open-advanced-btn');
  const openAnalyticsBtn = document.getElementById('open-analytics-btn');
  const goHomeBtn = document.getElementById('go-home-btn');
  const goHomeAnalyticsBtn = document.getElementById('go-home-analytics-btn');

  if (openAdvancedBtn) {
    openAdvancedBtn.addEventListener('click', () => {
      // Close any open dropdowns in the gallery toolbar
      const tagFilterBtn = document.getElementById('tag-filter-btn');
      const tagFilterDropdown = document.getElementById('tag-filter-dropdown');
      tagFilterBtn?.classList.remove('active');
      tagFilterDropdown?.classList.remove('active');
      // Also ensure hidden and portal closed
      closeTagDropdownPortal();
      navigateTo(`/advanced/${ADVANCED_TAB_DEFAULT}`);
    });
  }

  if (openAnalyticsBtn) {
    openAnalyticsBtn.addEventListener('click', () => {
      // Close any open dropdowns in the gallery toolbar
      const tagFilterBtn = document.getElementById('tag-filter-btn');
      const tagFilterDropdown = document.getElementById('tag-filter-dropdown');
      tagFilterBtn?.classList.remove('active');
      tagFilterDropdown?.classList.remove('active');
      closeTagDropdownPortal();
      navigateTo('/analytics');
    });
  }

  if (goHomeBtn) {
    goHomeBtn.addEventListener('click', () => {
      navigateTo('/');
    });
  }

  if (goHomeAnalyticsBtn) {
    goHomeAnalyticsBtn.addEventListener('click', () => {
      navigateTo('/');
    });
  }

  // Initialize advanced sub-tabs
  initAdvancedSubTabs();
  
  // Initialize analytics mobile tabs
  initAnalyticsMobileTabs();
}

function initAdvancedSubTabs() {
  const tabButtons = document.querySelectorAll('.advanced-tab-btn');

  tabButtons.forEach((button) => {
    button.setAttribute('type', 'button');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const requestedTab = typeof button.dataset.tab === 'string' ? button.dataset.tab : '';
      const safeTab = VALID_ADVANCED_TABS.has(requestedTab) ? requestedTab : ADVANCED_TAB_DEFAULT;
      navigateTo(`/advanced/${safeTab}`);
    });
  });
}

function initAnalyticsMobileTabs() {
  const tabButtons = document.querySelectorAll('.analytics-mobile-tab');
  
  tabButtons.forEach((button) => {
    button.setAttribute('type', 'button');
    button.addEventListener('click', () => {
      const targetColumn = button.dataset.column;
      
      // Update tab buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update visibility via data attribute on page content container
      const pageContent = document.querySelector('.analytics-page-content');
      if (pageContent) {
        pageContent.dataset.activeColumn = targetColumn;
      }
    });
  });
}

// Gallery Functions
async function loadGallery() {
  const grid = document.getElementById('image-grid');
  if (!grid) {
    console.warn('Image grid element not found; skipping gallery load.');
    return;
  }

  grid.innerHTML = '<div class="loading">Loading images...</div>';

  try {
    const response = await fetch(`${API_BASE}/images`);
    allImages = await response.json();
    galleryHasLoadedAtLeastOnce = true;

    // Also load tags for filter dropdown
    await loadTagsForFilter();

    renderGallery();
  } catch (error) {
    console.error('Error loading gallery:', error);
    if (grid) {
      grid.innerHTML = '<div class="error">Failed to load images</div>';
    }
  }
}

// Selection Functions

/**
 * Update only the visual selection state of gallery cards without re-rendering.
 * This prevents scroll position reset and flickering when selecting images.
 */
function updateGallerySelectionVisual() {
  const grid = document.getElementById('image-grid');
  if (!grid) return;
  
  const allCards = grid.querySelectorAll('.image-card');
  allCards.forEach(card => {
    const filename = card.dataset.filename;
    if (selectedImages.has(filename)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
  
  // Update the bulk actions bar
  updateBulkActionsBar(currentFilteredImages.length);
}

function handleImageClick(filename, index, event) {
  event.stopPropagation();
  
  const grid = document.getElementById('image-grid');
  const allCards = Array.from(grid.querySelectorAll('.image-card'));
  
  if (event.shiftKey && lastClickedIndex !== null) {
    // Range selection
    const start = Math.min(lastClickedIndex, index);
    const end = Math.max(lastClickedIndex, index);
    
    for (let i = start; i <= end; i++) {
      const card = allCards[i];
      if (card) {
        selectedImages.add(card.dataset.filename);
      }
    }
  } else if (event.metaKey || event.ctrlKey) {
    // Individual toggle (Cmd/Ctrl + click)
    if (selectedImages.has(filename)) {
      selectedImages.delete(filename);
    } else {
      selectedImages.add(filename);
    }
  } else {
    // Single selection (clear others)
    selectedImages.clear();
    selectedImages.add(filename);
  }
  
  lastClickedIndex = index;
  // Use lightweight visual update instead of full re-render to prevent scroll flickering
  updateGallerySelectionVisual();
}

function updateBulkActionsBar(totalSelectableCount) {
  const bulkActions = document.getElementById('bulk-actions');
  const selectedCount = document.getElementById('selected-count');
  const selectedCountMobile = document.getElementById('selected-count-mobile');
  const selectAllBtn = document.getElementById('select-all-btn');
  
  // Update Select All button with count (use provided count or fallback to total images)
  const count = totalSelectableCount ?? Object.keys(allImages).length;
  
  if (selectAllBtn) {
    const desktopText = selectAllBtn.querySelector('.desktop-text');
    const mobileText = selectAllBtn.querySelector('.mobile-text');
    if (desktopText) desktopText.textContent = `Select All (${count})`;
    if (mobileText) mobileText.innerHTML = `Select<br>All (${count})`;
  }
  
  if (selectedImages.size > 0) {
    bulkActions.classList.add('visible');
    selectedCount.textContent = selectedImages.size;
    if (selectedCountMobile) {
      selectedCountMobile.textContent = selectedImages.size;
    }
  } else {
    bulkActions.classList.remove('visible');
  }
}

function clearSelection() {
  selectedImages.clear();
  lastClickedIndex = null;
  // Use lightweight visual update instead of full re-render to prevent scroll flickering
  updateGallerySelectionVisual();
}

function selectAllImages() {
  // Get all currently visible/filtered images
  const searchInput = document.getElementById('search-input');
  const searchTerm = (searchInput?.value || '').toLowerCase();
  const includedTags = getIncludedTags();
  const excludedTags = getExcludedTags();

  let filteredImages = Object.entries(allImages);

  // Apply same filters as renderGallery
  if (searchTerm) {
    filteredImages = filteredImages.filter(([filename]) => 
      filename.toLowerCase().includes(searchTerm)
    );
  }

  // Filter by included tags
  if (includedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => 
      data.tags && includedTags.some(tag => data.tags.includes(tag))
    );
  }

  // Filter by excluded tags
  if (excludedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => {
      const imageTags = data.tags || [];
      return !excludedTags.some(tag => imageTags.includes(tag));
    });
  }

  // Filter for "None" - images not shown on any TV
  const noneCheckbox = document.querySelector('.tv-none-checkbox');
  if (noneCheckbox && noneCheckbox.checked) {
    filteredImages = filteredImages.filter(([_, data]) => {
      const imageTagSet = new Set(data.tags || []);
      
      for (const tv of allTVs) {
        const tvIncludeTags = tv.tags || [];
        const tvExcludeTags = tv.exclude_tags || [];
        
        if (tvIncludeTags.length > 0 && !tvIncludeTags.some(tag => imageTagSet.has(tag))) {
          continue;
        }
        
        if (tvExcludeTags.length > 0 && tvExcludeTags.some(tag => imageTagSet.has(tag))) {
          continue;
        }
        
        return false;
      }
      
      return true;
    });
  }

  // Add all filtered images to selection
  filteredImages.forEach(([filename]) => {
    selectedImages.add(filename);
  });

  renderGallery();
}

function openBulkTagModal() {
  console.log('openBulkTagModal called, selectedImages:', selectedImages);
  const modal = document.getElementById('bulk-tag-modal');
  const countSpan = document.getElementById('bulk-count');
  console.log('modal:', modal, 'countSpan:', countSpan);
  countSpan.textContent = selectedImages.size;
  
  // Calculate tag frequencies across selected images
  const tagCounts = {};
  const selectedArray = Array.from(selectedImages);
  
  selectedArray.forEach(filename => {
    const imageData = allImages[filename];
    const tags = imageData.tags || [];
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  // Separate tags into "all" and "some"
  const allTags = [];
  const someTags = [];
  
  Object.entries(tagCounts).forEach(([tag, count]) => {
    if (count === selectedArray.length) {
      allTags.push(tag);
    } else {
      someTags.push(tag);
    }
  });
  
  // Render the tag badges
  renderBulkTagBadges('bulk-all-tags', allTags, false);
  renderBulkTagBadges('bulk-some-tags', someTags, true);
  
  // Render suggested TV tags
  renderBulkTvTagsHelper(allTags);
  
  modal.classList.add('visible');
  console.log('modal classes after add:', modal.className);
}

function renderBulkTagBadges(containerId, tags, isPartial) {
  const container = document.getElementById(containerId);
  
  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = tags.sort().map(tag => {
    // Get TV info for this tag (same as image modal)
    const tvMatches = getTvMatchesForTag(tag);
    let tooltip = '';
    let tvInfoHtml = '';
    
    if (tvMatches.length > 0) {
      const matchStrings = tvMatches
        .sort((a, b) => a.tvName.localeCompare(b.tvName))
        .map(m => m.isExclude ? `${m.tvName} (exclude)` : m.tvName);
      tooltip = matchStrings.join(', ');
      
      const excludeCount = tvMatches.filter(m => m.isExclude).length;
      const allExclude = excludeCount === tvMatches.length;
      const someExclude = excludeCount > 0 && !allExclude;
      
      let tvLabel;
      let colorClass = '';
      
      if (tvMatches.length === 1) {
        tvLabel = tvMatches[0].isExclude ? `ex:${tvMatches[0].tvName}` : tvMatches[0].tvName;
        if (tvMatches[0].isExclude) colorClass = ' tv-info-exclude';
      } else if (allExclude) {
        tvLabel = `${tvMatches.length} TVs`;
        colorClass = ' tv-info-exclude';
      } else if (someExclude) {
        tvInfoHtml = `<span class="tag-tv-info">${tvMatches.length} TVs <span class="tv-info-exclude">(${excludeCount} ex)</span></span>`;
      } else {
        tvLabel = `${tvMatches.length} TVs`;
      }
      
      if (!tvInfoHtml) {
        if (tvLabel.length > 12) {
          tvLabel = tvLabel.substring(0, 11) + '…';
        }
        tvInfoHtml = `<span class="tag-tv-info${colorClass}">${escapeHtml(tvLabel)}</span>`;
      }
    }
    
    const hasMatchClass = tvMatches.length > 0 ? ' has-tv-match' : '';
    
    // Both tag types are fully clickable - clicking removes the tag
    // For "on all" tags: removes from all selected images
    // For "on some" tags: removes from images that have it
    const clickHandler = `onclick="removeBulkTag('${escapeHtml(tag)}', ${isPartial})"`;
    
    return `
    <div class="tag-item${isPartial ? ' partial' : ''}${hasMatchClass} clickable" ${tooltip ? `title="${escapeHtml(tooltip)}"` : ''} ${clickHandler}>
      <div class="tag-content">
        <span class="tag-name">${escapeHtml(tag)}</span>
        ${tvInfoHtml}
      </div>
      <button class="tag-remove" onclick="event.stopPropagation(); removeBulkTag('${escapeHtml(tag)}', ${isPartial})" title="Remove tag">×</button>
    </div>
  `;
  }).join('');
}

// Render suggested TV tags for bulk modal
// Shows TV tags that are NOT already applied to ALL selected images
function renderBulkTvTagsHelper(allAppliedTags) {
  const container = document.getElementById('bulk-tv-tags-helper');
  const wrapper = document.getElementById('bulk-tv-tags-wrapper');
  if (!container) return;
  
  const appliedTagsSet = new Set(allAppliedTags);
  
  // Collect all TV tags - aggregate by tag
  const tvTagsMap = new Map();
  
  for (const tv of allTVs) {
    const tvName = tv.name || 'Unknown TV';
    
    // Include tags
    for (const tag of (tv.tags || [])) {
      // Show tag if not applied to ALL selected images
      if (!appliedTagsSet.has(tag)) {
        if (!tvTagsMap.has(tag)) {
          tvTagsMap.set(tag, { includeTvNames: [], excludeTvNames: [] });
        }
        tvTagsMap.get(tag).includeTvNames.push(tvName);
      }
    }
    
    // Exclude tags
    for (const tag of (tv.exclude_tags || [])) {
      if (!appliedTagsSet.has(tag)) {
        if (!tvTagsMap.has(tag)) {
          tvTagsMap.set(tag, { includeTvNames: [], excludeTvNames: [] });
        }
        tvTagsMap.get(tag).excludeTvNames.push(tvName);
      }
    }
  }
  
  // Convert to array and sort
  const availableTags = [];
  for (const [tag, data] of tvTagsMap) {
    const totalTvs = data.includeTvNames.length + data.excludeTvNames.length;
    const allExclude = data.includeTvNames.length === 0;
    availableTags.push({
      tag,
      includeTvNames: data.includeTvNames,
      excludeTvNames: data.excludeTvNames,
      totalTvs,
      allExclude
    });
  }
  
  availableTags.sort((a, b) => {
    if (a.allExclude !== b.allExclude) return a.allExclude ? 1 : -1;
    return a.tag.localeCompare(b.tag);
  });
  
  if (availableTags.length === 0) {
    container.innerHTML = '';
    if (wrapper) wrapper.style.display = 'none';
    return;
  }
  
  if (wrapper) wrapper.style.display = 'block';
  
  const pillsHtml = availableTags.map(item => {
    const excludeClass = item.allExclude ? ' exclude' : '';
    const excludeCount = item.excludeTvNames.length;
    const hasExcludes = excludeCount > 0;
    
    const tooltipParts = [];
    if (item.includeTvNames.length > 0) {
      tooltipParts.push(item.includeTvNames.join(', '));
    }
    if (item.excludeTvNames.length > 0) {
      tooltipParts.push(item.excludeTvNames.map(n => `${n} (exclude)`).join(', '));
    }
    const tooltip = tooltipParts.join(', ');
    
    let tvLabelHtml;
    if (item.totalTvs === 1) {
      const tvName = item.includeTvNames[0] || item.excludeTvNames[0];
      const prefix = item.allExclude ? 'ex:' : '';
      tvLabelHtml = `<span class="tv-name">${escapeHtml(prefix + tvName)}</span>`;
    } else if (item.allExclude) {
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs</span>`;
    } else if (hasExcludes) {
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs <span class="tv-info-exclude">(${excludeCount} ex)</span></span>`;
    } else {
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs</span>`;
    }
    
    return `<button class="tv-tag-pill${excludeClass}" data-tag="${escapeHtml(item.tag)}" title="${escapeHtml(tooltip)}" tabindex="-1">
      <span class="tag-label">${escapeHtml(item.tag)}</span>
      ${tvLabelHtml}
    </button>`;
  }).join('');
  
  container.innerHTML = pillsHtml;
  
  // Add click handlers for bulk suggested tags
  container.querySelectorAll('.tv-tag-pill').forEach(pill => {
    pill.addEventListener('click', async (e) => {
      pill.blur();
      e.target.blur();
      if (document.activeElement) document.activeElement.blur();
      
      const tag = pill.dataset.tag;
      await addBulkTagFromHelper(tag);
    });
  });
}

// Add a tag to all selected images from bulk helper (uses batch API)
async function addBulkTagFromHelper(tagName) {
  const selectedArray = Array.from(selectedImages);
  
  try {
    const response = await fetch(`${API_BASE}/images/batch/add-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: selectedArray, tag: tagName })
    });
    
    const result = await response.json();
    if (result.success) {
      // Update local cache - add tag to each image
      for (const filename of selectedArray) {
        if (allImages[filename]) {
          if (!allImages[filename].tags) {
            allImages[filename].tags = [];
          }
          if (!allImages[filename].tags.includes(tagName)) {
            allImages[filename].tags.push(tagName);
          }
        }
      }
      console.log(`Batch add tag: ${result.message}`);
    } else {
      console.error('Batch add tag failed:', result.error);
    }
  } catch (error) {
    console.error('Error in batch add tag:', error);
  }
  
  // Refresh the bulk modal to show updated state
  refreshBulkTagModal();
  
  // Update sync status since metadata changed
  await updateSyncStatus();
}

// Refresh the bulk tag modal with current state
function refreshBulkTagModal() {
  const selectedArray = Array.from(selectedImages);
  const countSpan = document.getElementById('bulk-count');
  if (countSpan) countSpan.textContent = selectedImages.size;
  
  const tagCounts = {};
  selectedArray.forEach(filename => {
    const imageData = allImages[filename];
    const tags = imageData.tags || [];
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  const allTags = [];
  const someTags = [];
  
  Object.entries(tagCounts).forEach(([tag, count]) => {
    if (count === selectedArray.length) {
      allTags.push(tag);
    } else {
      someTags.push(tag);
    }
  });
  
  renderBulkTagBadges('bulk-all-tags', allTags, false);
  renderBulkTagBadges('bulk-some-tags', someTags, true);
  renderBulkTvTagsHelper(allTags);
}

async function removeBulkTag(tagName, isPartial) {
  const selectedArray = Array.from(selectedImages);
  
  try {
    const response = await fetch(`${API_BASE}/images/batch/remove-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: selectedArray, tag: tagName })
    });
    
    const result = await response.json();
    if (result.success) {
      // Update local cache - remove tag from each image
      for (const filename of selectedArray) {
        if (allImages[filename] && allImages[filename].tags) {
          allImages[filename].tags = allImages[filename].tags.filter(t => t !== tagName);
        }
      }
      console.log(`Batch remove tag: ${result.message}`);
    } else {
      console.error('Batch remove tag failed:', result.error);
    }
  } catch (error) {
    console.error('Error in batch remove tag:', error);
  }
  
  // Refresh the modal to show updated tags
  const countSpan = document.getElementById('bulk-count');
  countSpan.textContent = selectedImages.size;
  
  // Recalculate tag frequencies
  const tagCounts = {};
  selectedArray.forEach(filename => {
    const imageData = allImages[filename];
    const tags = imageData.tags || [];
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  const allTags = [];
  const someTags = [];
  
  Object.entries(tagCounts).forEach(([tag, count]) => {
    if (count === selectedArray.length) {
      allTags.push(tag);
    } else {
      someTags.push(tag);
    }
  });
  
  renderBulkTagBadges('bulk-all-tags', allTags, false);
  renderBulkTagBadges('bulk-some-tags', someTags, true);
  renderBulkTvTagsHelper(allTags);
  
  // Update sync status since metadata changed
  await updateSyncStatus();
}

async function makeTagAll(tagName) {
  const selectedArray = Array.from(selectedImages);
  
  try {
    const response = await fetch(`${API_BASE}/images/batch/add-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: selectedArray, tag: tagName })
    });
    
    const result = await response.json();
    if (result.success) {
      // Update local cache - add tag to each image
      for (const filename of selectedArray) {
        if (allImages[filename]) {
          if (!allImages[filename].tags) {
            allImages[filename].tags = [];
          }
          if (!allImages[filename].tags.includes(tagName)) {
            allImages[filename].tags.push(tagName);
          }
        }
      }
      console.log(`Batch add tag (makeTagAll): ${result.message}`);
    } else {
      console.error('Batch add tag failed:', result.error);
    }
  } catch (error) {
    console.error('Error in batch add tag:', error);
  }
  
  // Refresh the modal to show updated tags
  const countSpan = document.getElementById('bulk-count');
  countSpan.textContent = selectedImages.size;
  
  // Recalculate tag frequencies
  const tagCounts = {};
  selectedArray.forEach(filename => {
    const imageData = allImages[filename];
    const tags = imageData.tags || [];
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  const allTags = [];
  const someTags = [];
  
  Object.entries(tagCounts).forEach(([tag, count]) => {
    if (count === selectedArray.length) {
      allTags.push(tag);
    } else {
      someTags.push(tag);
    }
  });
  
  renderBulkTagBadges('bulk-all-tags', allTags, false);
  renderBulkTagBadges('bulk-some-tags', someTags, true);
  renderBulkTvTagsHelper(allTags);
  
  // Update sync status since metadata changed
  await updateSyncStatus();
}

function closeBulkTagModal() {
  const modal = document.getElementById('bulk-tag-modal');
  modal.classList.remove('visible');
  document.getElementById('bulk-tags-input').value = '';
  
  // Update tag displays on visible image cards to reflect changes
  updateGalleryCardTags();
  
  // Deselect all images
  selectedImages.clear();
  lastClickedIndex = null;
  updateGallerySelectionVisual();
}

/**
 * Update the tag badges on all visible gallery cards to reflect current state.
 * Called after bulk tag operations to show updated tags without full re-render.
 */
function updateGalleryCardTags() {
  const grid = document.getElementById('image-grid');
  if (!grid) return;
  
  const cards = grid.querySelectorAll('.image-card');
  cards.forEach(card => {
    const filename = card.dataset.filename;
    const imageData = allImages[filename];
    if (!imageData) return;
    
    const tagsContainer = card.querySelector('.image-tags');
    if (tagsContainer) {
      const tags = imageData.tags || [];
      tagsContainer.innerHTML = tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
    }
  });
}

async function saveBulkTags() {
  const tagsInput = document.getElementById('bulk-tags-input').value;
  const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
  
  if (tags.length === 0) {
    alert('Please enter at least one tag');
    return;
  }
  
  const selectedArray = Array.from(selectedImages);
  let totalSuccess = 0;
  let hasError = false;
  
  // Use batch API for each tag
  for (const tag of tags) {
    try {
      const response = await fetch(`${API_BASE}/images/batch/add-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: selectedArray, tag })
      });
      
      const result = await response.json();
      if (result.success) {
        totalSuccess += result.results.success;
        // Update local cache - add tag to each image
        for (const filename of selectedArray) {
          if (allImages[filename]) {
            if (!allImages[filename].tags) {
              allImages[filename].tags = [];
            }
            if (!allImages[filename].tags.includes(tag)) {
              allImages[filename].tags.push(tag);
            }
          }
        }
        console.log(`Batch add tag "${tag}": ${result.message}`);
      } else {
        hasError = true;
        console.error(`Batch add tag "${tag}" failed:`, result.error);
      }
    } catch (error) {
      hasError = true;
      console.error(`Error adding tag "${tag}":`, error);
    }
  }
  
  // Clear the input
  document.getElementById('bulk-tags-input').value = '';
  
  // Recalculate and re-render the tag badges
  const countSpan = document.getElementById('bulk-count');
  countSpan.textContent = selectedImages.size;
  
  const tagCounts = {};
  selectedArray.forEach(filename => {
    const imageData = allImages[filename];
    const imgTags = imageData.tags || [];
    imgTags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  const allTags = [];
  const someTags = [];
  
  Object.entries(tagCounts).forEach(([tag, count]) => {
    if (count === selectedArray.length) {
      allTags.push(tag);
    } else {
      someTags.push(tag);
    }
  });
  
  renderBulkTagBadges('bulk-all-tags', allTags, false);
  renderBulkTagBadges('bulk-some-tags', someTags, true);
  renderBulkTvTagsHelper(allTags);
  
  // Show result if there were errors
  if (hasError) {
    alert(`Some tags may not have been added. Check console for details.`);
  }
  
  // Update sync status since metadata changed
  await updateSyncStatus();
}

// Get TV tags that aren't already applied to the current image
// Returns aggregated data: each tag appears once with lists of include/exclude TVs
function getAvailableTvTags() {
  if (!currentImage || !allTVs || allTVs.length === 0) return [];
  
  const imageData = allImages[currentImage];
  const appliedTags = new Set(imageData?.tags || []);
  
  return getTvTagsExcluding(appliedTags);
}

// Get all TV tags regardless of current image (for upload form)
function getAllTvTags() {
  if (!allTVs || allTVs.length === 0) return [];
  return getTvTagsExcluding(new Set());
}

// Helper: Get TV tags excluding specified tags
function getTvTagsExcluding(excludeSet) {
  // Collect all TV tags with metadata - aggregate by tag
  // tag -> { includeTvNames: [], excludeTvNames: [] }
  const tvTagsMap = new Map();
  
  for (const tv of allTVs) {
    const tvName = tv.name || 'Unknown TV';
    
    // Include tags
    for (const tag of (tv.tags || [])) {
      if (!excludeSet.has(tag)) {
        if (!tvTagsMap.has(tag)) {
          tvTagsMap.set(tag, { includeTvNames: [], excludeTvNames: [] });
        }
        tvTagsMap.get(tag).includeTvNames.push(tvName);
      }
    }
    
    // Exclude tags
    for (const tag of (tv.exclude_tags || [])) {
      if (!excludeSet.has(tag)) {
        if (!tvTagsMap.has(tag)) {
          tvTagsMap.set(tag, { includeTvNames: [], excludeTvNames: [] });
        }
        tvTagsMap.get(tag).excludeTvNames.push(tvName);
      }
    }
  }
  
  // Convert to array and sort
  const result = [];
  for (const [tag, data] of tvTagsMap) {
    const totalTvs = data.includeTvNames.length + data.excludeTvNames.length;
    const allExclude = data.includeTvNames.length === 0;
    result.push({
      tag,
      includeTvNames: data.includeTvNames,
      excludeTvNames: data.excludeTvNames,
      totalTvs,
      allExclude
    });
  }
  
  result.sort((a, b) => {
    // Tags with includes first, then exclude-only tags
    if (a.allExclude !== b.allExclude) return a.allExclude ? 1 : -1;
    // Then alphabetically
    return a.tag.localeCompare(b.tag);
  });
  
  return result;
}

// Render the TV tags helper row
function renderTvTagsHelper() {
  const container = document.getElementById('tv-tags-helper');
  const wrapper = document.getElementById('tv-tags-wrapper');
  if (!container) return;
  
  const availableTags = getAvailableTvTags();
  
  if (availableTags.length === 0) {
    container.innerHTML = '';
    if (wrapper) wrapper.style.display = 'none';
    return;
  }
  
  if (wrapper) wrapper.style.display = 'block';
  
  const pillsHtml = availableTags.map(item => {
    const excludeClass = item.allExclude ? ' exclude' : '';
    const excludeCount = item.excludeTvNames.length;
    const hasExcludes = excludeCount > 0;
    
    // Build tooltip showing all TV names
    const tooltipParts = [];
    if (item.includeTvNames.length > 0) {
      tooltipParts.push(item.includeTvNames.join(', '));
    }
    if (item.excludeTvNames.length > 0) {
      tooltipParts.push(item.excludeTvNames.map(n => `${n} (exclude)`).join(', '));
    }
    const tooltip = tooltipParts.join(', ');
    
    // Build TV label - similar to applied tags format
    let tvLabelHtml;
    if (item.totalTvs === 1) {
      // Single TV
      const tvName = item.includeTvNames[0] || item.excludeTvNames[0];
      const prefix = item.allExclude ? 'ex:' : '';
      tvLabelHtml = `<span class="tv-name">${escapeHtml(prefix + tvName)}</span>`;
    } else if (item.allExclude) {
      // All exclude
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs</span>`;
    } else if (hasExcludes) {
      // Mixed: some include, some exclude - show "X TVs (Y ex)" with Y ex in red
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs <span class="tv-info-exclude">(${excludeCount} ex)</span></span>`;
    } else {
      // All include
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs</span>`;
    }
    
    return `<button class="tv-tag-pill${excludeClass}" data-tag="${escapeHtml(item.tag)}" title="${escapeHtml(tooltip)}" tabindex="-1">
      <span class="tag-label">${escapeHtml(item.tag)}</span>
      ${tvLabelHtml}
    </button>`;
  }).join('');
  
  container.innerHTML = pillsHtml;
  
  // Add click handlers
  container.querySelectorAll('.tv-tag-pill').forEach(pill => {
    pill.addEventListener('click', async (e) => {
      // Immediately blur the clicked button to prevent focus transfer on mobile
      pill.blur();
      e.target.blur();
      if (document.activeElement) document.activeElement.blur();
      
      const tag = pill.dataset.tag;
      await addTagFromHelper(tag);
    });
  });
}

// Add a single tag from the helper and re-render
async function addTagFromHelper(tagName) {
  if (!currentImage) return;
  
  try {
    const imageData = allImages[currentImage];
    const existingTags = imageData.tags || [];
    const newTags = [...new Set([...existingTags, tagName])];
    
    const response = await fetch(`${API_BASE}/images/${currentImage}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags })
    });
    
    const result = await response.json();
    if (result.success && result.data) {
      allImages[currentImage] = result.data;
      renderImageTagBadges(result.data.tags || []);
      renderTvTagsHelper(); // Re-render to remove the added tag
      loadTags();
      await updateSyncStatus();
    }
  } catch (error) {
    console.error('Error adding tag from helper:', error);
  }
}

// Get TV matches for a specific tag (for tooltips)
function getTvMatchesForTag(tag) {
  if (!allTVs || allTVs.length === 0) return [];
  
  const matches = [];
  
  for (const tv of allTVs) {
    const tvName = tv.name || 'Unknown TV';
    const includeTags = tv.tags || [];
    const excludeTags = tv.exclude_tags || [];
    
    if (includeTags.includes(tag)) {
      matches.push({ tvName, isExclude: false });
    }
    if (excludeTags.includes(tag)) {
      matches.push({ tvName, isExclude: true });
    }
  }
  
  return matches;
}

// Image modal tag management functions
function renderImageTagBadges(tags) {
  const container = document.getElementById('modal-tags-badges');
  
  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = tags.sort().map(tag => {
    const tvMatches = getTvMatchesForTag(tag);
    let tooltip = '';
    let tvInfoHtml = '';
    
    if (tvMatches.length > 0) {
      const matchStrings = tvMatches
        .sort((a, b) => a.tvName.localeCompare(b.tvName))
        .map(m => m.isExclude ? `${m.tvName} (exclude)` : m.tvName);
      tooltip = matchStrings.join(', ');
      
      // Build compact TV info display
      const excludeCount = tvMatches.filter(m => m.isExclude).length;
      const allExclude = excludeCount === tvMatches.length;
      const someExclude = excludeCount > 0 && !allExclude;
      
      let tvLabel;
      let colorClass = '';
      
      if (tvMatches.length === 1) {
        tvLabel = tvMatches[0].isExclude ? `ex:${tvMatches[0].tvName}` : tvMatches[0].tvName;
        if (tvMatches[0].isExclude) colorClass = ' tv-info-exclude';
      } else if (allExclude) {
        tvLabel = `${tvMatches.length} TVs`;
        colorClass = ' tv-info-exclude';
      } else if (someExclude) {
        // Show "X TVs (Y ex)" with Y ex in red
        tvInfoHtml = `<span class="tag-tv-info">${tvMatches.length} TVs <span class="tv-info-exclude">(${excludeCount} ex)</span></span>`;
      } else {
        tvLabel = `${tvMatches.length} TVs`;
      }
      
      // Only build tvInfoHtml if not already set (for partial exclude case)
      if (!tvInfoHtml) {
        // Truncate to keep tags uniform width
        if (tvLabel.length > 12) {
          tvLabel = tvLabel.substring(0, 11) + '…';
        }
        tvInfoHtml = `<span class="tag-tv-info${colorClass}">${escapeHtml(tvLabel)}</span>`;
      }
    }
    
    const hasMatchClass = tvMatches.length > 0 ? ' has-tv-match' : '';
    
    return `
    <div class="tag-item${hasMatchClass}" ${tooltip ? `title="${escapeHtml(tooltip)}"` : ''} onclick="removeImageTag('${escapeHtml(tag)}')">
      <div class="tag-content">
        <span class="tag-name">${escapeHtml(tag)}</span>
        ${tvInfoHtml}
      </div>
      <span class="tag-remove">×</span>
    </div>
  `;
  }).join('');
  
  // Update the TV shuffle indicator
  updateTvShuffleIndicator(tags);
}

/**
 * Calculate and display which TVs will shuffle this image based on its applied tags.
 * 
 * This logic mirrors the shuffle eligibility check in frame-art-shuffler's shuffle.py:
 * - If a TV has include_tags set, the image must have at least ONE of those tags
 * - If a TV has exclude_tags set, the image must NOT have ANY of those tags
 * - If a TV has no include_tags and no exclude_tags, the image is always eligible
 * 
 * NOTE: If frame-art-shuffler's shuffle implementation changes, this logic may need updating.
 */
function updateTvShuffleIndicator(imageTags) {
  const indicator = document.getElementById('tv-shuffle-indicator');
  if (!indicator) return;
  
  if (!allTVs || allTVs.length === 0) {
    indicator.textContent = '';
    indicator.title = '';
    return;
  }
  
  const imageTagSet = new Set(imageTags || []);
  const eligibleTvNames = [];
  
  for (const tv of allTVs) {
    const tvName = tv.name || 'Unknown TV';
    const includeTags = tv.tags || [];
    const excludeTags = tv.exclude_tags || [];
    
    // Check include tags: if set, image must have at least one
    if (includeTags.length > 0 && !includeTags.some(tag => imageTagSet.has(tag))) {
      continue;
    }
    
    // Check exclude tags: if set, image must not have any
    if (excludeTags.length > 0 && excludeTags.some(tag => imageTagSet.has(tag))) {
      continue;
    }
    
    // Image is eligible for this TV
    eligibleTvNames.push(tvName);
  }
  
  if (eligibleTvNames.length === 0) {
    indicator.innerHTML = 'Will shuffle on: <span style="white-space:nowrap">none</span>';
    indicator.title = 'No TVs will shuffle this image with current tags';
  } else if (eligibleTvNames.length === 1) {
    // Single TV - keep on same line
    indicator.innerHTML = `Will shuffle on: <span style="white-space:nowrap">${escapeHtml(eligibleTvNames[0])}</span>`;
    indicator.title = eligibleTvNames[0];
  } else {
    // Multiple TVs (including all TVs) - use mobile-br class that only breaks on mobile
    const wrappedNames = eligibleTvNames.slice(0, 3).map(name => 
      `<span style="white-space:nowrap">${escapeHtml(name)}</span>`
    ).join(', ');
    const suffix = eligibleTvNames.length > 3 ? `, +${eligibleTvNames.length - 3} more` : '';
    indicator.innerHTML = `Will shuffle on:<span class="mobile-br"></span> ${wrappedNames}${suffix}`;
    indicator.title = eligibleTvNames.join(', ');
  }
}

async function removeImageTag(tagName) {
  if (!currentImage) return;
  
  try {
    const imageData = allImages[currentImage];
    const existingTags = imageData.tags || [];
    const newTags = existingTags.filter(t => t !== tagName);
    
    const response = await fetch(`${API_BASE}/images/${currentImage}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags })
    });
    
    const result = await response.json();
    if (result.success) {
      // Update local cache
      allImages[currentImage].tags = newTags;
      
      // Re-render badges and TV tags helper
      renderImageTagBadges(newTags);
      renderTvTagsHelper();
      
      // Update sync status since metadata changed
      await updateSyncStatus();
    } else {
      alert('Failed to remove tag');
    }
  } catch (error) {
    console.error('Error removing tag:', error);
    alert('Error removing tag');
  }
}

async function addImageTags() {
  if (!currentImage) return;
  
  const tagsInput = document.getElementById('modal-tags-input').value;
  const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
  
  if (tags.length === 0) {
    alert('Please enter at least one tag');
    return;
  }
  
  console.log(`\n🏷️  [TAG CHANGE] Adding tags to ${currentImage}:`, tags);
  
  try {
    const imageData = allImages[currentImage];
    const existingTags = imageData.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])]; // Merge and dedupe
    
    const response = await fetch(`${API_BASE}/images/${currentImage}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags })
    });
    
    const result = await response.json();
    if (result.success && result.data) {
      console.log(`✅ [TAG CHANGE] Tags updated successfully for ${currentImage}`);
      
      // Update local cache with full response (includes updated timestamp)
      allImages[currentImage] = result.data;
      
      // Clear input and re-render badges
      document.getElementById('modal-tags-input').value = '';
      renderImageTagBadges(result.data.tags || []);
      
      // Reload tags list in background (but not gallery - causes jitter)
      // Gallery will be reloaded when modal closes if there are changes
      loadTags();
      
      // Update sync status since metadata changed
      console.log(`📊 [TAG CHANGE] Updating sync status...`);
      await updateSyncStatus();
      console.log(`📊 [TAG CHANGE] Sync status updated\n`);
    } else {
      alert('Failed to add tags');
    }
  } catch (error) {
    console.error('💥 [TAG CHANGE] Error adding tags:', error);
    alert('Error adding tags');
  }
}

// Get last display info for an image from analytics data
function getLastDisplayInfo(filename) {
  const imageData = analyticsData?.images?.[filename];
  if (!imageData?.display_periods) return null;
  
  let lastEnd = 0;
  let lastTvId = null;
  
  for (const [tvId, periods] of Object.entries(imageData.display_periods)) {
    for (const period of periods) {
      if (period.end > lastEnd) {
        lastEnd = period.end;
        lastTvId = tvId;
      }
    }
  }
  
  if (!lastEnd || !lastTvId) return null;
  
  // Format time ago - use largest meaningful unit, rounded to nearest
  const now = Date.now();
  const diffMs = now - lastEnd;
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const diffMonths = Math.round(diffDays / 30);
  
  let timeAgo;
  if (diffMonths >= 1) {
    timeAgo = `${diffMonths}mo ago`;
  } else if (diffDays >= 1) {
    timeAgo = `${diffDays}d ago`;
  } else if (diffHours >= 1) {
    timeAgo = `${diffHours}h ago`;
  } else {
    timeAgo = `${diffMinutes}m ago`;
  }
  
  // Get TV name
  const tvName = analyticsData?.tvs?.[lastTvId]?.name || 'Unknown TV';
  
  return { timeAgo, tvName };
}

/**
 * Update the similar threshold slider bar visibility and state
 */
function updateSimilarThresholdBar() {
  let bar = document.getElementById('similar-threshold-bar');
  
  if (!similarFilterActive) {
    if (bar) bar.style.display = 'none';
    return;
  }
  
  // Create bar if it doesn't exist
  if (!bar) {
    const grid = document.getElementById('image-grid');
    if (!grid) return;
    
    bar = document.createElement('div');
    bar.id = 'similar-threshold-bar';
    bar.className = 'similar-threshold-bar';
    bar.innerHTML = `
      <label for="similar-threshold-slider">Threshold:</label>
      <div class="slider-wrapper">
        <div class="slider-container">
          <span class="slider-scale-label left">10</span>
          <input type="range" id="similar-threshold-slider" min="10" max="60" value="${similarThreshold}">
          <span class="slider-scale-label right">60</span>
          <div class="slider-ticks" id="slider-ticks"></div>
          <div class="slider-preset-ticks">
            <span class="preset-tick" style="left: 0%"></span>
            <span class="preset-tick" style="left: 56%"></span>
          </div>
          <div class="slider-labels">
            <span class="slider-preset-label clickable" data-threshold="10" style="left: 0%">Duplicate</span>
            <span class="slider-preset-label clickable" data-threshold="38" style="left: 56%">Similar</span>
          </div>
        </div>
      </div>
      <span id="similar-threshold-value">${similarThreshold}</span>
    `;
    grid.parentNode.insertBefore(bar, grid);
    
    // Add change listener for slider
    const slider = bar.querySelector('#similar-threshold-slider');
    const valueDisplay = bar.querySelector('#similar-threshold-value');
    
    slider.addEventListener('input', (e) => {
      valueDisplay.textContent = e.target.value;
    });
    
    slider.addEventListener('change', async (e) => {
      similarThreshold = parseInt(e.target.value, 10);
      await fetchSimilarGroups(similarThreshold);
      await loadTagsForFilter(); // Update count in dropdown
      renderGallery();
    });
    
    // Add click listeners for preset labels
    bar.querySelectorAll('.slider-preset-label.clickable').forEach(label => {
      label.addEventListener('click', async (e) => {
        const threshold = parseInt(e.target.dataset.threshold, 10);
        similarThreshold = threshold;
        slider.value = threshold;
        valueDisplay.textContent = threshold;
        await fetchSimilarGroups(similarThreshold);
        await loadTagsForFilter();
        renderGallery();
      });
    });
  }
  
  bar.style.display = 'flex';
  
  // Update slider value in case threshold changed elsewhere
  const slider = bar.querySelector('#similar-threshold-slider');
  const valueDisplay = bar.querySelector('#similar-threshold-value');
  if (slider && slider.value != similarThreshold) {
    slider.value = similarThreshold;
    valueDisplay.textContent = similarThreshold;
  }
  
  // Update ticks based on breakpoints
  updateSliderTicks();
}

/**
 * Update the slider ticks to show where images are added
 */
function updateSliderTicks() {
  const ticksContainer = document.getElementById('slider-ticks');
  if (!ticksContainer) return;
  
  // Clear existing ticks
  ticksContainer.innerHTML = '';
  
  // Create ticks for each breakpoint within the slider range
  const sliderMin = 10;
  const sliderMax = 60;
  const sliderRange = sliderMax - sliderMin;
  
  for (const bp of similarBreakpoints) {
    if (bp.threshold >= sliderMin && bp.threshold <= sliderMax) {
      const tick = document.createElement('div');
      tick.className = 'slider-tick';
      const position = ((bp.threshold - sliderMin) / sliderRange) * 100;
      tick.style.left = `${position}%`;
      tick.title = `${bp.threshold}: +${bp.addedImages} image${bp.addedImages > 1 ? 's' : ''} (${bp.totalImages} total)`;
      
      // Add count label below tick
      const countLabel = document.createElement('span');
      countLabel.className = 'tick-count';
      countLabel.textContent = `+${bp.addedImages}`;
      tick.appendChild(countLabel);
      
      ticksContainer.appendChild(tick);
    }
  }
}

function renderGallery(filter = '') {
  const grid = document.getElementById('image-grid');
  if (!grid) {
    console.warn('Gallery render skipped: image grid element not found.');
    return;
  }
  
  // Update similar threshold bar visibility
  updateSimilarThresholdBar();

  const searchInput = document.getElementById('search-input');
  const searchTerm = (searchInput?.value || '').toLowerCase();
  const sortOrderSelect = document.getElementById('sort-order');
  const sortOrder = sortOrderSelect ? sortOrderSelect.value : initialSortOrderPreference;

  // Determine include/exclude tags - check if any TV shortcuts are selected first
  const checkedTvCheckboxes = document.querySelectorAll('.tv-checkbox:checked');
  let includedTags = [];
  let excludedTags = [];
  
  if (checkedTvCheckboxes.length > 0) {
    // TV shortcuts are checked - get tags directly from TV configs (union of all checked TVs)
    const includedSet = new Set();
    const excludedSet = new Set();
    
    checkedTvCheckboxes.forEach(checkbox => {
      const tvId = checkbox.value;
      const tv = allTVs.find(t => (t.device_id || t.entity_id) === tvId);
      if (tv) {
        (tv.tags || []).forEach(tag => includedSet.add(tag));
        (tv.exclude_tags || []).forEach(tag => excludedSet.add(tag));
      }
    });
    
    includedTags = Array.from(includedSet);
    excludedTags = Array.from(excludedSet);
  } else {
    // No TV shortcuts - use tag checkbox states
    includedTags = getIncludedTags();
    excludedTags = getExcludedTags();
  }

  let filteredImages = Object.entries(allImages);

  // Filter by search term
  if (searchTerm) {
    filteredImages = filteredImages.filter(([filename]) => 
      filename.toLowerCase().includes(searchTerm)
    );
  }

  // Filter by included tags (image must have ANY of the included tags)
  if (includedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => 
      data.tags && includedTags.some(tag => data.tags.includes(tag))
    );
  }

  // Filter by excluded tags (image must NOT have ANY of the excluded tags)
  if (excludedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => {
      const imageTags = data.tags || [];
      return !excludedTags.some(tag => imageTags.includes(tag));
    });
  }

  // Filter for "None" - images not shown on any TV
  const noneCheckbox = document.querySelector('.tv-none-checkbox');
  if (noneCheckbox && noneCheckbox.checked) {
    filteredImages = filteredImages.filter(([_, data]) => {
      const imageTagSet = new Set(data.tags || []);
      
      // Check if this image is eligible for ANY TV
      for (const tv of allTVs) {
        const includeTags = tv.tags || [];
        const excludeTags = tv.exclude_tags || [];
        
        // Check include tags: if set, image must have at least one
        if (includeTags.length > 0 && !includeTags.some(tag => imageTagSet.has(tag))) {
          continue;
        }
        
        // Check exclude tags: if set, image must not have any
        if (excludeTags.length > 0 && excludeTags.some(tag => imageTagSet.has(tag))) {
          continue;
        }
        
        // Image is eligible for this TV, so it's NOT a "None" image
        return false;
      }
      
      // Image is not eligible for any TV
      return true;
    });
  }

  // Filter for "Recently Displayed" - current and previous images on each TV
  if (recentlyDisplayedFilterActive) {
    const recentFilenames = getRecentlyDisplayedFilenames();
    filteredImages = filteredImages.filter(([filename]) => recentFilenames.has(filename));
  }

  // Filter for "Similar Images" - images that may be visually related
  if (similarFilterActive) {
    const similarFilenames = getSimilarFilenames();
    filteredImages = filteredImages.filter(([filename]) => similarFilenames.has(filename));
  }

  // Filter for "Portrait" - images where height > width
  if (portraitFilterActive) {
    filteredImages = filteredImages.filter(([filename, data]) => isPortrait(data.aspectRatio));
  }

  // Filter for "Landscape (Non 16:9)" - landscape images that are not 16:9 aspect ratio
  if (non169FilterActive) {
    filteredImages = filteredImages.filter(([filename, data]) => !isPortrait(data.aspectRatio) && !isAspectRatio16x9(data.aspectRatio));
  }

  // ============================================
  // Sort images
  // ============================================
  // There are 3 sort modes:
  //   1. "name" - alphabetical by filename (visible in dropdown)
  //   2. "date" - by upload date (visible in dropdown)
  //   3. "duplicates"/"similar" - IMPLICIT, auto-activated when special filters are on
  //
  // The "duplicates"/"similar" sort mode groups related images together,
  // then sorts groups by the newest image date in each group.
  // Within each group, images are sorted by their individual upload date.
  // This mode does NOT appear in the sort dropdown - it's automatically
  // engaged when entering duplicate/similar filter mode, and the previous sort
  // state is restored when exiting.
  // ============================================
  
  // Determine if a special grouping filter is active and which groups to use
  const specialFilterActive = similarFilterActive;
  const activeGroups = similarFilterActive ? similarGroups : [];
  
  if (specialFilterActive && activeGroups.length > 0) {
    // IMPLICIT grouping sort mode - groups related images together
    // For similar filter: groups ordered by minimum hamming distance (most similar first)
    // For duplicate filter: groups ordered by newest image's date
    // Images within each group are sorted by their individual upload date
    
    // Build a map of filename -> group index and calculate sort key per group
    const filenameToGroupIndex = new Map();
    const groupSortKeys = [];
    
    activeGroups.forEach((group, groupIndex) => {
      let maxDate = 0;
      let minDistance = Infinity;
      
      group.forEach(filename => {
        filenameToGroupIndex.set(filename, groupIndex);
        const imgData = allImages[filename];
        if (imgData && imgData.added) {
          const date = new Date(imgData.added).getTime();
          if (date > maxDate) maxDate = date;
        }
      });
      
      // For similar filter, find minimum pairwise distance in this group
      if (similarFilterActive && similarDistances) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const f1 = group[i];
            const f2 = group[j];
            const key = f1 < f2 ? `${f1}|${f2}` : `${f2}|${f1}`;
            const dist = similarDistances[key];
            if (dist !== undefined && dist < minDistance) {
              minDistance = dist;
            }
          }
        }
      }
      
      groupSortKeys[groupIndex] = {
        maxDate,
        minDistance: minDistance === Infinity ? 0 : minDistance
      };
    });
    
    filteredImages.sort((a, b) => {
      const [filenameA, dataA] = a;
      const [filenameB, dataB] = b;
      
      const groupA = filenameToGroupIndex.get(filenameA) ?? -1;
      const groupB = filenameToGroupIndex.get(filenameB) ?? -1;
      
      // Different groups: sort by group's sort key
      if (groupA !== groupB) {
        if (similarFilterActive) {
          // Sort by minimum distance (smaller = more similar = first)
          const distA = groupSortKeys[groupA]?.minDistance ?? Infinity;
          const distB = groupSortKeys[groupB]?.minDistance ?? Infinity;
          if (distA !== distB) {
            return distA - distB;
          }
          // Tiebreaker: use group index to keep groups together
          return groupA - groupB;
        } else {
          // Duplicate mode: sort by max date
          const maxDateA = groupSortKeys[groupA]?.maxDate || 0;
          const maxDateB = groupSortKeys[groupB]?.maxDate || 0;
          const comparison = maxDateA - maxDateB;
          if (comparison !== 0) {
            return sortAscending ? comparison : -comparison;
          }
          // Tiebreaker: use group index to keep groups together
          return groupA - groupB;
        }
      }
      
      // Same group: sort by individual image upload date
      const dateA = new Date(dataA.added || 0).getTime();
      const dateB = new Date(dataB.added || 0).getTime();
      const comparison = dateA - dateB;
      return sortAscending ? comparison : -comparison;
    });
  } else if (recentlyDisplayedFilterActive) {
    // Sort by most recent display time (Now first, then by timestamp)
    filteredImages.sort((a, b) => {
      const [filenameA] = a;
      const [filenameB] = b;
      
      const entriesA = recentlyDisplayedData[filenameA] || [];
      const entriesB = recentlyDisplayedData[filenameB] || [];
      
      // Get most recent timestamp for each image
      const getMostRecentTimestamp = (entries) => {
        if (entries.length === 0) return 0;
        // 'now' entries get current timestamp (highest priority)
        const hasNow = entries.some(e => e.time === 'now');
        if (hasNow) return Date.now();
        // Otherwise use highest timestamp
        return Math.max(...entries.map(e => e.timestamp || 0));
      };
      
      const timestampA = getMostRecentTimestamp(entriesA);
      const timestampB = getMostRecentTimestamp(entriesB);
      
      // Sort descending (most recent first)
      return timestampB - timestampA;
    });
  } else {
    // Standard sort modes: "name" or "date" (from dropdown)
    filteredImages.sort((a, b) => {
      const [filenameA, dataA] = a;
      const [filenameB, dataB] = b;
      
      let comparison = 0;
      if (sortOrder === 'date') {
        // Sort by date added
        const dateA = new Date(dataA.added || 0);
        const dateB = new Date(dataB.added || 0);
        comparison = dateA - dateB; // older first when ascending
      } else if (sortOrder === 'modified') {
        // Sort by last modified (fall back to added if never modified)
        const dateA = new Date(dataA.updated || dataA.added || 0);
        const dateB = new Date(dataB.updated || dataB.added || 0);
        comparison = dateA - dateB; // older first when ascending
      } else {
        // Sort by name (alphabetically)
        comparison = filenameA.localeCompare(filenameB);
      }
      
      // Reverse if descending
      return sortAscending ? comparison : -comparison;
    });
  }

  // Store filtered results for chunked loading
  currentFilteredImages = filteredImages;
  renderedCount = 0;

  // Deselect any images that are no longer visible after filtering
  if (selectedImages.size > 0) {
    const visibleFilenames = new Set(filteredImages.map(([filename]) => filename));
    let deselectedCount = 0;
    for (const filename of selectedImages) {
      if (!visibleFilenames.has(filename)) {
        selectedImages.delete(filename);
        deselectedCount++;
      }
    }
    if (deselectedCount > 0) {
      console.log(`Deselected ${deselectedCount} image(s) no longer visible after filter change`);
    }
  }

  if (filteredImages.length === 0) {
    grid.innerHTML = '<div class="empty-state">No images found</div>';
    updateSearchPlaceholder(0);
    updateBulkActionsBar(0);
    return;
  }

  // Clear grid and render first chunk
  grid.innerHTML = '';
  renderGalleryChunk(grid, Math.min(GALLERY_CHUNK_SIZE, filteredImages.length));

  updateSearchPlaceholder(filteredImages.length);
  updateBulkActionsBar(filteredImages.length);
}

// Render a chunk of gallery images (used for initial load and infinite scroll)
function renderGalleryChunk(grid, count) {
  const startIndex = renderedCount;
  const endIndex = Math.min(startIndex + count, currentFilteredImages.length);
  
  if (startIndex >= currentFilteredImages.length) return;
  
  const chunk = currentFilteredImages.slice(startIndex, endIndex);
  
  const chunkHtml = chunk.map(([filename, data], chunkIndex) => {
    const index = startIndex + chunkIndex; // Global index for selection
    const isSelected = selectedImages.has(filename);
    
    // Check if image is 16:9 (aspect ratio ~1.78)
    const is16x9 = data.aspectRatio && Math.abs(data.aspectRatio - 1.78) < 0.05;
    
    // Check if image meets "sam" criteria: 3840x2160 and <= 20MB
    const width = data.dimensions?.width || 0;
    const height = data.dimensions?.height || 0;
    const fileSize = data.fileSize || 0;
    const fileSizeMB = fileSize / (1024 * 1024);
    const isSam = width === 3840 && height === 2160 && fileSizeMB <= 20;
    
    // Format date
    const dateAdded = formatDate(data.added);
    
    // Build badges HTML for bottom of card
    let badgesHtml = '';
    if (isSam) {
      badgesHtml += '<span class="sam-badge-card" title="Image resolution and size (<20MB) is correct target for Frame TVs">sam</span>';
    }
    if (is16x9) {
      badgesHtml += '<span class="aspect-badge-card">16:9</span>';
    }
    
    // Build filter/matte indicator
    const filterMatteSuffix = formatFilterMatteSuffix(data.filter, data.matte);
    
    // Get last display info from analytics (skip if recently displayed filter is active)
    const lastDisplay = recentlyDisplayedFilterActive ? null : getLastDisplayInfo(filename);
    const lastDisplayHtml = lastDisplay 
      ? `<div class="image-last-display">${lastDisplay.timeAgo} (${escapeHtml(lastDisplay.tvName)})</div>`
      : '';
    
    // Get similar images overlay (only when similar filter is active)
    const similarImages = getSimilarImagesForFile(filename);
    const similarOverlayHtml = similarImages.length > 0
      ? `<div class="similar-overlay">Similar: ${similarImages.map(item => `${getDisplayName(item.filename)} (${item.distance})`).join(', ')}</div>`
      : '';
    
    // Get recently displayed overlay (only when recently displayed filter is active)
    const recentlyDisplayedInfo = getRecentlyDisplayedInfoForFile(filename);
    const recentlyDisplayedHtml = recentlyDisplayedInfo.length > 0
      ? `<div class="similar-overlay">${recentlyDisplayedInfo.map(item => `${escapeHtml(item.tvName)} (${item.timeAgo})`).join(', ')}</div>`
      : '';
    
    return `
    <div class="image-card ${isSelected ? 'selected' : ''}" 
         data-filename="${filename}" 
         data-index="${index}">
      <div class="image-wrapper">
        <img src="thumbs/thumb_${filename}${thumbnailCacheBusters[filename] ? '?v=' + thumbnailCacheBusters[filename] : ''}" 
             onerror="this.src='library/${filename}'" 
             alt="${getDisplayName(filename)}" />
        <button class="select-badge" data-filename="${filename}" data-index="${index}" title="Select image">
          <span class="select-icon">☑</span>
        </button>
        ${similarOverlayHtml}
        ${recentlyDisplayedHtml}
      </div>
      <div class="image-info">
        <button class="stats-link" data-filename="${filename}" title="Stats">📊</button>
        <div class="image-filename"><span class="image-filename-text">${getDisplayName(filename)}</span>${filterMatteSuffix}${badgesHtml ? ' ' + badgesHtml : ''}</div>
        <div class="image-tags">
          ${(data.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
        <div class="image-info-footer">
          ${lastDisplayHtml}
          ${dateAdded ? `<div class="image-date">${dateAdded}</div>` : ''}
        </div>
      </div>
    </div>
  `;
  }).join('');
  
  // Append to grid
  grid.insertAdjacentHTML('beforeend', chunkHtml);
  renderedCount = endIndex;
  
  // Add click listeners to newly added cards
  const newCards = grid.querySelectorAll(`.image-card[data-index]`);
  newCards.forEach(card => {
    const cardIndex = parseInt(card.dataset.index);
    // Only add listeners to cards in this chunk (avoid duplicates)
    if (cardIndex >= startIndex && cardIndex < endIndex && !card.dataset.listenerAdded) {
      card.dataset.listenerAdded = 'true';
      card.addEventListener('click', (e) => {
        // Check if clicked on stats link
        if (e.target.closest('.stats-link')) {
          e.stopPropagation();
          const filename = e.target.closest('.stats-link').dataset.filename;
          navigateTo('/analytics');
          setTimeout(() => selectAnalyticsImage(filename), 300);
          return;
        }
        
        // Check if clicked on select badge
        if (e.target.closest('.select-badge')) {
          e.stopPropagation();
          const syntheticEvent = {
            ...e,
            metaKey: true,
            stopPropagation: () => e.stopPropagation()
          };
          handleImageClick(card.dataset.filename, parseInt(card.dataset.index), syntheticEvent);
          return;
        }
        
        // If shift or cmd/ctrl is held, select
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          handleImageClick(card.dataset.filename, parseInt(card.dataset.index), e);
        } else {
          openImageModal(card.dataset.filename);
        }
      });
    }
  });
  
  // Show/hide "load more" indicator
  updateLoadMoreIndicator(grid);
}

// Load more images when scrolling near bottom
function loadMoreGalleryImages() {
  if (isLoadingMoreImages) return;
  if (renderedCount >= currentFilteredImages.length) return;
  
  const grid = document.getElementById('image-grid');
  if (!grid) return;
  
  isLoadingMoreImages = true;
  renderGalleryChunk(grid, GALLERY_CHUNK_SIZE);
  isLoadingMoreImages = false;
}

// Update the "load more" indicator at bottom of gallery
function updateLoadMoreIndicator(grid) {
  // Remove existing indicator
  const existingIndicator = grid.querySelector('.gallery-load-more');
  if (existingIndicator) existingIndicator.remove();
  
  // Add indicator if there are more images to load
  if (renderedCount < currentFilteredImages.length) {
    const remaining = currentFilteredImages.length - renderedCount;
    const indicator = document.createElement('div');
    indicator.className = 'gallery-load-more';
    indicator.innerHTML = `<span>Scroll for ${remaining} more image${remaining !== 1 ? 's' : ''}...</span>`;
    grid.appendChild(indicator);
  }
}

// Initialize gallery scroll listener for infinite scroll
function initGalleryInfiniteScroll() {
  // Use the main content area or window for scroll detection
  const scrollContainer = document.querySelector('main') || window;
  
  const handleScroll = () => {
    const grid = document.getElementById('image-grid');
    if (!grid) return;
    
    // Check if gallery tab is active
    const galleryTab = document.getElementById('gallery-tab');
    if (!galleryTab || !galleryTab.classList.contains('active')) return;
    
    // Get scroll position
    let scrollBottom;
    if (scrollContainer === window) {
      scrollBottom = window.innerHeight + window.scrollY;
    } else {
      scrollBottom = scrollContainer.scrollTop + scrollContainer.clientHeight;
    }
    
    const gridBottom = grid.offsetTop + grid.offsetHeight;
    const threshold = 300; // Load more when within 300px of bottom
    
    if (scrollBottom >= gridBottom - threshold) {
      loadMoreGalleryImages();
    }
  };
  
  // Throttle scroll handler
  let scrollTimeout;
  const throttledScroll = () => {
    if (scrollTimeout) return;
    scrollTimeout = setTimeout(() => {
      handleScroll();
      scrollTimeout = null;
    }, 100);
  };
  
  scrollContainer.addEventListener('scroll', throttledScroll);
}

function updateSearchPlaceholder(count) {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.placeholder = `Search ${count} images`;
  }
}

// Search and Filter
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  const tagFilterBtn = document.getElementById('tag-filter-btn');
  const tagFilterDropdown = document.getElementById('tag-filter-dropdown');
  const clearTagFilterBtn = document.getElementById('clear-tag-filter-btn');
  const sortOrderSelect = document.getElementById('sort-order');
  const sortDirectionBtn = document.getElementById('sort-direction-btn');

  if (searchInput) {
    searchInput.addEventListener('input', () => renderGallery());
  }

  // Clear tag filter button
  if (clearTagFilterBtn) {
    clearTagFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Reset all tag checkboxes to unchecked state
      const checkboxes = document.querySelectorAll('.tag-checkbox');
      checkboxes.forEach(cb => setTagState(cb, 'unchecked'));
      // Uncheck "None" checkbox
      const noneCheckbox = document.querySelector('.tv-none-checkbox');
      if (noneCheckbox) {
        noneCheckbox.checked = false;
      }
      // Uncheck "Duplicates" checkbox (legacy - may not exist)
      const dupesCheckbox = document.querySelector('.duplicates-checkbox');
      if (dupesCheckbox) {
        dupesCheckbox.checked = false;
      }
      // Uncheck "Similar" checkbox and clear filter
      const similarCheckbox = document.querySelector('.similar-checkbox');
      if (similarCheckbox) {
        similarCheckbox.checked = false;
      }
      // Uncheck "Portrait" checkbox and clear filter
      const portraitCheckbox = document.querySelector('.portrait-checkbox');
      if (portraitCheckbox) {
        portraitCheckbox.checked = false;
      }
      // Uncheck "Non 16:9" checkbox and clear filter
      const non169Checkbox = document.querySelector('.non169-checkbox');
      if (non169Checkbox) {
        non169Checkbox.checked = false;
      }
      // Uncheck "Recently Displayed" checkbox and clear filter
      const recentlyDisplayedCheckbox = document.querySelector('.recently-displayed-checkbox');
      if (recentlyDisplayedCheckbox) {
        recentlyDisplayedCheckbox.checked = false;
      }
      // Restore sort state if we were in similar filter mode
      if (similarFilterActive && preSimilarSortState) {
        const sortOrderSelect = document.getElementById('sort-order');
        if (sortOrderSelect) sortOrderSelect.value = preSimilarSortState.order;
        sortAscending = preSimilarSortState.ascending;
        updateSortDirectionIcon();
        preSimilarSortState = null;
      }
      // Restore sort state if we were in recently displayed filter mode
      if (recentlyDisplayedFilterActive && preRecentSortState) {
        const sortOrderSelect = document.getElementById('sort-order');
        if (sortOrderSelect) sortOrderSelect.value = preRecentSortState.order;
        sortAscending = preRecentSortState.ascending;
        updateSortDirectionIcon();
        preRecentSortState = null;
      }
      similarFilterActive = false;
      portraitFilterActive = false;
      non169FilterActive = false;
      recentlyDisplayedFilterActive = false;
      updateTagFilterDisplay();
      updateTVShortcutStates();
      // Close the dropdown if it's open
      if (!DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) {
        closeTagDropdownPortal();
      }
    });
  }

  // Toggle tag filter dropdown
  if (tagFilterBtn) {
    tagFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Debug log
      console.log('[TagDropdown] button click');
      const dbg = document.getElementById('tag-dropdown-debug');
      if (dbg) dbg.textContent = 'Debug: click received at ' + new Date().toLocaleTimeString();
      if (DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) {
        // Keep it visible; just ensure populated
        if (tagFilterDropdown) {
          tagFilterDropdown.classList.add('active');
          tagFilterDropdown.style.display = 'block';
          const optionsContainer = tagFilterDropdown.querySelector('.multiselect-options');
          if (optionsContainer && optionsContainer.children.length === 0) {
            loadTagsForFilter();
          }
        }
        tagFilterBtn.classList.add('active');
        return;
      }
      // Normal toggle behavior when debug is off (use portal)
      if (tagDropdownState.isOpen) {
        closeTagDropdownPortal();
      } else {
        openTagDropdownPortal();
      }
    });
  }

  // Fallback: Close dropdown when clicking outside (shield handles most cases, this is backup)
  document.addEventListener('click', (e) => {
    if (DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) return;
    const { btn, dropdown } = getTagFilterElements();
    if (!dropdown || !btn) return;
    
    // Only act if dropdown is open
    if (!tagDropdownState.isOpen) return;
    
    const clickInsideDropdown = dropdown.contains(e.target);
    const clickOnButton = btn.contains(e.target);
    const clickOnShield = e.target.id === 'dropdown-click-shield';
    // IMPORTANT: Don't intercept clicks on the gear button
    const clickOnGear = e.target.closest('#open-advanced-btn');
    if (!clickInsideDropdown && !clickOnButton && !clickOnShield && !clickOnGear) {
      console.log('[TagDropdown] outside click (fallback) - closing');
      closeTagDropdownPortal();
    }
  });

  // Function to resize sort select based on selected option
  function resizeSortSelect(trigger) {
    if (!sortOrderSelect) return;
    
    // Create a temporary span to measure text width
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.style.fontSize = '13px';
    tempSpan.style.fontFamily = window.getComputedStyle(sortOrderSelect).fontFamily;
    tempSpan.textContent = sortOrderSelect.options[sortOrderSelect.selectedIndex].text;
    document.body.appendChild(tempSpan);
    
    const textWidth = tempSpan.offsetWidth;
    document.body.removeChild(tempSpan);
    
    // Set width to text width plus space for arrow (16px)
  const computedWidth = textWidth + 2; // tiny buffer to prevent truncation
    sortOrderSelect.style.setProperty('box-sizing', 'content-box');
    sortOrderSelect.style.setProperty('width', `${computedWidth}px`, 'important');
    sortOrderSelect.style.setProperty('min-width', `${computedWidth}px`, 'important');
    sortOrderSelect.style.setProperty('max-width', `${computedWidth}px`, 'important');

    if (trigger) {
      console.log('[Gallery] resizeSortSelect', {
        trigger,
        text: tempSpan.textContent,
        textWidth,
        computedWidth
      });
    }
  }

  if (sortOrderSelect) {
    sortOrderSelect.addEventListener('change', () => {
      resizeSortSelect('change');
      renderGallery();
      saveSortPreference(sortOrderSelect.value, sortAscending);
    });
    // Initial resize
    resizeSortSelect('init');
  }

  // Toggle sort direction
  if (sortDirectionBtn) {
    sortDirectionBtn.addEventListener('click', () => {
      sortAscending = !sortAscending;
      updateSortDirectionIcon();
      renderGallery();
      const orderValue = sortOrderSelect ? sortOrderSelect.value : initialSortOrderPreference;
      saveSortPreference(orderValue, sortAscending);
    });
  }

  updateSortDirectionIcon();
});

// Fallback: ensure gear button opens Advanced even if initSettingsNavigation didn't bind
// (No fallback gear handler needed now that UI binds first.)

function updateSortDirectionIcon() {
  const sortDirectionBtn = document.getElementById('sort-direction-btn');
  if (!sortDirectionBtn) {
    return;
  }

  const isAscending = !!sortAscending;
  const icon = isAscending ? '↑' : '↓';
  sortDirectionBtn.textContent = icon;
  sortDirectionBtn.setAttribute('data-direction', isAscending ? 'asc' : 'desc');
  sortDirectionBtn.setAttribute('aria-pressed', String(isAscending));
  sortDirectionBtn.setAttribute('aria-label', isAscending ? 'Sort ascending' : 'Sort descending');
  sortDirectionBtn.title = isAscending ? 'Sort ascending' : 'Sort descending';
}

function updateTagFilterCount() {
  // This function is no longer needed with custom dropdown
  // Keeping for backwards compatibility
}

// Upload Functions
function isHeicUpload(file) {
  if (!file) return false;
  const filename = (file.name || '').toLowerCase();
  const mimetype = (file.type || '').toLowerCase();
  return (
    filename.endsWith('.heic') ||
    filename.endsWith('.heif') ||
    mimetype.startsWith('image/heic') ||
    mimetype.startsWith('image/heif')
  );
}

async function createPreviewUrl(file) {
  if (!isHeicUpload(file)) {
    const url = URL.createObjectURL(file);
    return {
      url,
      alt: 'Selected image preview'
    };
  }

  const formData = new FormData();
  formData.append('image', file, file.name || 'preview.heic');

  const response = await fetch(`${API_BASE}/images/preview`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Preview conversion failed (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  return {
    url,
    alt: 'Preview converted from HEIC source'
  };
}

async function updateUploadPreview(file) {
  const container = document.getElementById('upload-preview-container');
  const previewImage = document.getElementById('upload-preview-image');
  const spinner = document.getElementById('upload-preview-spinner');
  const errorEl = document.getElementById('upload-preview-error');

  if (!container || !previewImage) {
    return;
  }

  activeUploadPreviewToken += 1;
  const requestToken = activeUploadPreviewToken;

  const hideSpinner = () => {
    if (spinner) {
      spinner.classList.add('hidden');
    }
  };

  const showSpinner = () => {
    if (spinner) {
      spinner.classList.remove('hidden');
    }
  };

  const hideError = () => {
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
  };

  const showError = message => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  };

  if (currentUploadPreviewUrl) {
    URL.revokeObjectURL(currentUploadPreviewUrl);
    currentUploadPreviewUrl = null;
  }

  previewImage.classList.add('hidden');
  previewImage.removeAttribute('src');
  previewImage.onload = null;
  previewImage.onerror = null;
  previewImage.alt = 'Upload preview';
  hideSpinner();
  hideError();

  if (!file) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  showSpinner();

  try {
    const { url, alt } = await createPreviewUrl(file);

    if (requestToken !== activeUploadPreviewToken) {
      URL.revokeObjectURL(url);
      return;
    }

    currentUploadPreviewUrl = url;
    previewImage.alt = alt;
    previewImage.onload = () => {
      if (requestToken !== activeUploadPreviewToken) {
        return;
      }
      hideSpinner();
      hideError();
      previewImage.classList.remove('hidden');
      if (currentUploadPreviewUrl === url) {
        URL.revokeObjectURL(url);
        currentUploadPreviewUrl = null;
      }
    };
    previewImage.onerror = () => {
      if (requestToken !== activeUploadPreviewToken) {
        return;
      }
      hideSpinner();
      previewImage.classList.add('hidden');
      showError('Preview unavailable.');
      if (currentUploadPreviewUrl === url) {
        URL.revokeObjectURL(url);
        currentUploadPreviewUrl = null;
      }
    };

    previewImage.src = url;
  } catch (error) {
    console.error('Upload preview failed:', error);
    if (requestToken !== activeUploadPreviewToken) {
      return;
    }
    hideSpinner();
    previewImage.classList.add('hidden');
    showError('Preview unavailable.');
  }
}

// Track active upload XHR for cancellation
let activeUploadXhr = null;

function initUploadForm() {
  const form = document.getElementById('upload-form');
  if (!form) return;

  const fileInput = document.getElementById('image-file');
  const clearFileBtn = document.getElementById('clear-file-btn');
  
  if (fileInput) {
    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
      await updateUploadPreview(file);
      
      // Detect image orientation and update matte dropdown
      if (file) {
        detectImageOrientation(file).then(isPortrait => {
          currentUploadIsPortrait = isPortrait;
          updateMatteOptionsForOrientation('matte-select', isPortrait);
        });
      } else {
        // No file - show all mattes (default to landscape)
        currentUploadIsPortrait = false;
        updateMatteOptionsForOrientation('matte-select', false);
      }
      
      // Check for duplicates if a file was selected
      if (file) {
        const result = await checkForDuplicates(file);
        showDuplicateWarning(result.duplicates);
      } else {
        showDuplicateWarning([]);
      }
      
      // Show/hide clear button based on file selection
      if (clearFileBtn) {
        clearFileBtn.classList.toggle('hidden', !file);
      }
    });
  }

  if (clearFileBtn && fileInput) {
    clearFileBtn.addEventListener('click', async () => {
      fileInput.value = '';
      await updateUploadPreview(null);
      showDuplicateWarning([]);
      clearFileBtn.classList.add('hidden');
      // Reset matte options to show all
      currentUploadIsPortrait = false;
      updateMatteOptionsForOrientation('matte-select', false);
    });
  }

  form.addEventListener('reset', () => {
    updateUploadPreview(null);
    showDuplicateWarning([]);
    if (clearFileBtn) clearFileBtn.classList.add('hidden');
    // Reset matte options to show all
    currentUploadIsPortrait = false;
    updateMatteOptionsForOrientation('matte-select', false);
  });
  updateUploadPreview(null);

  // Cancel button handler
  const cancelBtn = document.getElementById('upload-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (activeUploadXhr) {
        activeUploadXhr.abort();
        activeUploadXhr = null;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const statusDiv = document.getElementById('upload-status');
    const submitButton = form.querySelector('button[type="submit"]');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressText = document.getElementById('upload-progress-text');
    
    // Reset and show progress UI
    statusDiv.innerHTML = '';
    submitButton.disabled = true;
    submitButton.style.display = 'none';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressBar.classList.remove('success', 'error');
    progressText.textContent = 'Uploading... 0%';

    // Create XHR for progress tracking
    const xhr = new XMLHttpRequest();
    activeUploadXhr = xhr;

    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = percent + '%';
        progressText.textContent = `Uploading... ${percent}%`;
      }
    });

    // Handle completion
    xhr.addEventListener('load', async () => {
      activeUploadXhr = null;
      
      try {
        const result = JSON.parse(xhr.responseText);
        
        if (xhr.status >= 200 && xhr.status < 300 && result.success) {
          // Show success state briefly
          progressBar.style.width = '100%';
          progressBar.classList.add('success');
          progressText.textContent = 'Upload complete!';
          
          // Set sort to Date Added, descending (newest first) BEFORE navigation
          sortAscending = false;
          const sortOrderSelect = document.getElementById('sort-order');
          if (sortOrderSelect) {
            sortOrderSelect.value = 'date';
            const event = new Event('change', { bubbles: true });
            sortOrderSelect.dispatchEvent(event);
          }
          updateSortDirectionIcon();
          const orderValue = sortOrderSelect ? sortOrderSelect.value : 'date';
          saveSortPreference(orderValue, sortAscending);
          
          // Brief delay to show success, then reset and navigate
          setTimeout(async () => {
            // Reset form for next use
            form.reset();
            resetUploadProgressUI(submitButton, progressContainer, progressBar);
            
            // Clear upload applied tags
            uploadAppliedTags = [];
            renderUploadAppliedTags();
            renderUploadTvTagsHelper();
            
            // Reload tags in case new ones were added
            await loadTags();
            
            // Refresh similar groups and filter count
            await fetchSimilarGroups();
            await fetchSimilarBreakpoints();
            await loadTagsForFilter();
            
            // Close upload modal and return to gallery
            navigateTo('/');
            
            // Re-render gallery if special filter is active
            if (similarFilterActive) {
              renderGallery();
            }
            
            // Trigger auto-sync
            await manualSync();
          }, 500);
        } else {
          // Server returned error
          progressBar.classList.add('error');
          progressText.textContent = 'Upload failed';
          statusDiv.innerHTML = `<div class="error">Upload failed: ${result.error || 'Unknown error'}</div>`;
          resetUploadProgressUI(submitButton, progressContainer, progressBar);
        }
      } catch (parseError) {
        // JSON parse error
        progressBar.classList.add('error');
        progressText.textContent = 'Upload failed';
        statusDiv.innerHTML = '<div class="error">Upload failed: Invalid server response</div>';
        resetUploadProgressUI(submitButton, progressContainer, progressBar);
      }
    });

    // Handle network errors
    xhr.addEventListener('error', () => {
      activeUploadXhr = null;
      progressBar.classList.add('error');
      progressText.textContent = 'Upload failed';
      statusDiv.innerHTML = '<div class="error">Upload failed: Network error</div>';
      resetUploadProgressUI(submitButton, progressContainer, progressBar);
    });

    // Handle cancellation
    xhr.addEventListener('abort', () => {
      activeUploadXhr = null;
      statusDiv.innerHTML = '<div class="info">Upload cancelled</div>';
      resetUploadProgressUI(submitButton, progressContainer, progressBar);
    });

    // Send the request
    xhr.open('POST', `${API_BASE}/images/upload`);
    xhr.send(formData);
  });
  
  // Initialize upload tags functionality
  initUploadTags();
}

// Helper to reset upload progress UI
function resetUploadProgressUI(submitButton, progressContainer, progressBar) {
  submitButton.disabled = false;
  submitButton.style.display = '';
  progressContainer.classList.add('hidden');
  progressBar.style.width = '0%';
  progressBar.classList.remove('success', 'error');
}

// Track applied tags for upload form
let uploadAppliedTags = [];

// Initialize upload tags - suggested tags and applied tags
function initUploadTags() {
  const addTagsBtn = document.getElementById('upload-add-tags-btn');
  const tagsInput = document.getElementById('tags-input');
  
  if (addTagsBtn && tagsInput) {
    addTagsBtn.addEventListener('click', () => {
      addUploadTags();
    });
    
    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addUploadTags();
      }
    });
  }
  
  // Render initial state
  renderUploadTvTagsHelper();
  renderUploadAppliedTags();
}

// Add tags from upload form input
function addUploadTags() {
  const tagsInput = document.getElementById('tags-input');
  if (!tagsInput) return;
  
  const inputValue = tagsInput.value;
  const tags = inputValue.split(',').map(t => t.trim()).filter(t => t);
  
  if (tags.length === 0) return;
  
  // Add new tags to applied list (avoiding duplicates)
  tags.forEach(tag => {
    if (!uploadAppliedTags.includes(tag)) {
      uploadAppliedTags.push(tag);
    }
  });
  
  // Clear input
  tagsInput.value = '';
  
  // Update hidden form field with comma-separated tags
  updateUploadTagsFormField();
  
  // Re-render
  renderUploadAppliedTags();
  renderUploadTvTagsHelper();
}

// Update the hidden tags input field with current applied tags
function updateUploadTagsFormField() {
  // We need to update what gets submitted - the tags-input now just adds tags
  // So we create/update a hidden field with the actual tags
  let hiddenField = document.getElementById('upload-tags-hidden');
  if (!hiddenField) {
    hiddenField = document.createElement('input');
    hiddenField.type = 'hidden';
    hiddenField.id = 'upload-tags-hidden';
    hiddenField.name = 'tags';
    const form = document.getElementById('upload-form');
    if (form) form.appendChild(hiddenField);
  }
  hiddenField.value = uploadAppliedTags.join(', ');
  
  // Remove name from original input so it doesn't conflict
  const tagsInput = document.getElementById('tags-input');
  if (tagsInput) tagsInput.removeAttribute('name');
}

// Add a tag from the suggested helper
function addUploadTagFromHelper(tagName) {
  if (!uploadAppliedTags.includes(tagName)) {
    uploadAppliedTags.push(tagName);
    updateUploadTagsFormField();
    renderUploadAppliedTags();
    renderUploadTvTagsHelper();
  }
}

// Remove a tag from upload applied tags
function removeUploadTag(tagName) {
  uploadAppliedTags = uploadAppliedTags.filter(t => t !== tagName);
  updateUploadTagsFormField();
  renderUploadAppliedTags();
  renderUploadTvTagsHelper();
}

// Render the TV tags helper for upload form (suggested tags)
function renderUploadTvTagsHelper() {
  const container = document.getElementById('upload-tv-tags-helper');
  const wrapper = document.getElementById('upload-tv-tags-wrapper');
  if (!container) return;
  
  // Get all TV tags (not dependent on currentImage)
  const availableTags = getAllTvTags();
  
  // Filter out tags that are already applied
  const suggestedTags = availableTags.filter(item => !uploadAppliedTags.includes(item.tag));
  
  if (suggestedTags.length === 0) {
    container.innerHTML = '';
    if (wrapper) wrapper.style.display = 'none';
    return;
  }
  
  if (wrapper) wrapper.style.display = 'block';
  
  const pillsHtml = suggestedTags.map(item => {
    const excludeClass = item.allExclude ? ' exclude' : '';
    const excludeCount = item.excludeTvNames.length;
    const hasExcludes = excludeCount > 0;
    
    // Build tooltip showing all TV names
    const tooltipParts = [];
    if (item.includeTvNames.length > 0) {
      tooltipParts.push(item.includeTvNames.join(', '));
    }
    if (item.excludeTvNames.length > 0) {
      tooltipParts.push(item.excludeTvNames.map(n => `${n} (exclude)`).join(', '));
    }
    const tooltip = tooltipParts.join(', ');
    
    // Build TV label
    let tvLabelHtml;
    if (item.totalTvs === 1) {
      const tvName = item.includeTvNames[0] || item.excludeTvNames[0];
      const prefix = item.allExclude ? 'ex:' : '';
      tvLabelHtml = `<span class="tv-name">${escapeHtml(prefix + tvName)}</span>`;
    } else if (item.allExclude) {
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs</span>`;
    } else if (hasExcludes) {
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs <span class="tv-info-exclude">(${excludeCount} ex)</span></span>`;
    } else {
      tvLabelHtml = `<span class="tv-name">${item.totalTvs} TVs</span>`;
    }
    
    return `<button type="button" class="tv-tag-pill${excludeClass}" data-tag="${escapeHtml(item.tag)}" title="${escapeHtml(tooltip)}" tabindex="-1">
      <span class="tag-label">${escapeHtml(item.tag)}</span>
      ${tvLabelHtml}
    </button>`;
  }).join('');
  
  container.innerHTML = pillsHtml;
  
  // Add click handlers
  container.querySelectorAll('.tv-tag-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      pill.blur();
      const tag = pill.dataset.tag;
      addUploadTagFromHelper(tag);
    });
  });
}

// Render the applied tags for upload form
function renderUploadAppliedTags() {
  const container = document.getElementById('upload-applied-tags');
  if (!container) return;
  
  if (uploadAppliedTags.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  const tagsHtml = uploadAppliedTags.map(tag => {
    // Get TV matches for this tag (reuse existing function)
    const tvMatches = getTvMatchesForTag(tag);
    let tooltip = '';
    let tvInfoHtml = '';
    
    if (tvMatches.length > 0) {
      const matchStrings = tvMatches
        .sort((a, b) => a.tvName.localeCompare(b.tvName))
        .map(m => m.isExclude ? `${m.tvName} (exclude)` : m.tvName);
      tooltip = matchStrings.join(', ');
      
      // Build compact TV info display
      const excludeCount = tvMatches.filter(m => m.isExclude).length;
      const allExclude = excludeCount === tvMatches.length;
      const someExclude = excludeCount > 0 && !allExclude;
      
      let tvLabel;
      let colorClass = '';
      
      if (tvMatches.length === 1) {
        tvLabel = tvMatches[0].isExclude ? `ex:${tvMatches[0].tvName}` : tvMatches[0].tvName;
        if (tvMatches[0].isExclude) colorClass = ' tv-info-exclude';
      } else if (allExclude) {
        tvLabel = `${tvMatches.length} TVs`;
        colorClass = ' tv-info-exclude';
      } else if (someExclude) {
        // Show "X TVs (Y ex)" with Y ex in red
        tvInfoHtml = `<span class="tag-tv-info">${tvMatches.length} TVs <span class="tv-info-exclude">(${excludeCount} ex)</span></span>`;
      } else {
        tvLabel = `${tvMatches.length} TVs`;
      }
      
      // Only build tvInfoHtml if not already set (for partial exclude case)
      if (!tvInfoHtml) {
        // Truncate to keep tags uniform width
        if (tvLabel.length > 12) {
          tvLabel = tvLabel.substring(0, 11) + '…';
        }
        tvInfoHtml = `<span class="tag-tv-info${colorClass}">${escapeHtml(tvLabel)}</span>`;
      }
    }
    
    const hasMatchClass = tvMatches.length > 0 ? ' has-tv-match' : '';
    
    return `<div class="tag-item${hasMatchClass}" onclick="removeUploadTag('${escapeHtml(tag)}')" ${tooltip ? `title="${escapeHtml(tooltip)}"` : 'title="Click to remove"'}>
      <div class="tag-content">
        <span class="tag-name">${escapeHtml(tag)}</span>
        ${tvInfoHtml}
      </div>
      <span class="tag-remove">×</span>
    </div>`;
  }).join('');
  
  container.innerHTML = tagsHtml;
}

// Batch Upload Functions
function initBatchUploadForm() {
  const batchUploadBtn = document.getElementById('open-batch-upload-btn');
  
  if (batchUploadBtn) {
    batchUploadBtn.addEventListener('click', () => {
      // Create a file input that allows multiple selection
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      
      // Attach to DOM - required for iOS to reliably deliver multi-select files
      document.body.appendChild(fileInput);
      
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        // Clean up input after getting files
        fileInput.remove();
        
        if (files.length === 0) return;
        
        await uploadBatchImages(files);
      });
      
      // Trigger file picker
      fileInput.click();
    });
  }
}

// Helper function to format file size in human-readable format
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function uploadBatchImages(files) {
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB in bytes
  const UPLOAD_TIMEOUT_MS = 120000; // 2 minute timeout per file
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const skippedFiles = [];
  const errorFiles = []; // Track files that failed with error details
  const uploadedFilenames = []; // Track successfully uploaded filenames (server names with hash)
  const uploadedOriginalNames = {}; // Map server filename -> original filename
  const totalFiles = files.length;
  let cancelled = false;
  
  console.log(`[BatchUpload] Starting upload of ${totalFiles} files`);
  
  // Show progress indicator in gallery with progress bar
  const grid = document.getElementById('image-grid');
  const progressDiv = document.createElement('div');
  progressDiv.className = 'loading batch-upload-progress';
  progressDiv.style.fontSize = '1rem';
  progressDiv.style.padding = '30px';
  progressDiv.innerHTML = `
    <div style="margin-bottom: 12px;">Uploading ${totalFiles} image${totalFiles !== 1 ? 's' : ''}...</div>
    <div style="font-size: 1.3rem; font-weight: bold; margin-bottom: 10px;">0 / ${totalFiles}</div>
    <div class="batch-progress-bar-wrapper" style="width: 100%; max-width: 300px; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin: 0 auto 10px;">
      <div class="batch-progress-bar" style="width: 0%; height: 100%; background: #4a90d9; transition: width 0.15s ease;"></div>
    </div>
    <div class="batch-progress-file" style="font-size: 0.85rem; color: #666; margin-bottom: 8px;"></div>
    <div class="batch-status-detail" style="font-size: 0.8rem; color: #888; margin-bottom: 12px; max-height: 100px; overflow-y: auto; text-align: left; max-width: 400px; margin-left: auto; margin-right: auto;"></div>
    <button class="batch-cancel-btn btn-secondary" style="padding: 6px 16px; font-size: 0.9rem;">Cancel</button>
  `;
  grid.innerHTML = '';
  grid.appendChild(progressDiv);
  
  const counterEl = progressDiv.querySelector('div:nth-child(2)');
  const progressBar = progressDiv.querySelector('.batch-progress-bar');
  const statusDetail = progressDiv.querySelector('.batch-status-detail');
  const fileLabel = progressDiv.querySelector('.batch-progress-file');
  const cancelBtn = progressDiv.querySelector('.batch-cancel-btn');
  
  cancelBtn.addEventListener('click', () => {
    cancelled = true;
    cancelBtn.textContent = 'Cancelling...';
    cancelBtn.disabled = true;
    console.log('[BatchUpload] User cancelled upload');
  });
  
  // Helper to add status line
  const addStatusLine = (text, isError = false) => {
    const line = document.createElement('div');
    line.textContent = text;
    line.style.color = isError ? '#c0392b' : '#27ae60';
    statusDetail.insertBefore(line, statusDetail.firstChild);
    // Keep only last 10 status lines
    while (statusDetail.children.length > 10) {
      statusDetail.removeChild(statusDetail.lastChild);
    }
  };
  
  // Upload each file with XHR for progress
  for (let i = 0; i < files.length; i++) {
    if (cancelled) {
      console.log(`[BatchUpload] Skipping remaining ${files.length - i} files due to cancellation`);
      break;
    }
    
    const file = files[i];
    const shortName = file.name.length > 30 ? file.name.substring(0, 27) + '...' : file.name;
    
    console.log(`[BatchUpload] Processing file ${i + 1}/${totalFiles}: ${file.name} (${formatFileSize(file.size)})`);
    
    // Check file size before uploading
    if (file.size > MAX_FILE_SIZE) {
      skippedCount++;
      skippedFiles.push({
        name: file.name,
        size: formatFileSize(file.size)
      });
      console.warn(`[BatchUpload] Skipped ${file.name}: ${formatFileSize(file.size)} exceeds 20MB limit`);
      addStatusLine(`⊘ ${shortName} - too large`, true);
      
      const completedCount = i + 1;
      counterEl.textContent = `${completedCount} / ${totalFiles}`;
      continue;
    }
    
    // Show current file being uploaded
    fileLabel.textContent = `Uploading: ${shortName}`;
    progressBar.style.width = '0%';
    
    const uploadStartTime = Date.now();
    try {
      const result = await uploadSingleFileWithProgress(file, (percent) => {
        progressBar.style.width = `${percent}%`;
      }, UPLOAD_TIMEOUT_MS);
      
      const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(1);
      
      if (result.success) {
        successCount++;
        if (result.filename) {
          uploadedFilenames.push(result.filename);
        }
        console.log(`[BatchUpload] ✓ ${file.name} uploaded successfully in ${uploadDuration}s`);
        addStatusLine(`✓ ${shortName}`);
      } else {
        errorCount++;
        const errorMsg = result.error || 'Unknown error';
        errorFiles.push({ name: file.name, error: errorMsg });
        console.error(`[BatchUpload] ✗ Failed to upload ${file.name}:`, errorMsg);
        addStatusLine(`✗ ${shortName} - ${errorMsg}`, true);
      }
      
      const completedCount = i + 1;
      counterEl.textContent = `${completedCount} / ${totalFiles}`;
      progressBar.style.width = '100%';
      
    } catch (error) {
      errorCount++;
      const errorMsg = error.message || 'Unknown error';
      errorFiles.push({ name: file.name, error: errorMsg });
      console.error(`[BatchUpload] ✗ Error uploading ${file.name}:`, error);
      addStatusLine(`✗ ${shortName} - ${errorMsg}`, true);
      
      const completedCount = i + 1;
      counterEl.textContent = `${completedCount} / ${totalFiles}`;
    }
  }
  
  console.log(`[BatchUpload] Completed: ${successCount} success, ${errorCount} errors, ${skippedCount} skipped`);
  
  fileLabel.textContent = '';
  
  // Build summary message
  let summaryParts = [];
  
  if (successCount > 0) {
    summaryParts.push(`${successCount} image${successCount !== 1 ? 's' : ''} uploaded successfully`);
  }
  
  if (skippedCount > 0) {
    summaryParts.push(`${skippedCount} skipped (over 20MB limit)`);
  }
  
  if (errorCount > 0) {
    summaryParts.push(`${errorCount} failed`);
  }
  
  if (cancelled) {
    const remaining = totalFiles - (successCount + errorCount + skippedCount);
    if (remaining > 0) {
      summaryParts.push(`${remaining} cancelled`);
    }
  }
  
  // Show result summary if there were issues
  if (skippedCount > 0 || errorCount > 0 || cancelled) {
    let message = 'Batch upload completed:\n\n' + summaryParts.join('\n');
    
    if (skippedFiles.length > 0) {
      message += '\n\nSkipped files (over 20MB):';
      skippedFiles.forEach(file => {
        message += `\n• ${file.name} (${file.size})`;
      });
    }
    
    if (errorFiles.length > 0) {
      message += '\n\nFailed files:';
      errorFiles.forEach(file => {
        message += `\n• ${file.name}: ${file.error}`;
      });
    }
    
    alert(message);
  }
  
  if (successCount > 0) {
    setGallerySortToNewestFirst();
  }

  // Reload gallery and tags
  await loadGallery();
  await loadTags();
  
  // Refresh similar groups for filter counts
  if (uploadedFilenames.length > 0) {
    await fetchSimilarGroups();
    await fetchSimilarBreakpoints();
    // Refresh tag filter to show updated similar counts
    await loadTagsForFilter();
    
    // Re-render gallery if special filter is active (so new items appear)
    if (similarFilterActive) {
      renderGallery();
    }
    
    const similarFilenames = getSimilarFilenames();
    const uploadedSimilar = uploadedFilenames.filter(f => similarFilenames.has(f));
    
    // If any uploaded images are similar to existing images, show notification
    if (uploadedSimilar.length > 0) {
      // Find which existing images they are similar to
      const similarInfo = [];
      for (const filename of uploadedSimilar) {
        for (const group of similarGroups) {
          if (group.includes(filename)) {
            const others = group.filter(f => f !== filename);
            if (others.length > 0) {
              similarInfo.push(`${getBaseName(filename)} is similar to ${others.map(f => getBaseName(f)).join(', ')}`);
            }
            break;
          }
        }
      }
      
      if (similarInfo.length > 0) {
        alert(`Some uploaded images may be duplicates:\n\n${similarInfo.join('\n\n')}\n\nSelect "Similar Images" in the tag filter to investigate.`);
      }
    }
  }
  
  // Auto-select the uploaded images for easy batch tagging
  if (uploadedFilenames.length > 0) {
    selectedImages.clear();
    uploadedFilenames.forEach(filename => {
      selectedImages.add(filename);
    });
    // Use lightweight visual update instead of full re-render to prevent scroll flickering
    updateGallerySelectionVisual();
  }
  
  // Trigger auto-sync
  await manualSync();
}

// Upload a single file with XHR progress tracking
function uploadSingleFileWithProgress(file, onProgress, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('image', file);
    formData.append('matte', 'none');
    formData.append('filter', 'none');
    formData.append('tags', '');
    
    // Set timeout for the request
    xhr.timeout = timeoutMs;
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          resolve(result);
        } catch (e) {
          resolve({ success: false, error: 'Invalid server response' });
        }
      } else {
        // Handle HTTP errors
        let errorMsg = `Server error (${xhr.status})`;
        try {
          const errorResult = JSON.parse(xhr.responseText);
          if (errorResult.error) {
            errorMsg = errorResult.error;
          }
        } catch (e) {
          // Use default error message
        }
        resolve({ success: false, error: errorMsg });
      }
    });
    
    xhr.addEventListener('error', () => {
      reject(new Error('Network error - check your connection'));
    });
    
    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timed out - file may be too large or connection too slow'));
    });
    
    xhr.addEventListener('abort', () => {
      resolve({ success: false, error: 'Cancelled' });
    });
    
    xhr.open('POST', `${API_BASE}/images/upload`);
    xhr.send(formData);
  });
}

// Tag Management
async function loadTVs() {
  try {
    const response = await fetch(`${API_BASE}/ha/tvs`);
    const data = await response.json();
    if (data.success && Array.isArray(data.tvs)) {
      allTVs = data.tvs;
      // Refresh filter dropdown if it's already rendered
      const dropdownOptions = document.querySelector('.multiselect-options');
      if (dropdownOptions && dropdownOptions.children.length > 0) {
        loadTagsForFilter();
      }
    }
  } catch (error) {
    console.error('Error loading TVs:', error);
  }
}

async function loadTags() {
  try {
    const response = await fetch(`${API_BASE}/tags`);
    allTags = await response.json();
    renderTagList();
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

// Count images that match a TV's include/exclude tag criteria
function countImagesForTV(tv) {
  const includeTags = tv.tags || [];
  const excludeTags = tv.exclude_tags || [];
  
  let count = 0;
  for (const [filename, data] of Object.entries(allImages)) {
    const imageTagSet = new Set(data.tags || []);
    
    // Check include tags: if set, image must have at least one
    if (includeTags.length > 0 && !includeTags.some(tag => imageTagSet.has(tag))) {
      continue;
    }
    
    // Check exclude tags: if set, image must not have any
    if (excludeTags.length > 0 && excludeTags.some(tag => imageTagSet.has(tag))) {
      continue;
    }
    
    count++;
  }
  return count;
}

// Count images that have a specific tag
function countImagesForTag(tag) {
  let count = 0;
  for (const [filename, data] of Object.entries(allImages)) {
    const imageTags = data.tags || [];
    if (imageTags.includes(tag)) {
      count++;
    }
  }
  return count;
}

// Count images that don't match any TV's criteria
function countImagesForNone() {
  let count = 0;
  for (const [filename, data] of Object.entries(allImages)) {
    const imageTagSet = new Set(data.tags || []);
    let matchesAnyTV = false;
    
    for (const tv of allTVs) {
      const includeTags = tv.tags || [];
      const excludeTags = tv.exclude_tags || [];
      
      // Check include tags: if set, image must have at least one
      if (includeTags.length > 0 && !includeTags.some(tag => imageTagSet.has(tag))) {
        continue;
      }
      
      // Check exclude tags: if set, image must not have any
      if (excludeTags.length > 0 && excludeTags.some(tag => imageTagSet.has(tag))) {
        continue;
      }
      
      // Image matches this TV
      matchesAnyTV = true;
      break;
    }
    
    if (!matchesAnyTV) {
      count++;
    }
  }
  return count;
}

async function loadTagsForFilter() {
  try {
    const response = await fetch(`${API_BASE}/tags`);
    allTags = await response.json();

    allTags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const dropdownOptions = document.querySelector('.multiselect-options');
    if (!dropdownOptions) {
      return;
    }

    let html = '';

    // Special Filters Section (at top)
    html += `<div class="tv-shortcuts-header">Filters</div>`;
    
    // Recently Displayed filter
    const recentCount = getRecentlyDisplayedFilenames().size;
    html += `
      <div class="multiselect-option tv-shortcut recently-displayed-filter">
        <input type="checkbox" id="filter-recently-displayed" 
               value="recently-displayed" 
               class="recently-displayed-checkbox"
               ${recentlyDisplayedFilterActive ? 'checked' : ''}>
        <label for="filter-recently-displayed">
          <div class="tv-name">Recently Displayed <span class="tv-count">(${recentCount})</span></div>
          <div class="tv-tags-subtitle">Current and previous images on each TV</div>
        </label>
      </div>
    `;
    
    // Similar Images filter
    const { dupeCount, simCount } = getSimilarBreakpointCounts();
    html += `
      <div class="multiselect-option tv-shortcut similar-filter">
        <input type="checkbox" id="filter-similar" 
               value="similar" 
               class="similar-checkbox"
               ${similarFilterActive ? 'checked' : ''}>
        <label for="filter-similar">
          <div class="tv-name">Similar Images <span class="tv-count">(${dupeCount}dup/${simCount}sim)</span></div>
          <div class="tv-tags-subtitle">Find duplicates and visually similar images</div>
        </label>
      </div>
    `;
    
    // Portrait filter
    const portraitCount = countPortraitImages();
    html += `
      <div class="multiselect-option tv-shortcut portrait-filter">
        <input type="checkbox" id="filter-portrait" 
               value="portrait" 
               class="portrait-checkbox"
               ${portraitFilterActive ? 'checked' : ''}>
        <label for="filter-portrait">
          <div class="tv-name">Portrait <span class="tv-count">(${portraitCount})</span></div>
          <div class="tv-tags-subtitle">Images where height > width</div>
        </label>
      </div>
    `;
    
    // Non 16:9 filter
    const non169Count = countNon169Images();
    html += `
      <div class="multiselect-option tv-shortcut non169-filter">
        <input type="checkbox" id="filter-non169" 
               value="non169" 
               class="non169-checkbox"
               ${non169FilterActive ? 'checked' : ''}>
        <label for="filter-non169">
          <div class="tv-name">Landscape (Non 16:9) <span class="tv-count">(${non169Count})</span></div>
          <div class="tv-tags-subtitle">Landscape images that are not 16:9</div>
        </label>
      </div>
    `;
    
    html += `<div class="tv-shortcuts-divider"></div>`;

    // TV Shortcuts Section
    if (allTVs.length > 0) {
      html += `<div class="tv-shortcuts-header">TVs</div>`;
      
      // None filter at top of TVs
      const noneCount = countImagesForNone();
      html += `
        <div class="multiselect-option tv-shortcut">
          <input type="checkbox" id="tv-shortcut-none" 
                 value="none" 
                 class="tv-none-checkbox">
          <label for="tv-shortcut-none">
            <div class="tv-name">None <span class="tv-count">(${noneCount})</span></div>
            <div class="tv-tags-subtitle">Will not shuffle onto any TV</div>
          </label>
        </div>
      `;
      
      html += allTVs.map(tv => {
        const safeTags = JSON.stringify(tv.tags || []).replace(/"/g, '&quot;');
        const id = tv.device_id || tv.entity_id;
        
        // Count images that match this TV's criteria
        const matchCount = countImagesForTV(tv);
        
        let subtitleHtml = '';
        if (tv.tags && tv.tags.length > 0) {
          subtitleHtml += `<div class="tv-tags-subtitle">+ ${tv.tags.join(', ')}</div>`;
        }
        if (tv.exclude_tags && tv.exclude_tags.length > 0) {
          subtitleHtml += `<div class="tv-tags-subtitle">- ${tv.exclude_tags.join(', ')}</div>`;
        }

        return `
        <div class="multiselect-option tv-shortcut">
          <input type="checkbox" id="tv-shortcut-${id}" 
                 value="${id}" 
                 class="tv-checkbox"
                 data-tags="${safeTags}">
          <label for="tv-shortcut-${id}">
            <div class="tv-name">${escapeHtml(tv.name)} <span class="tv-count">(${matchCount})</span></div>
            ${subtitleHtml}
          </label>
        </div>
      `}).join('');
      html += `<div class="tv-shortcuts-divider"></div>`;
    }
    
    // Tags Section
    html += `<div class="tags-header">Tags</div>`;
    html += allTags.map(tag => {
      const safeValue = tag.replace(/"/g, '&quot;');
      const tagCount = countImagesForTag(tag);
      return `
      <div class="multiselect-option" data-state="unchecked">
        <input type="checkbox" value="${safeValue}" class="tag-checkbox" data-state="unchecked">
        <label>${escapeHtml(tag)} <span class="tv-count">(${tagCount})</span></label>
      </div>
    `}).join('');

    dropdownOptions.innerHTML = html;

    // Add listeners for tags (three-state: unchecked → included → excluded → unchecked)
    const checkboxes = dropdownOptions.querySelectorAll('.tag-checkbox');
    checkboxes.forEach(checkbox => {
      const option = checkbox.closest('.multiselect-option');
      
      // Handle click on checkbox or label to cycle through states
      const cycleTagState = (e) => {
        e.stopPropagation();
        
        const currentState = checkbox.dataset.state || 'unchecked';
        let newState;
        
        // Cycle: unchecked → included → excluded → unchecked
        if (currentState === 'unchecked') {
          newState = 'included';
        } else if (currentState === 'included') {
          newState = 'excluded';
        } else {
          newState = 'unchecked';
        }
        
        // Use setTimeout to let the native click complete first, then override
        setTimeout(() => {
          setTagState(checkbox, newState);
          
          // Clear "None" checkbox when manually selecting tags
          const noneCheckbox = document.querySelector('.tv-none-checkbox');
          if (noneCheckbox) {
            noneCheckbox.checked = false;
          }
          
          // Clear special filters when selecting tags
          clearSimilarFilter();
          clearPortraitFilter();
          clearNon169Filter();
          clearRecentlyDisplayedFilter();
          
          updateTagFilterDisplay();
          updateTVShortcutStates();
        }, 0);
      };
      
      checkbox.addEventListener('click', cycleTagState);
      
      const label = checkbox.nextElementSibling;
      if (label) {
        label.addEventListener('click', (e) => {
          e.preventDefault();
          cycleTagState(e);
        });
      }
    });

    // Add listeners for TV shortcuts
    const tvCheckboxes = dropdownOptions.querySelectorAll('.tv-checkbox');
    tvCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => handleTVShortcutChange(e));
    });

    // Add listener for "None" checkbox
    const noneCheckbox = dropdownOptions.querySelector('.tv-none-checkbox');
    if (noneCheckbox) {
      noneCheckbox.addEventListener('change', (e) => handleNoneShortcutChange(e));
    }

    // Add listener for "Recently Displayed" checkbox
    const recentlyDisplayedCheckbox = dropdownOptions.querySelector('.recently-displayed-checkbox');
    if (recentlyDisplayedCheckbox) {
      recentlyDisplayedCheckbox.addEventListener('change', async (e) => {
        const wasActive = recentlyDisplayedFilterActive;
        recentlyDisplayedFilterActive = e.target.checked;
        
        if (recentlyDisplayedFilterActive && !wasActive) {
          // Save current sort state before entering recently displayed filter mode
          const sortOrderSelect = document.getElementById('sort-order');
          preRecentSortState = {
            order: sortOrderSelect ? sortOrderSelect.value : 'date',
            ascending: sortAscending
          };
          
          // Fetch fresh recently displayed data
          await fetchRecentlyDisplayed();
          
          // Clear other filters when enabling recently displayed filter
          const noneCheckbox = document.querySelector('.tv-none-checkbox');
          if (noneCheckbox) noneCheckbox.checked = false;
          clearSimilarFilter();
          clearPortraitFilter();
          clearNon169Filter();
          // Clear tag selections
          document.querySelectorAll('.tag-checkbox').forEach(cb => setTagState(cb, 'unchecked'));
          document.querySelectorAll('.tv-checkbox').forEach(cb => { cb.checked = false; });
        } else if (!recentlyDisplayedFilterActive && wasActive) {
          // Restore previous sort state
          if (preRecentSortState) {
            const sortOrderSelect = document.getElementById('sort-order');
            if (sortOrderSelect) sortOrderSelect.value = preRecentSortState.order;
            sortAscending = preRecentSortState.ascending;
            updateSortDirectionIcon();
            preRecentSortState = null;
          }
        }
        
        updateTagFilterDisplay();
        filterAndRenderGallery();
        // Close dropdown after selecting special filter
        if (!DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) {
          closeTagDropdownPortal();
        }
      });
    }

    // Add listener for "Similar Images" checkbox
    const similarCheckbox = dropdownOptions.querySelector('.similar-checkbox');
    if (similarCheckbox) {
      similarCheckbox.addEventListener('change', async (e) => {
        const wasActive = similarFilterActive;
        similarFilterActive = e.target.checked;
        
        if (similarFilterActive && !wasActive) {
          // Save current sort state before entering similar filter mode
          const sortOrderSelect = document.getElementById('sort-order');
          preSimilarSortState = {
            order: sortOrderSelect ? sortOrderSelect.value : 'date',
            ascending: sortAscending
          };
          // Switch to date sort, descending (newest first) for similar view
          if (sortOrderSelect) sortOrderSelect.value = 'date';
          sortAscending = false;
          updateSortDirectionIcon();
          
          // Fetch fresh similar data and breakpoints
          await Promise.all([
            fetchSimilarGroups(),
            fetchSimilarBreakpoints()
          ]);
          // Clear other filters when enabling similar filter
          const noneCheckbox = document.querySelector('.tv-none-checkbox');
          if (noneCheckbox) noneCheckbox.checked = false;
          // Clear portrait filter
          clearPortraitFilter();
          // Clear non-16:9 filter
          clearNon169Filter();
          // Clear recently displayed filter
          clearRecentlyDisplayedFilter();
          // Clear tag selections
          document.querySelectorAll('.tag-checkbox').forEach(cb => setTagState(cb, 'unchecked'));
          document.querySelectorAll('.tv-checkbox').forEach(cb => { cb.checked = false; });
        } else if (!similarFilterActive && wasActive) {
          // Restore previous sort state
          if (preSimilarSortState) {
            const sortOrderSelect = document.getElementById('sort-order');
            if (sortOrderSelect) sortOrderSelect.value = preSimilarSortState.order;
            sortAscending = preSimilarSortState.ascending;
            updateSortDirectionIcon();
            preSimilarSortState = null;
          }
        }
        
        updateTagFilterDisplay();
        filterAndRenderGallery();
        // Close dropdown after selecting special filter
        if (!DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) {
          closeTagDropdownPortal();
        }
      });
    }

    // Add listener for "Portrait" checkbox
    const portraitCheckbox = dropdownOptions.querySelector('.portrait-checkbox');
    if (portraitCheckbox) {
      portraitCheckbox.addEventListener('change', (e) => {
        portraitFilterActive = e.target.checked;
        
        if (portraitFilterActive) {
          // Clear other filters when enabling portrait filter
          const noneCheckbox = document.querySelector('.tv-none-checkbox');
          if (noneCheckbox) noneCheckbox.checked = false;
          // Clear similar filter
          clearSimilarFilter();
          // Clear non-16:9 filter
          clearNon169Filter();
          // Clear recently displayed filter
          clearRecentlyDisplayedFilter();
          // Clear tag selections
          document.querySelectorAll('.tag-checkbox').forEach(cb => setTagState(cb, 'unchecked'));
          document.querySelectorAll('.tv-checkbox').forEach(cb => { cb.checked = false; });
        }
        
        updateTagFilterDisplay();
        filterAndRenderGallery();
        // Close dropdown after selecting special filter
        if (!DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) {
          closeTagDropdownPortal();
        }
      });
    }

    // Add listener for "Non 16:9" checkbox
    const non169Checkbox = dropdownOptions.querySelector('.non169-checkbox');
    if (non169Checkbox) {
      non169Checkbox.addEventListener('change', (e) => {
        non169FilterActive = e.target.checked;
        
        if (non169FilterActive) {
          // Clear other filters when enabling non-16:9 filter
          const noneCheckbox = document.querySelector('.tv-none-checkbox');
          if (noneCheckbox) noneCheckbox.checked = false;
          // Clear similar filter
          clearSimilarFilter();
          // Clear portrait filter
          clearPortraitFilter();
          // Clear recently displayed filter
          clearRecentlyDisplayedFilter();
          // Clear tag selections
          document.querySelectorAll('.tag-checkbox').forEach(cb => setTagState(cb, 'unchecked'));
          document.querySelectorAll('.tv-checkbox').forEach(cb => { cb.checked = false; });
        }
        
        updateTagFilterDisplay();
        filterAndRenderGallery();
        // Close dropdown after selecting special filter
        if (!DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) {
          closeTagDropdownPortal();
        }
      });
    }

    updateTagFilterDisplay();
    updateTVShortcutStates();
  } catch (error) {
    console.error('Error loading tags for filter:', error);
  }
}

function getTagCheckbox(tagName) {
  // Case-insensitive search for tag checkbox by value
  const checkboxes = Array.from(document.querySelectorAll('.tag-checkbox'));
  return checkboxes.find(cb => cb.value.toLowerCase() === tagName.toLowerCase());
}

// Set a tag checkbox to one of three states: unchecked, included, excluded
function setTagState(checkbox, state) {
  const option = checkbox.closest('.multiselect-option');
  
  checkbox.dataset.state = state;
  if (option) {
    option.dataset.state = state;
  }
  
  // We don't actually use the checked property for display anymore,
  // but keep it somewhat in sync for any code that might check it
  if (state === 'unchecked') {
    checkbox.checked = false;
  } else {
    checkbox.checked = true;
  }
}

// Get the current state of a tag checkbox
function getTagState(checkbox) {
  return checkbox.dataset.state || 'unchecked';
}

/**
 * Clear the similar filter and restore sort state if it was active.
 * Call this when any other filter (tags, None, TV shortcuts) is selected.
 */
function clearSimilarFilter() {
  if (!similarFilterActive) return;
  
  // Uncheck the similar checkbox in the UI
  const similarCheckbox = document.querySelector('.similar-checkbox');
  if (similarCheckbox) {
    similarCheckbox.checked = false;
  }
  
  // Restore previous sort state
  if (preSimilarSortState) {
    const sortOrderSelect = document.getElementById('sort-order');
    if (sortOrderSelect) sortOrderSelect.value = preSimilarSortState.order;
    sortAscending = preSimilarSortState.ascending;
    updateSortDirectionIcon();
    preSimilarSortState = null;
  }
  
  similarFilterActive = false;
}

/**
 * Clear the Non 16:9 filter.
 * Call this when any other filter (tags, None, TV shortcuts, similar) is selected.
 */
function clearNon169Filter() {
  if (!non169FilterActive) return;
  
  // Uncheck the non169 checkbox in the UI
  const non169Checkbox = document.querySelector('.non169-checkbox');
  if (non169Checkbox) {
    non169Checkbox.checked = false;
  }
  
  non169FilterActive = false;
}

/**
 * Clear the Portrait filter.
 * Call this when any other filter (tags, None, TV shortcuts, similar, non-16:9) is selected.
 */
function clearPortraitFilter() {
  if (!portraitFilterActive) return;
  
  // Uncheck the portrait checkbox in the UI
  const portraitCheckbox = document.querySelector('.portrait-checkbox');
  if (portraitCheckbox) {
    portraitCheckbox.checked = false;
  }
  
  portraitFilterActive = false;
}

// Get all included tags
function getIncludedTags() {
  const checkboxes = document.querySelectorAll('.tag-checkbox');
  return Array.from(checkboxes)
    .filter(cb => getTagState(cb) === 'included')
    .map(cb => cb.value);
}

// Get all excluded tags
function getExcludedTags() {
  const checkboxes = document.querySelectorAll('.tag-checkbox');
  return Array.from(checkboxes)
    .filter(cb => getTagState(cb) === 'excluded')
    .map(cb => cb.value);
}

function handleTVShortcutChange(event) {
  const tvCheckbox = event.target;
  const tvId = tvCheckbox.value;
  
  // Find the TV object to get both include and exclude tags
  const tv = allTVs.find(t => (t.device_id || t.entity_id) === tvId);
  if (!tv) return;
  
  const includeTags = tv.tags || [];
  const excludeTags = tv.exclude_tags || [];
  const isChecked = tvCheckbox.checked;
  
  // Clear "None" checkbox when selecting a TV
  const noneCheckbox = document.querySelector('.tv-none-checkbox');
  if (noneCheckbox) {
    noneCheckbox.checked = false;
  }
  
  // Clear special filters when selecting a TV shortcut
  clearSimilarFilter();
  clearPortraitFilter();
  clearNon169Filter();
  clearRecentlyDisplayedFilter();
  
  // Clear all tag states first
  const allTagCheckboxes = document.querySelectorAll('.tag-checkbox');
  allTagCheckboxes.forEach(cb => setTagState(cb, 'unchecked'));
  
  if (isChecked) {
    // Set include tags to 'included' state
    includeTags.forEach(tag => {
      const tagCheckbox = getTagCheckbox(tag);
      if (tagCheckbox) {
        setTagState(tagCheckbox, 'included');
      }
    });
    
    // Set exclude tags to 'excluded' state
    excludeTags.forEach(tag => {
      const tagCheckbox = getTagCheckbox(tag);
      if (tagCheckbox) {
        setTagState(tagCheckbox, 'excluded');
      }
    });
  }
  
  updateTagFilterDisplay();
  updateTVShortcutStates();
  filterAndRenderGallery();
}

function handleNoneShortcutChange(event) {
  const noneCheckbox = event.target;
  const isChecked = noneCheckbox.checked;
  
  if (isChecked) {
    // Clear all TV shortcuts when selecting "None"
    const allTvCheckboxes = document.querySelectorAll('.tv-checkbox');
    allTvCheckboxes.forEach(cb => cb.checked = false);
    
    // Reset all tag checkboxes to unchecked state
    const allTagCheckboxes = document.querySelectorAll('.tag-checkbox');
    allTagCheckboxes.forEach(cb => setTagState(cb, 'unchecked'));
    
    // Clear special filters when selecting None
    clearSimilarFilter();
    clearPortraitFilter();
    clearNon169Filter();
    clearRecentlyDisplayedFilter();
  }
  
  updateTagFilterDisplay();
  updateTVShortcutStates();
}

function updateTVShortcutStates() {
  // Get currently included and excluded tags (lowercase for comparison)
  const includedTagsSet = new Set(getIncludedTags().map(t => t.toLowerCase()));
  const excludedTagsSet = new Set(getExcludedTags().map(t => t.toLowerCase()));

  // If no tags are selected, don't auto-check any TV shortcuts
  // (this prevents TVs with empty tag configs from being checked when "None" is selected)
  if (includedTagsSet.size === 0 && excludedTagsSet.size === 0) {
    return;
  }

  // Create a Set of all available tags (lowercase)
  const availableTagsSet = new Set(
    Array.from(document.querySelectorAll('.tag-checkbox')).map(cb => cb.value.toLowerCase())
  );

  const tvCheckboxes = document.querySelectorAll('.tv-checkbox');
  
  tvCheckboxes.forEach(tvCheckbox => {
    const tvId = tvCheckbox.value;
    const tv = allTVs.find(t => (t.device_id || t.entity_id) === tvId);
    
    if (!tv) {
      tvCheckbox.checked = false;
      tvCheckbox.indeterminate = false;
      return;
    }
    
    const tvIncludeTags = (tv.tags || []).filter(tag => availableTagsSet.has(tag.toLowerCase()));
    const tvExcludeTags = (tv.exclude_tags || []).filter(tag => availableTagsSet.has(tag.toLowerCase()));
    
    // Check for exact match on both include and exclude tags
    const includeMatch = 
      tvIncludeTags.length === includedTagsSet.size &&
      tvIncludeTags.every(tag => includedTagsSet.has(tag.toLowerCase()));
    
    const excludeMatch = 
      tvExcludeTags.length === excludedTagsSet.size &&
      tvExcludeTags.every(tag => excludedTagsSet.has(tag.toLowerCase()));
    
    if (includeMatch && excludeMatch) {
      tvCheckbox.checked = true;
      tvCheckbox.indeterminate = false;
    } else {
      tvCheckbox.checked = false;
      tvCheckbox.indeterminate = false;
    }
  });
}

function updateTagFilterDisplay() {
  const includedTags = getIncludedTags();
  const excludedTags = getExcludedTags();
  const noneCheckbox = document.querySelector('.tv-none-checkbox');
  const noneSelected = noneCheckbox && noneCheckbox.checked;
  const buttonText = document.getElementById('tag-filter-text');
  const clearBtn = document.getElementById('clear-tag-filter-btn');
  
  let label = 'All Tags';
  let showClear = false;

  if (recentlyDisplayedFilterActive) {
    label = 'Recently Displayed';
    showClear = true;
  } else if (similarFilterActive) {
    label = 'Similar Images';
    showClear = true;
  } else if (portraitFilterActive) {
    label = 'Portrait';
    showClear = true;
  } else if (non169FilterActive) {
    label = 'Non 16:9';
    showClear = true;
  } else if (noneSelected) {
    label = 'None';
    showClear = true;
  } else if (includedTags.length > 0 || excludedTags.length > 0) {
    // Build label with includes and excludes (excludes prefixed with -)
    const parts = [];
    parts.push(...includedTags);
    parts.push(...excludedTags.map(t => `-${t}`));
    label = parts.join(', ');
    showClear = true;
  }

  if (buttonText) {
    buttonText.textContent = label;
  }

  if (clearBtn) {
    clearBtn.style.display = showClear ? 'block' : 'none';
  }
  
  renderGallery();
}

// Wrapper to filter and render gallery (used for async filter changes)
function filterAndRenderGallery() {
  renderGallery();
}

function renderTagList() {
  const list = document.getElementById('tag-list');
  
  if (allTags.length === 0) {
    list.innerHTML = '<div class="empty-state">No tags created yet</div>';
    return;
  }

  list.innerHTML = allTags.map(tag => `
    <div class="tag-item">
      <span>${tag}</span>
      <button class="tag-remove" onclick="removeTag('${tag}')" title="Remove tag">×</button>
    </div>
  `).join('');
}

function initTagForm() {
  const form = document.getElementById('tag-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('tag-name').value;

    try {
      const response = await fetch(`${API_BASE}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      const result = await response.json();

      if (result.success) {
        form.reset();
        loadTags();
        loadTagsForFilter();
      }
    } catch (error) {
      console.error('Error adding tag:', error);
    }
  });
}

async function removeTag(tagName) {
  if (!confirm(`Remove tag "${tagName}" from all images?`)) return;

  try {
    await fetch(`${API_BASE}/tags/${encodeURIComponent(tagName)}`, { method: 'DELETE' });
    loadTags();
    loadTagsForFilter();
    loadGallery(); // Reload gallery to reflect removed tags
  } catch (error) {
    console.error('Error removing tag:', error);
  }
}

// Image Editing Helpers
const MIN_CROP_PERCENT = 4;
const CROP_RATIO_TOLERANCE = 0.001;
const CROP_PRESET_MATCH_TOLERANCE = 0.02;
const CROP_PRESET_DETAILS = {
  '1:1': { ratio: 1 },
  '4:3': { ratio: 4 / 3 },
  '3:2': { ratio: 3 / 2 },
  '16:9': { ratio: 16 / 9 },
  '16:9sam': { ratio: 16 / 9, targetResolution: { width: 3840, height: 2160 } }
};

const CROP_PRESET_RATIOS = Object.fromEntries(
  Object.entries(CROP_PRESET_DETAILS).map(([preset, detail]) => [preset, detail.ratio])
);

const CROP_INSET_EPSILON = 0.0001;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Calculate the largest axis-aligned inscribed rectangle after rotation.
 * When an image is rotated by an arbitrary angle, the corners extend beyond
 * the original bounds. This function computes the largest rectangle that
 * fits entirely within the rotated image without showing any background.
 * 
 * @param {number} width - Original image width
 * @param {number} height - Original image height  
 * @param {number} angleDegrees - Rotation angle in degrees
 * @returns {{ width: number, height: number, scale: number }} Inscribed dimensions and scale factor
 */
function getInscribedDimensions(width, height, angleDegrees) {
  if (!width || !height) return { width: 0, height: 0, scale: 1 };
  if (Math.abs(angleDegrees) < 0.01) return { width, height, scale: 1 };
  
  const angle = Math.abs(angleDegrees) * Math.PI / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  
  // For a W×H rectangle rotated by angle θ around its center,
  // the largest inscribed axis-aligned rectangle (same aspect ratio) is:
  // 
  // The rotated corners extend beyond original bounds, creating black triangles.
  // The inscribed rectangle must avoid these corners.
  //
  // For the inscribed rectangle that maintains the original aspect ratio:
  // scale = 1 / (cosA + sinA * max(aspectRatio, 1/aspectRatio))
  // But we need separate scales for width and height when aspect ratios differ.
  //
  // Correct formula for inscribed rectangle in rotated rectangle:
  const W = width;
  const H = height;
  
  // The inscribed rectangle dimensions (maintaining original aspect ratio):
  // inscribed_W = W * cos(θ) - H * sin(θ)  -- but only works when positive
  // inscribed_H = H * cos(θ) - W * sin(θ)  -- but only works when positive
  //
  // These can go negative for large angles, so we use the proper formula:
  // The scale factor for same-aspect-ratio inscribed rectangle is:
  const denom = cosA + sinA * Math.max(W/H, H/W);
  const scale = 1 / denom;
  
  let inscribedWidth = width * scale;
  let inscribedHeight = height * scale;
  
  // Ensure positive dimensions
  inscribedWidth = Math.max(1, Math.floor(inscribedWidth));
  inscribedHeight = Math.max(1, Math.floor(inscribedHeight));
  
  return { 
    width: inscribedWidth, 
    height: inscribedHeight,
    scale: Math.max(0.1, scale)
  };
}

/**
 * Get the effective dimensions for crop calculations, accounting for rotation.
 * Returns the inscribed rectangle dimensions if rotation is applied.
 */
function getEffectiveCropDimensions() {
  const { naturalWidth, naturalHeight, rotation } = editState;
  if (!naturalWidth || !naturalHeight) return { width: 0, height: 0, scale: 1 };
  
  return getInscribedDimensions(naturalWidth, naturalHeight, rotation);
}

function initImageEditor() {
  if (editControls) return;

  const modalImage = document.getElementById('modal-image');
  const toolbar = document.getElementById('image-edit-toolbar');
  const stage = document.getElementById('modal-image-stage');
  if (!modalImage || !toolbar || !stage) return;

  editControls = {
    modalImage,
    stage,
    toolbar: {
      root: toolbar,
      editBtn: document.getElementById('toolbar-edit-btn'),
      applyBtn: document.getElementById('toolbar-apply-btn'),
      cancelBtn: document.getElementById('toolbar-cancel-btn'),
      showTvBtn: document.getElementById('modal-show-tv-btn'),
      toolButtons: Array.from(toolbar.querySelectorAll('.toolbar-icon-btn[data-tool]')),
      toolGroup: toolbar.querySelector('.toolbar-group-tools'),
      divider: toolbar.querySelector('.toolbar-divider'),
      previewToggleBtn: document.getElementById('toolbar-preview-toggle-btn')
    },
    revertBtn: document.getElementById('revert-original-btn'),
    popovers: {
      container: document.getElementById('edit-popover-container'),
      adjustments: document.getElementById('adjustments-popover'),
      filters: document.getElementById('filters-popover'),
      crop: document.getElementById('crop-popover')
    },
    adjustments: {
      brightnessInput: document.getElementById('adjust-brightness'),
      contrastInput: document.getElementById('adjust-contrast'),
      brightnessValue: document.getElementById('adjust-brightness-value'),
      contrastValue: document.getElementById('adjust-contrast-value'),
      hueInput: document.getElementById('adjust-hue'),
      saturationInput: document.getElementById('adjust-saturation'),
      lightnessInput: document.getElementById('adjust-lightness'),
      hueValue: document.getElementById('adjust-hue-value'),
      saturationValue: document.getElementById('adjust-saturation-value'),
      lightnessValue: document.getElementById('adjust-lightness-value')
    },
    filters: {
      chips: Array.from(document.querySelectorAll('#filter-chip-row .filter-chip'))
    },
    crop: {
      overlay: document.getElementById('crop-overlay'),
      box: document.getElementById('crop-box'),
      handles: Array.from(document.querySelectorAll('#crop-box .crop-handle')),
      presetButtons: Array.from(document.querySelectorAll('#crop-popover .crop-preset')),
      warning: document.getElementById('crop-upsampling-warning')
    },
    rotation: {
      slider: document.getElementById('rotation-slider'),
      zeroBtn: document.getElementById('rotation-zero-btn')
    }
  };

  // Hide legacy edit panel elements
  document.getElementById('modal-edit-panel')?.classList.add('hidden');
  document.getElementById('open-edit-panel-btn')?.classList.add('hidden');
  document.querySelector('.image-edit-entry')?.classList.add('hidden');

  editControls.toolbar.editBtn?.addEventListener('click', () => {
    if (!currentImage) {
      setToolbarStatus('Open an image to start editing.', 'error');
      return;
    }
    if (editState.active) {
      return;
    }
    enterEditMode();
  });

  editControls.toolbar.applyBtn?.addEventListener('click', submitImageEdits);
  editControls.toolbar.cancelBtn?.addEventListener('click', cancelEdits);
  editControls.toolbar.previewToggleBtn?.addEventListener('click', () => {
    if (!editState.active) {
      return;
    }
    setPreviewEnabled(!editState.previewEnabled);
  });
  editControls.revertBtn?.addEventListener('click', revertImageToOriginal);
  editControls.revertBtn?.classList.add('hidden');

  editControls.toolbar.toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!editState.active) return;
      setActiveTool(btn.dataset.tool);
    });
  });

  editControls.adjustments.brightnessInput?.addEventListener('input', handleAdjustmentInput);
  editControls.adjustments.contrastInput?.addEventListener('input', handleAdjustmentInput);
  editControls.adjustments.hueInput?.addEventListener('input', handleAdjustmentInput);
  editControls.adjustments.saturationInput?.addEventListener('input', handleAdjustmentInput);
  editControls.adjustments.lightnessInput?.addEventListener('input', handleAdjustmentInput);

  editControls.filters.chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (!editState.active) return;
      selectFilter(chip.dataset.filter || 'none');
    });
  });

  editControls.crop.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!editState.active) return;
      selectCropPreset(btn.dataset.crop || 'free');
    });
  });

  // Rotation slider event handlers
  editControls.rotation.slider?.addEventListener('input', handleRotationInput);
  editControls.rotation.zeroBtn?.addEventListener('click', resetRotation);

  // Prevent text/image selection during crop interactions
  const preventSelection = (e) => e.preventDefault();
  
  editControls.crop.box?.addEventListener('pointerdown', (event) => {
    if (!editState.active || editState.activeTool !== 'crop') return;
    // Only handle move if the target is the box itself, not a handle
    if (event.target.classList.contains('crop-handle')) return;
    startCropInteraction('move', 'move', event);
  });

  editControls.crop.handles.forEach(handle => {
    handle.addEventListener('pointerdown', (event) => {
      if (!editState.active || editState.activeTool !== 'crop') return;
      // Stop propagation immediately to prevent box from also receiving the event
      event.stopPropagation();
      startCropInteraction('resize', handle.dataset.handle, event);
    });
  });

  // Prevent selection on the modal image during any crop interaction
  modalImage.addEventListener('selectstart', preventSelection);
  modalImage.addEventListener('dragstart', preventSelection);

  // Prevent iOS Safari back gesture during crop interactions
  document.addEventListener('touchmove', (e) => {
    if (cropInteraction && e.touches.length === 1) {
      e.preventDefault();
    }
  }, { passive: false });

  modalImage.addEventListener('load', handleModalImageLoad);
  modalImage.addEventListener('error', handleModalImageError);
  window.addEventListener('resize', () => {
    if (editState.active) {
      updateCropOverlay();
    }
  });

  updateAdjustmentUI();
  updateFilterButtons(editState.filter);
  updateCropPresetButtons(editState.cropPreset);
  updateRotationUI();
  updateToolbarState();
  applyPreviewFilters();
}

function handleModalImageLoad() {
  if (!editControls?.modalImage) return;
  const img = editControls.modalImage;
  delete img.dataset.loadRetries;
  if (img.naturalWidth && img.naturalHeight) {
    editState.naturalWidth = img.naturalWidth;
    editState.naturalHeight = img.naturalHeight;
  }
  updateCropOverlay();
  if (editState.active && editState.activeTool === 'crop') {
    setActiveTool('crop', { force: true, silent: true });
  }
  applyPreviewFilters();
}

function handleModalImageError() {
  if (!editControls?.modalImage || !currentImage) return;
  const img = editControls.modalImage;
  const retries = Number(img.dataset.loadRetries || 0);

  if (retries >= 4) {
    setToolbarStatus('Preview failed to load. Close and reopen the modal to retry.', 'error');
    return;
  }

  img.dataset.loadRetries = String(retries + 1);
  const delay = 150 * (retries + 1);
  setTimeout(() => {
    reloadModalImage(Date.now() + retries + 1);
  }, delay);
}

function resetEditState(options = {}) {
  const {
    hasBackup = false,
    keepActive = false,
    keepPreset = false,
    keepDimensions = true,
    restoreTool = false,
    silent = false,
    initialPreset = null
  } = options;

  const previousTool = editState.activeTool;
  const previousPreset = editState.cropPreset;
  const preservedWidth = keepDimensions ? editState.naturalWidth : 0;
  const preservedHeight = keepDimensions ? editState.naturalHeight : 0;

  editState = createDefaultEditState();
  editState.hasBackup = hasBackup;
  if (keepDimensions) {
    editState.naturalWidth = preservedWidth;
    editState.naturalHeight = preservedHeight;
  }
  if (keepActive) {
    editState.active = true;
    if (restoreTool && previousTool) {
      editState.activeTool = previousTool;
    }
  }
  let targetPreset = null;
  if (keepPreset && previousPreset) {
    targetPreset = previousPreset;
  } else if (initialPreset) {
    targetPreset = initialPreset;
  }
  if (targetPreset) {
    editState.cropPreset = targetPreset;
    editState.targetResolution = getPresetTargetResolution(targetPreset);
  }

  editState.userSelectedCropPreset = false;
  editState.autoPresetApplied = false;

  editState.isDirty = false;

  updateAdjustmentUI();
  updateFilterButtons(editState.filter);
  updateCropPresetButtons(editState.cropPreset);
  updateRotationUI();
  applyRotationPreview();
  updateCropOverlay();
  updateToolbarState();
  if (!silent) {
    clearToolbarStatus();
  }
  if (editState.active && editState.activeTool) {
    setActiveTool(editState.activeTool, { force: true, silent: true });
  }
  applyPreviewFilters();
}

function updateToolbarState() {
  if (!editControls?.toolbar) return;
  const { editBtn, applyBtn, cancelBtn, toolButtons, previewToggleBtn, showTvBtn } = editControls.toolbar;
  const isActive = editState.active;
  const isMobile = window.innerWidth <= 768;
  
  // Add class to toolbar for CSS styling
  const toolbar = document.getElementById('image-edit-toolbar');
  if (toolbar) {
    toolbar.classList.toggle('editing-mode', isActive);
  }

  if (showTvBtn) {
    showTvBtn.classList.toggle('hidden', isActive);
  }

  if (editBtn) {
    const shouldDisable = !currentImage || isActive;
    editBtn.disabled = shouldDisable;
    editBtn.textContent = 'Edit';
    if (shouldDisable) {
      editBtn.setAttribute('aria-disabled', 'true');
    } else {
      editBtn.removeAttribute('aria-disabled');
    }
    // Hide Edit button on mobile when in edit mode
    if (isMobile) {
      editBtn.classList.toggle('hidden', isActive);
    }
  }

  if (editControls.toolbar.toolGroup) {
    editControls.toolbar.toolGroup.classList.toggle('hidden', !isActive);
  }

  if (editControls.toolbar.divider) {
    editControls.toolbar.divider.classList.toggle('hidden', !isActive);
  }

  if (previewToggleBtn) {
    const wasDisabled = previewToggleBtn.disabled;
    previewToggleBtn.disabled = !isActive;
    if (!isActive && !editState.previewEnabled) {
      setPreviewEnabled(true, { silent: true, force: true });
    } else if (!wasDisabled || isActive) {
      updatePreviewToggleUI();
    }
  }

  toolButtons?.forEach(btn => {
    const isCurrent = editState.activeTool === btn.dataset.tool;
    btn.disabled = !isActive;
    btn.classList.toggle('active', isActive && isCurrent);
  });

  if (cancelBtn) {
    cancelBtn.disabled = !isActive;
    cancelBtn.classList.toggle('hidden', !isActive);
  }
  if (applyBtn) {
    applyBtn.disabled = !isActive || !editState.isDirty;
    applyBtn.classList.toggle('hidden', !isActive);
  }
  if (editControls.revertBtn) {
    const hasBackup = !!editState.hasBackup;
    const showRevert = hasBackup && !isActive;
    editControls.revertBtn.disabled = !hasBackup;
    editControls.revertBtn.classList.toggle('hidden', !showRevert);
  }

  if (editControls.popovers?.container) {
    editControls.popovers.container.classList.toggle('hidden', !isActive);
  }

  if (!isActive) {
    hidePopovers();
  }
}

function setToolbarStatus(message, type = 'info') {
  if (!editControls?.toolbar?.status) return;
  const el = editControls.toolbar.status;
  el.textContent = message || '';
  el.classList.remove('error', 'success');
  if (!message) return;
  if (type === 'error') {
    el.classList.add('error');
  } else if (type === 'success') {
    el.classList.add('success');
  }
}

function clearToolbarStatus() {
  setToolbarStatus('');
}

function enterEditMode() {
  if (!editControls) return;
  editState.active = true;
  setPreviewEnabled(true, { silent: true, force: true });
  document.body.classList.add('editing-active');
  if (!editState.naturalWidth || !editState.naturalHeight) {
    const img = editControls.modalImage;
    if (img?.naturalWidth && img.naturalHeight) {
      editState.naturalWidth = img.naturalWidth;
      editState.naturalHeight = img.naturalHeight;
    }
  }
  updateToolbarState();
  
  // On mobile, auto-activate crop tool when entering edit mode
  const isMobile = window.innerWidth <= 768;
  if (isMobile && !editState.activeTool) {
    setActiveTool('crop', { force: true, silent: true });
  } else if (editState.activeTool) {
    setActiveTool(editState.activeTool, { force: true, silent: true });
  } else {
    hidePopovers();
    editControls.toolbar.toolButtons?.forEach(btn => btn.classList.remove('active'));
  }
  updateCropOverlay();
  applyPreviewFilters();
}

function exitEditMode(options = {}) {
  const { resetState = false } = options;
  if (!editControls) return;
  editState.active = false;
  setPreviewEnabled(true, { silent: true, force: true });
  document.body.classList.remove('editing-active');
  editState.activeTool = null;
  hidePopovers();
  updateToolbarState();
  updateCropOverlay();
  applyPreviewFilters();
  if (resetState) {
    const refreshedPreset = detectInitialCropPreset(allImages[currentImage]);
    resetEditState({ hasBackup: editState.hasBackup, keepDimensions: true, silent: true, initialPreset: refreshedPreset });
  }
}

function cancelEdits() {
  const hasBackup = editState.hasBackup;
  resetEditState({ hasBackup, keepDimensions: true });
  exitEditMode();
}

function setActiveTool(tool, options = {}) {
  if (!editControls?.toolbar) return;
  const { force = false, silent = false } = options;
  if (!editState.active) return;

  if (!tool) {
    editState.activeTool = null;
    editControls.toolbar.toolButtons.forEach(btn => btn.classList.remove('active'));
    hidePopovers();
    updateCropOverlay();
    return;
  }

  if (!force && editState.activeTool === tool) {
    editState.activeTool = null;
    hidePopovers();
    updateToolbarState();
    updateCropOverlay();
    return;
  }

  editState.activeTool = tool;
  editControls.toolbar.toolButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  showPopover(tool);
  if (tool === 'crop') {
    autoSelectCropPresetForCurrentImage();
  }
  updateCropOverlay();

  if (!silent) {
    if (tool === 'crop') {
      setToolbarStatus('Drag the handles or choose a preset to crop.');
    } else if (tool === 'adjust') {
      setToolbarStatus('Adjust brightness or contrast.');
    } else if (tool === 'filter') {
      setToolbarStatus('Pick a filter to preview.');
    }
  }
}

function showPopover(tool) {
  if (!editControls?.popovers) return;
  const { adjustments, filters, crop } = editControls.popovers;
  adjustments?.classList.add('hidden');
  filters?.classList.add('hidden');
  crop?.classList.add('hidden');

  if (tool === 'adjust') {
    adjustments?.classList.remove('hidden');
  } else if (tool === 'filter') {
    filters?.classList.remove('hidden');
  } else if (tool === 'crop') {
    crop?.classList.remove('hidden');
  }
}

function hidePopovers() {
  if (!editControls?.popovers) return;
  editControls.popovers.adjustments?.classList.add('hidden');
  editControls.popovers.filters?.classList.add('hidden');
  editControls.popovers.crop?.classList.add('hidden');
}

function updatePreviewToggleUI() {
  const btn = editControls?.toolbar?.previewToggleBtn;
  if (!btn) return;
  const previewOff = !editState.previewEnabled;
  btn.classList.toggle('preview-off', previewOff);
  btn.setAttribute('aria-pressed', previewOff ? 'true' : 'false');
  btn.title = previewOff ? 'Show Preview' : 'Hide Preview';
}

function setPreviewEnabled(enabled, options = {}) {
  const { silent = false, force = false } = options;
  if (!force && editState.previewEnabled === enabled) {
    updatePreviewToggleUI();
    return;
  }
  editState.previewEnabled = enabled;
  updatePreviewToggleUI();
  if (!silent) {
    if (enabled) {
      clearToolbarStatus();
    } else {
      setToolbarStatus('Preview hidden. Toggle the eye to view edits.', 'info');
    }
  }
  applyPreviewFilters();
  updateCropOverlay();
}

function handleAdjustmentInput(event) {
  const input = event.target;
  const value = Number(input.value) || 0;
  if (input.id === 'adjust-brightness') {
    editState.adjustments.brightness = value;
  } else if (input.id === 'adjust-contrast') {
    editState.adjustments.contrast = value;
  } else if (input.id === 'adjust-hue') {
    editState.adjustments.hue = clamp(value, -180, 180);
  } else if (input.id === 'adjust-saturation') {
    editState.adjustments.saturation = clamp(value, -100, 100);
  } else if (input.id === 'adjust-lightness') {
    editState.adjustments.lightness = clamp(value, -100, 100);
  }
  updateAdjustmentUI();
  markEditsDirty();
  applyPreviewFilters();
}

function updateAdjustmentUI() {
  if (!editControls?.adjustments) return;
  const {
    brightnessInput,
    contrastInput,
    hueInput,
    saturationInput,
    lightnessInput,
    brightnessValue,
    contrastValue,
    hueValue,
    saturationValue,
    lightnessValue
  } = editControls.adjustments;
  if (brightnessInput) {
    brightnessInput.value = editState.adjustments.brightness;
  }
  if (contrastInput) {
    contrastInput.value = editState.adjustments.contrast;
  }
  if (hueInput) {
    hueInput.value = editState.adjustments.hue;
  }
  if (saturationInput) {
    saturationInput.value = editState.adjustments.saturation;
  }
  if (lightnessInput) {
    lightnessInput.value = editState.adjustments.lightness;
  }
  if (brightnessValue) {
    brightnessValue.textContent = editState.adjustments.brightness;
  }
  if (contrastValue) {
    contrastValue.textContent = editState.adjustments.contrast;
  }
  if (hueValue) {
    hueValue.textContent = `${editState.adjustments.hue}°`;
  }
  if (saturationValue) {
    saturationValue.textContent = editState.adjustments.saturation;
  }
  if (lightnessValue) {
    lightnessValue.textContent = editState.adjustments.lightness;
  }
}

function handleRotationInput(event) {
  if (!editState.active) return;
  const value = Number(event.target.value) || 0;
  editState.rotation = clamp(value, -45, 45);
  updateRotationUI();
  markEditsDirty();
  applyRotationPreview();
  updateCropOverlay();
}

function resetRotation() {
  if (!editState.active) return;
  editState.rotation = 0;
  // Reset crop to full image since rotation constraint is removed
  editState.crop = { top: 0, right: 0, bottom: 0, left: 0 };
  updateRotationUI();
  markEditsDirty();
  applyRotationPreview();
  updateCropOverlay();
}

function updateRotationUI() {
  if (!editControls?.rotation) return;
  const { slider, zeroBtn } = editControls.rotation;
  
  if (slider) {
    slider.value = editState.rotation;
  }
  if (zeroBtn) {
    const isZero = Math.abs(editState.rotation) < 0.25;
    zeroBtn.classList.toggle('active', isZero);
    // Show current value in button, or "0°" when at zero
    if (isZero) {
      zeroBtn.textContent = '0°';
    } else {
      // Format: show 1 decimal if half-degree, otherwise integer
      const val = editState.rotation;
      const isHalf = Math.abs(val - Math.round(val)) > 0.1;
      zeroBtn.textContent = isHalf ? `${val.toFixed(1)}°` : `${Math.round(val)}°`;
    }
  }
}

function applyRotationPreview() {
  if (!editControls?.modalImage || !editControls?.stage) return;
  
  const img = editControls.modalImage;
  const stage = editControls.stage;
  const rotation = editState.rotation || 0;
  
  if (Math.abs(rotation) < 0.01) {
    // No rotation - reset transforms
    img.style.transform = '';
    stage.style.overflow = '';
  } else {
    // Apply rotation - black corners will be visible
    img.style.transform = `rotate(${rotation}deg)`;
    stage.style.overflow = 'visible';
  }
  
  // Constrain crop box to stay within the inscribed (valid) region
  constrainCropToInscribedRegion();
}

/**
 * Get the valid crop region as percentage bounds based on current rotation.
 * When rotated, the valid region is the inscribed rectangle (no black corners).
 * Returns { minLeft, minTop, maxRight, maxBottom } as percentages.
 */
function getValidCropRegion() {
  const rotation = editState.rotation || 0;
  
  if (Math.abs(rotation) < 0.01) {
    // No rotation - entire image is valid
    return { minLeft: 0, minTop: 0, maxRight: 0, maxBottom: 0 };
  }
  
  const { naturalWidth, naturalHeight } = editState;
  if (!naturalWidth || !naturalHeight) {
    return { minLeft: 0, minTop: 0, maxRight: 0, maxBottom: 0 };
  }
  
  const inscribed = getInscribedDimensions(naturalWidth, naturalHeight, rotation);
  
  // Calculate how much smaller the inscribed rectangle is as a ratio
  const widthRatio = inscribed.width / naturalWidth;
  const heightRatio = inscribed.height / naturalHeight;
  
  // The inscribed rectangle is centered, so margins are equal on both sides
  const marginX = (1 - widthRatio) / 2 * 100;
  const marginY = (1 - heightRatio) / 2 * 100;
  
  return {
    minLeft: marginX,
    minTop: marginY,
    maxRight: marginX,
    maxBottom: marginY
  };
}

/**
 * Constrain the current crop insets to stay within the valid inscribed region.
 * Called when rotation changes.
 * 
 * Crop insets represent how much is cut off each edge (0 = no crop, 50 = half cut).
 * When rotated, the minimum insets must be at least the inscribed bounds to avoid
 * showing black corners.
 */
function constrainCropToInscribedRegion() {
  const bounds = getValidCropRegion();
  const { crop } = editState;
  
  let needsUpdate = false;
  const newCrop = { ...crop };
  
  // Ensure crop insets are at least as large as the inscribed bounds
  // (crop.left < bounds.minLeft means the crop extends into black region)
  if (crop.left < bounds.minLeft) {
    newCrop.left = bounds.minLeft;
    needsUpdate = true;
  }
  if (crop.top < bounds.minTop) {
    newCrop.top = bounds.minTop;
    needsUpdate = true;
  }
  if (crop.right < bounds.maxRight) {
    newCrop.right = bounds.maxRight;
    needsUpdate = true;
  }
  if (crop.bottom < bounds.maxBottom) {
    newCrop.bottom = bounds.maxBottom;
    needsUpdate = true;
  }
  
  if (needsUpdate) {
    // Force immediate visual update
    editState.crop = newCrop;
    updateCropOverlay();
  }
}

function selectFilter(name, options = {}) {
  const filterName = normalizeEditingFilterName(name);
  editState.filter = filterName;
  updateFilterButtons(filterName);
  if (!options.silent) {
    markEditsDirty();
  }
  applyPreviewFilters();
}

function updateFilterButtons(activeFilter) {
  if (!editControls?.filters?.chips) return;
  editControls.filters.chips.forEach(chip => {
  const chipFilter = normalizeEditingFilterName(chip.dataset.filter || 'none');
    chip.classList.toggle('active', chipFilter === activeFilter);
  });
}

function selectCropPreset(preset, options = {}) {
  const { silent = false, suppressUserTracking = false } = options;
  editState.cropPreset = preset;
  editState.targetResolution = getPresetTargetResolution(preset);
  if (!suppressUserTracking) {
    editState.userSelectedCropPreset = true;
  }
  updateCropPresetButtons(preset);
  applyCropPreset(preset, { silent });
  updateUpsamplingWarning();
  if (!silent) {
    markEditsDirty();
  }
}

function updateCropPresetButtons(activePreset) {
  if (!editControls?.crop?.presetButtons) return;
  editControls.crop.presetButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.crop === activePreset);
  });
}

function getPresetRatio(preset) {
  if (preset === 'original') {
    if (editState.naturalWidth && editState.naturalHeight) {
      return editState.naturalWidth / editState.naturalHeight;
    }
    return null;
  }
  return CROP_PRESET_RATIOS[preset] || null;
}

function getPresetTargetResolution(preset) {
  const detail = CROP_PRESET_DETAILS[preset];
  if (!detail?.targetResolution) {
    return null;
  }
  const { width, height } = detail.targetResolution;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return {
    width,
    height
  };
}

function isZeroCropInsets(insets = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
  return (
    Math.abs(top) <= CROP_INSET_EPSILON &&
    Math.abs(right) <= CROP_INSET_EPSILON &&
    Math.abs(bottom) <= CROP_INSET_EPSILON &&
    Math.abs(left) <= CROP_INSET_EPSILON
  );
}

function determinePresetForDimensions(width, height) {
  const roundedWidth = Math.round(Number(width) || 0);
  const roundedHeight = Math.round(Number(height) || 0);

  if (roundedWidth <= 0 || roundedHeight <= 0) {
    return null;
  }

  if (roundedWidth === 3840 && roundedHeight === 2160) {
    return '16:9sam';
  }

  const aspect = roundedWidth / roundedHeight;
  let bestPreset = null;
  let bestDiff = Infinity;

  for (const [preset, presetRatio] of Object.entries(CROP_PRESET_RATIOS)) {
    if (preset === '16:9sam') {
      continue; // Only select 16:9sam on exact resolution match
    }
    const diff = Math.abs(aspect - presetRatio);
    if (diff < bestDiff && diff <= CROP_PRESET_MATCH_TOLERANCE) {
      bestDiff = diff;
      bestPreset = preset;
    }
  }

  return bestPreset;
}

function getNaturalDimensions() {
  const imageData = currentImage ? allImages[currentImage] : null;
  const width = editState.naturalWidth || imageData?.dimensions?.width || 0;
  const height = editState.naturalHeight || imageData?.dimensions?.height || 0;
  return {
    width,
    height
  };
}

function calculateCropOutputSize() {
  // Use effective dimensions that account for rotation
  const effectiveDims = getEffectiveCropDimensions();
  const naturalWidth = effectiveDims.width;
  const naturalHeight = effectiveDims.height;
  if (!naturalWidth || !naturalHeight) {
    return { width: 0, height: 0 };
  }

  const widthPercent = Math.max(MIN_CROP_PERCENT, 100 - editState.crop.left - editState.crop.right);
  const heightPercent = Math.max(MIN_CROP_PERCENT, 100 - editState.crop.top - editState.crop.bottom);

  const outputWidth = Math.round((widthPercent / 100) * naturalWidth);
  const outputHeight = Math.round((heightPercent / 100) * naturalHeight);

  return {
    width: Math.max(1, outputWidth),
    height: Math.max(1, outputHeight)
  };
}

function shouldShowUpsamplingWarning() {
  if (editState.cropPreset !== '16:9sam') {
    return false;
  }

  const target = getPresetTargetResolution(editState.cropPreset);
  if (!target) {
    return false;
  }

  const { width, height } = calculateCropOutputSize();
  if (!width || !height) {
    return false;
  }

  return width < target.width || height < target.height;
}

function updateUpsamplingWarning() {
  const warningEl = editControls?.crop?.warning;
  if (!warningEl) {
    return;
  }

  if (!editState.active || editState.activeTool !== 'crop') {
    warningEl.style.display = 'none';
    return;
  }

  if (shouldShowUpsamplingWarning()) {
    warningEl.style.display = 'flex';
  } else {
    warningEl.style.display = 'none';
  }
}

function autoSelectCropPresetForCurrentImage() {
  if (!currentImage) {
    return;
  }

  if (editState.autoPresetApplied || editState.userSelectedCropPreset) {
    return;
  }

  const hasCustomCrop = !isZeroCropInsets(editState.crop);
  if (hasCustomCrop) {
    editState.autoPresetApplied = true;
    return;
  }

  const imageData = allImages[currentImage];
  const width = editState.naturalWidth || imageData?.dimensions?.width;
  const height = editState.naturalHeight || imageData?.dimensions?.height;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return;
  }

  const candidate = determinePresetForDimensions(width, height);
  editState.autoPresetApplied = true;

  if (!candidate || candidate === editState.cropPreset) {
    return;
  }

  selectCropPreset(candidate, { silent: true, suppressUserTracking: true });
}

function applyCropPreset(preset, options = {}) {
  const { silent = false } = options;
  if (preset === 'free') {
    updateCropOverlay();
    if (!silent) {
      markEditsDirty();
    }
    return;
  }

  const ratio = getPresetRatio(preset);
  if (!ratio) {
    updateCropOverlay();
    return;
  }

  const insets = computeInsetsForRatio(ratio);
  setCropInsets(insets, { silent: true });
  if (!silent) {
    markEditsDirty();
  }
}

function computeInsetsForRatio(ratio) {
  const naturalWidth = editState.naturalWidth || 1;
  const naturalHeight = editState.naturalHeight || 1;
  const naturalRatio = naturalWidth / naturalHeight || 1;

  let widthPercent = 100;
  let heightPercent = 100;

  if (naturalRatio >= ratio) {
    heightPercent = 100;
    widthPercent = clamp((ratio / naturalRatio) * 100, MIN_CROP_PERCENT, 100);
  } else {
    widthPercent = 100;
    heightPercent = clamp((naturalRatio / ratio) * 100, MIN_CROP_PERCENT, 100);
  }

  const horizontalInset = (100 - widthPercent) / 2;
  const verticalInset = (100 - heightPercent) / 2;

  return clampInsets({
    top: verticalInset,
    bottom: verticalInset,
    left: horizontalInset,
    right: horizontalInset
  });
}

function setCropInsets(insets, options = {}) {
  const { silent = false, skipNormalize = false } = options;
  let next = clampInsets(insets);
  const ratio = getPresetRatio(editState.cropPreset);
  if (ratio && !skipNormalize) {
    next = normalizeInsetsForRatio(next, ratio);
  }
  editState.crop = next;
  updateCropOverlay();
  updateUpsamplingWarning();
  if (!silent) {
    markEditsDirty();
  }
}

function clampInsets(insets) {
  let { top, right, bottom, left } = insets;
  
  // Get rotation-based bounds (0 if no rotation)
  const bounds = getValidCropRegion();

  // Clamp to valid region (respects rotation inscribed area)
  top = clamp(top, bounds.minTop, 100);
  bottom = clamp(bottom, bounds.maxBottom, 100);
  left = clamp(left, bounds.minLeft, 100);
  right = clamp(right, bounds.maxRight, 100);

  // Calculate max available dimensions within valid region
  const maxAvailableWidth = 100 - bounds.minLeft - bounds.maxRight;
  const maxAvailableHeight = 100 - bounds.minTop - bounds.maxBottom;
  
  let width = 100 - left - right;
  if (width < MIN_CROP_PERCENT) {
    const shortfall = MIN_CROP_PERCENT - width;
    if (left >= right) {
      left = clamp(left - shortfall, bounds.minLeft, 100 - right - MIN_CROP_PERCENT);
    } else {
      right = clamp(right - shortfall, bounds.maxRight, 100 - left - MIN_CROP_PERCENT);
    }
    width = 100 - left - right;
  }

  let height = 100 - top - bottom;
  if (height < MIN_CROP_PERCENT) {
    const shortfall = MIN_CROP_PERCENT - height;
    if (top >= bottom) {
      top = clamp(top - shortfall, bounds.minTop, 100 - bottom - MIN_CROP_PERCENT);
    } else {
      bottom = clamp(bottom - shortfall, bounds.maxBottom, 100 - top - MIN_CROP_PERCENT);
    }
    height = 100 - top - bottom;
  }

  return { top, right, bottom, left };
}

function normalizeInsetsForRatio(insets, ratio) {
  if (!ratio || ratio <= 0) {
    return clampInsets(insets);
  }

  const naturalWidth = editState.naturalWidth || 1;
  const naturalHeight = editState.naturalHeight || 1;
  const naturalRatio = naturalWidth / naturalHeight || 1;

  const clamped = clampInsets(insets);
  let { top, right, bottom, left } = clamped;

  let widthPercent = Math.max(MIN_CROP_PERCENT, 100 - left - right);
  let heightPercent = Math.max(MIN_CROP_PERCENT, 100 - top - bottom);

  const actualRatio = (widthPercent / heightPercent) * naturalRatio;
  const adjustedDiff = actualRatio - ratio;

  if (Math.abs(adjustedDiff) <= CROP_RATIO_TOLERANCE) {
    return clamped;
  }

  const widthActual = (widthPercent / 100) * naturalWidth;
  const heightActual = (heightPercent / 100) * naturalHeight;

  const minWidthActual = (MIN_CROP_PERCENT / 100) * naturalWidth;
  const minHeightActual = (MIN_CROP_PERCENT / 100) * naturalHeight;

  const minHeightAllowed = Math.max(minHeightActual, minWidthActual / ratio);
  const maxHeightAllowed = Math.min(naturalHeight, naturalWidth / ratio);
  const minWidthAllowed = Math.max(minWidthActual, minHeightActual * ratio);
  const maxWidthAllowed = Math.min(naturalWidth, naturalHeight * ratio);

  let targetWidthActual;
  let targetHeightActual;

  if (adjustedDiff > 0) {
    const candidateHeight = clamp(widthActual / ratio, minHeightAllowed, maxHeightAllowed);
    targetHeightActual = candidateHeight;
    targetWidthActual = ratio * candidateHeight;
  } else {
    const candidateWidth = clamp(heightActual * ratio, minWidthAllowed, maxWidthAllowed);
    targetWidthActual = candidateWidth;
    targetHeightActual = candidateWidth / ratio;
  }

  targetWidthActual = clamp(targetWidthActual, minWidthAllowed, maxWidthAllowed);
  targetHeightActual = targetWidthActual / ratio;

  if (targetHeightActual < minHeightAllowed) {
    targetHeightActual = minHeightAllowed;
    targetWidthActual = ratio * targetHeightActual;
  } else if (targetHeightActual > maxHeightAllowed) {
    targetHeightActual = maxHeightAllowed;
    targetWidthActual = ratio * targetHeightActual;
  }

  const targetWidthPercent = clamp((targetWidthActual / naturalWidth) * 100, MIN_CROP_PERCENT, 100);
  const targetHeightPercent = clamp((targetHeightActual / naturalHeight) * 100, MIN_CROP_PERCENT, 100);

  const centerXPercent = left + widthPercent / 2;
  const centerYPercent = top + heightPercent / 2;

  const nextLeft = clamp(centerXPercent - targetWidthPercent / 2, 0, 100 - targetWidthPercent);
  const nextTop = clamp(centerYPercent - targetHeightPercent / 2, 0, 100 - targetHeightPercent);
  const nextRight = 100 - targetWidthPercent - nextLeft;
  const nextBottom = 100 - targetHeightPercent - nextTop;

  return {
    top: nextTop,
    right: nextRight,
    bottom: nextBottom,
    left: nextLeft
  };
}

function findPresetForAspectRatio(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return null;
  }

  let bestPreset = null;
  let bestDiff = Infinity;

  for (const [preset, presetRatio] of Object.entries(CROP_PRESET_RATIOS)) {
    if (preset === '16:9sam') {
      continue;
    }
    const diff = Math.abs(aspect - presetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestPreset = preset;
    }
  }

  if (bestPreset && bestDiff <= CROP_PRESET_MATCH_TOLERANCE) {
    return bestPreset;
  }

  return null;
}

function detectInitialCropPreset(imageData) {
  if (!imageData) {
    return 'free';
  }

  // If image has no crop applied (all insets are 0), use 'free' preset
  // This prevents aspect ratio enforcement when user hasn't cropped yet
  if (imageData.crop) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = imageData.crop;
    if (top === 0 && right === 0 && bottom === 0 && left === 0) {
      return 'free';
    }
  } else {
    return 'free';
  }

  const exactResolutionPreset = determinePresetForDimensions(
    imageData.dimensions?.width,
    imageData.dimensions?.height
  );
  if (exactResolutionPreset === '16:9sam') {
    return exactResolutionPreset;
  }

  const toNumeric = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  let ratio = toNumeric(imageData.aspectRatio);

  if (!Number.isFinite(ratio) && imageData.dimensions?.width && imageData.dimensions?.height) {
    ratio = imageData.dimensions.width / imageData.dimensions.height;
  }

  if (!Number.isFinite(ratio) && imageData.crop?.width && imageData.crop?.height) {
    ratio = imageData.crop.width / imageData.crop.height;
  }

  if (!Number.isFinite(ratio) && imageData.crop?.aspectRatio) {
    ratio = toNumeric(imageData.crop.aspectRatio);
  }

  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 'free';
  }

  const matchedPreset = findPresetForAspectRatio(ratio);
  if (matchedPreset) {
    return matchedPreset;
  }

  return 'free';
}

function updateCropOverlay() {
  if (!editControls?.crop?.overlay || !editControls.crop.box) return;
  const overlay = editControls.crop.overlay;
  const box = editControls.crop.box;

  const overlayVisible = editState.active;

  overlay.classList.toggle('hidden', !overlayVisible);
  overlay.classList.toggle('preview-muted', overlayVisible && !editState.previewEnabled);
  overlay.classList.toggle('active', overlayVisible && editState.activeTool === 'crop');

  const { top, right, bottom, left } = editState.crop;
  const widthPercent = Math.max(MIN_CROP_PERCENT, 100 - left - right);
  const heightPercent = Math.max(MIN_CROP_PERCENT, 100 - top - bottom);

  box.style.top = `${top}%`;
  box.style.left = `${left}%`;
  box.style.width = `${widthPercent}%`;
  box.style.height = `${heightPercent}%`;

  updateUpsamplingWarning();
}

function startCropInteraction(type, handle, event) {
  if (!editControls?.modalImage) return;
  event.preventDefault();
  event.stopPropagation();

  const rect = editControls.modalImage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  cropInteraction = {
    type,
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startInsets: { ...editState.crop },
    startWidth: 100 - editState.crop.left - editState.crop.right,
    startHeight: 100 - editState.crop.top - editState.crop.bottom,
    aspectRatio: getPresetRatio(editState.cropPreset),
    bounds: rect,
    pendingInsets: { ...editState.crop },
    targetElement: event.target // Save for releasing pointer capture
  };

  // Capture pointer to prevent text selection and ensure all events come to us
  try {
    event.target.setPointerCapture(event.pointerId);
  } catch (e) {
    console.error('Failed to capture pointer for crop interaction:', e);
  }

  editControls.crop.box.classList.add('dragging');
  document.addEventListener('pointermove', handleCropPointerMove);
  document.addEventListener('pointerup', handleCropPointerUp, { once: false });
  document.addEventListener('pointercancel', handleCropPointerUp, { once: false });
}

function handleCropPointerMove(event) {
  if (!cropInteraction) return;
  const { type, handle, startX, startY, startInsets, bounds, aspectRatio } = cropInteraction;
  const dx = ((event.clientX - startX) / bounds.width) * 100;
  const dy = ((event.clientY - startY) / bounds.height) * 100;
  
  // Get rotation-based bounds
  const validRegion = getValidCropRegion();

  let nextInsets = { ...startInsets };

  if (type === 'move') {
    const width = 100 - startInsets.left - startInsets.right;
    const height = 100 - startInsets.top - startInsets.bottom;

    // Constrain movement to valid region
    const maxLeft = 100 - validRegion.maxRight - width;
    const maxTop = 100 - validRegion.maxBottom - height;
    let newLeft = clamp(startInsets.left + dx, validRegion.minLeft, maxLeft);
    let newTop = clamp(startInsets.top + dy, validRegion.minTop, maxTop);
    const newRight = 100 - width - newLeft;
    const newBottom = 100 - height - newTop;

    nextInsets = clampInsets({ top: newTop, right: newRight, bottom: newBottom, left: newLeft });
  } else {
    let { top, right, bottom, left } = startInsets;

    // For handle resizing: 
    // - Min bound ensures we don't go into black region (validRegion.minXxx)
    // - Max bound ensures we keep minimum crop size
    if (handle.includes('w')) {
      // West handle: dragging right increases left inset, dragging left decreases it
      const maxLeft = 100 - right - MIN_CROP_PERCENT; // Can't make crop too small
      left = clamp(startInsets.left + dx, validRegion.minLeft, maxLeft);
    }
    if (handle.includes('e')) {
      // East handle: dragging left increases right inset, dragging right decreases it
      const maxRight = 100 - left - MIN_CROP_PERCENT;
      right = clamp(startInsets.right - dx, validRegion.maxRight, maxRight);
    }
    if (handle.includes('n')) {
      // North handle
      const maxTop = 100 - bottom - MIN_CROP_PERCENT;
      top = clamp(startInsets.top + dy, validRegion.minTop, maxTop);
    }
    if (handle.includes('s')) {
      // South handle
      const maxBottom = 100 - top - MIN_CROP_PERCENT;
      bottom = clamp(startInsets.bottom - dy, validRegion.maxBottom, maxBottom);
    }

    nextInsets = clampInsets({ top, right, bottom, left });

    if (aspectRatio) {
      nextInsets = enforceAspectRatio(nextInsets, handle, aspectRatio);
    }
  }

  cropInteraction.pendingInsets = nextInsets;
  // Skip normalization because enforceAspectRatio already handled it
  setCropInsets(nextInsets, { silent: true, skipNormalize: !!aspectRatio });
}

function handleCropPointerUp() {
  if (!cropInteraction) return;
  
  // Release pointer capture
  if (cropInteraction.targetElement && cropInteraction.pointerId !== undefined) {
    try {
      cropInteraction.targetElement.releasePointerCapture(cropInteraction.pointerId);
    } catch (e) {
      console.error('Failed to release pointer for crop interaction:', e);
    }
  }
  
  editControls?.crop?.box?.classList.remove('dragging');
  document.removeEventListener('pointermove', handleCropPointerMove);
  document.removeEventListener('pointerup', handleCropPointerUp, { once: false });
  document.removeEventListener('pointercancel', handleCropPointerUp, { once: false });

  const finalInsets = cropInteraction.pendingInsets || editState.crop;
  const aspectRatio = cropInteraction.aspectRatio;
  // Skip normalization if aspect ratio was already enforced during drag
  setCropInsets(finalInsets, { silent: false, skipNormalize: !!aspectRatio });

  cropInteraction = null;
}

function enforceAspectRatio(insets, handle, aspectRatio) {
  // Use effective dimensions that account for rotation
  const effectiveDims = getEffectiveCropDimensions();
  const naturalWidth = effectiveDims.width || 1;
  const naturalHeight = effectiveDims.height || 1;
  const naturalRatio = naturalWidth / naturalHeight || 1;

  let { top, right, bottom, left } = insets;
  let widthPercent = 100 - left - right;
  let heightPercent = 100 - top - bottom;

  if (widthPercent <= 0 || heightPercent <= 0) {
    return clampInsets(insets);
  }

  const centerX = left + widthPercent / 2;
  const centerY = top + heightPercent / 2;

  const actualRatio = (widthPercent / heightPercent) * naturalRatio;
  const ratioDiff = actualRatio - aspectRatio;
  const tolerance = CROP_RATIO_TOLERANCE;

  const applyWidth = (targetWidthPercent, anchor) => {
    targetWidthPercent = clamp(targetWidthPercent, MIN_CROP_PERCENT, 100);

    if (anchor === 'left') {
      right = clamp(100 - targetWidthPercent - left, 0, 100 - left - MIN_CROP_PERCENT);
    } else if (anchor === 'right') {
      left = clamp(100 - targetWidthPercent - right, 0, 100 - right - MIN_CROP_PERCENT);
    } else {
      const newLeft = clamp(centerX - targetWidthPercent / 2, 0, 100 - targetWidthPercent);
      left = newLeft;
      right = clamp(100 - targetWidthPercent - left, 0, 100 - left - MIN_CROP_PERCENT);
    }

    widthPercent = 100 - left - right;
  };

  const applyHeight = (targetHeightPercent, anchor) => {
    targetHeightPercent = clamp(targetHeightPercent, MIN_CROP_PERCENT, 100);

    if (anchor === 'top') {
      bottom = clamp(100 - targetHeightPercent - top, 0, 100 - top - MIN_CROP_PERCENT);
    } else if (anchor === 'bottom') {
      top = clamp(100 - targetHeightPercent - bottom, 0, 100 - bottom - MIN_CROP_PERCENT);
    } else {
      const newTop = clamp(centerY - targetHeightPercent / 2, 0, 100 - targetHeightPercent);
      top = newTop;
      bottom = clamp(100 - targetHeightPercent - top, 0, 100 - top - MIN_CROP_PERCENT);
    }

    heightPercent = 100 - top - bottom;
  };

  const cornerAnchors = {
    ne: { horizontal: 'left', vertical: 'bottom' },
    nw: { horizontal: 'right', vertical: 'bottom' },
    se: { horizontal: 'left', vertical: 'top' },
    sw: { horizontal: 'right', vertical: 'top' }
  };

  const isCornerHandle = Object.prototype.hasOwnProperty.call(cornerAnchors, handle);

  if (isCornerHandle) {
    const anchors = cornerAnchors[handle];

    if (ratioDiff > tolerance) {
      const targetWidthPercent = heightPercent * (aspectRatio / naturalRatio);
      applyWidth(targetWidthPercent, anchors.horizontal);
    } else if (ratioDiff < -tolerance) {
      const targetHeightPercent = widthPercent * (naturalRatio / aspectRatio);
      applyHeight(targetHeightPercent, anchors.vertical);
    }

    // If constraints prevented us from hitting the ratio exactly, fall back to adjusting the
    // opposite dimension so we stay as close as possible without drifting the anchored corner.
    widthPercent = 100 - left - right;
    heightPercent = 100 - top - bottom;
    const adjustedRatio = (widthPercent / heightPercent) * naturalRatio;
    const adjustedDiff = adjustedRatio - aspectRatio;

    if (adjustedDiff > tolerance) {
      const targetHeightPercent = widthPercent * (naturalRatio / aspectRatio);
      applyHeight(targetHeightPercent, anchors.vertical);
    } else if (adjustedDiff < -tolerance) {
      const targetWidthPercent = heightPercent * (aspectRatio / naturalRatio);
      applyWidth(targetWidthPercent, anchors.horizontal);
    }
  } else if (handle === 'n' || handle === 's') {
    const targetWidthPercent = heightPercent * (aspectRatio / naturalRatio);
    applyWidth(targetWidthPercent, 'center');

    widthPercent = 100 - left - right;
    heightPercent = 100 - top - bottom;
    const adjustedRatio = (widthPercent / heightPercent) * naturalRatio;
    const adjustedDiff = adjustedRatio - aspectRatio;

    if (Math.abs(adjustedDiff) > tolerance) {
      const targetHeightPercent = widthPercent * (naturalRatio / aspectRatio);
      const verticalAnchor = handle === 'n' ? 'bottom' : 'top';
      applyHeight(targetHeightPercent, verticalAnchor);
    }
  } else if (handle === 'e' || handle === 'w') {
    const targetHeightPercent = widthPercent * (naturalRatio / aspectRatio);
    applyHeight(targetHeightPercent, 'center');

    widthPercent = 100 - left - right;
    heightPercent = 100 - top - bottom;
    const adjustedRatio = (widthPercent / heightPercent) * naturalRatio;
    const adjustedDiff = adjustedRatio - aspectRatio;

    if (Math.abs(adjustedDiff) > tolerance) {
      const targetWidthPercent = heightPercent * (aspectRatio / naturalRatio);
      const horizontalAnchor = handle === 'w' ? 'right' : 'left';
      applyWidth(targetWidthPercent, horizontalAnchor);
    }
  }

  return clampInsets({ top, right, bottom, left });
}

function markEditsDirty() {
  editState.isDirty = true;
  updateToolbarState();
  clearToolbarStatus();
}

function applyPreviewFilters() {
  if (!editControls?.modalImage) return;
  const img = editControls.modalImage;
  if (!editState.active || !editState.previewEnabled) {
    img.style.filter = '';
    return;
  }

  const adjustments = editState.adjustments || {};
  const brightnessFactor = clamp(1 + (adjustments.brightness || 0) / 100, 0.1, 3);
  const lightnessFactor = clamp(1 + (adjustments.lightness || 0) / 100, 0.1, 3);
  const combinedBrightness = clamp(brightnessFactor * lightnessFactor, 0.1, 5).toFixed(3);
  const contrast = clamp(1 + (adjustments.contrast || 0) / 100, 0.1, 3).toFixed(3);
  const saturationFactor = clamp(1 + (adjustments.saturation || 0) / 100, 0.1, 5);
  const hueRotate = clamp(adjustments.hue || 0, -180, 180);

  const parts = [`brightness(${combinedBrightness})`, `contrast(${contrast})`];
  if (Math.abs(hueRotate) > 0.001) {
    parts.push(`hue-rotate(${hueRotate}deg)`);
  }
  if (Math.abs(adjustments.saturation || 0) > 0.001) {
    parts.push(`saturate(${saturationFactor.toFixed(3)})`);
  }

  const normalizedFilter = normalizeEditingFilterName(editState.filter);

  switch (normalizedFilter) {
    case 'sketch':
      parts.push('grayscale(1)', 'contrast(2.15)', 'brightness(1.15)', 'invert(0.05)');
      break;
    case 'oil-paint':
      parts.push('saturate(1.55)', 'contrast(1.18)', 'brightness(1.08)', 'blur(0.7px)');
      break;
    case 'watercolor':
      parts.push('saturate(1.35)', 'contrast(0.9)', 'brightness(1.12)', 'blur(1.15px)');
      break;
    case 'impressionist':
      parts.push('saturate(1.52)', 'contrast(1.12)', 'brightness(1.1)', 'blur(0.75px)');
      break;
    case 'pop-art':
      parts.push('saturate(2.4)', 'contrast(1.85)', 'brightness(1.05)');
      break;
    case 'art-deco':
      parts.push('sepia(0.45)', 'saturate(1.22)', 'contrast(1.22)');
      break;
    case 'neural-style':
      parts.push('saturate(1.85)', 'contrast(1.28)', 'hue-rotate(32deg)');
      break;
    case 'noir-cinema':
      parts.push('grayscale(1)', 'contrast(1.4)', 'brightness(0.95)');
      break;
    case 'silver-pearl':
      parts.push('grayscale(1)', 'brightness(1.08)', 'contrast(0.95)');
      break;
    case 'graphite-ink':
      parts.push('grayscale(1)', 'contrast(1.2)', 'brightness(1.02)');
      break;
    default:
      break;
  }

  img.style.filter = parts.join(' ');
}

function buildEditPayload() {
  const targetResolution = getPresetTargetResolution(editState.cropPreset);

  return {
    crop: { ...editState.crop },
    adjustments: { ...editState.adjustments },
    filter: editState.filter,
    rotation: editState.rotation || 0,
    cropPreset: editState.cropPreset,
    targetResolution
  };
}

/**
 * Check if there are any real edits (non-default values).
 * Returns false if all settings are at their defaults.
 */
function hasRealEdits() {
  // Check crop
  const { crop, adjustments, filter, rotation, cropPreset } = editState;
  const hasCrop = Object.values(crop).some(v => Math.abs(v) > 0.01);
  
  // Check rotation
  const hasRotation = Math.abs(rotation || 0) > 0.01;
  
  // Check adjustments
  const hasAdjustments = Object.values(adjustments).some(v => Math.abs(v) > 0.01);
  
  // Check filter
  const hasFilter = filter && filter !== 'none';
  
  // Check if 16:9SAM preset which forces resize
  const hasResizePreset = cropPreset === '16:9sam';
  
  return hasCrop || hasRotation || hasAdjustments || hasFilter || hasResizePreset;
}

async function submitImageEdits() {
  if (!currentImage || !editState.isDirty) {
    setToolbarStatus('Adjust settings before applying edits.', 'info');
    return;
  }

  // Check if there are actual changes (not just defaults)
  const hasActualEdits = hasRealEdits();
  if (!hasActualEdits) {
    // No real changes - treat as cancel
    cancelEdits();
    return;
  }

  const applyBtn = editControls?.toolbar?.applyBtn;
  if (applyBtn) {
    applyBtn.disabled = true;
  }
  setToolbarStatus('Applying edits...', 'info');

  try {
    const payload = buildEditPayload();
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to apply edits');
    }

  editState.hasBackup = true;
  editState.isDirty = false;

    // Set cache buster for this image's thumbnail
    thumbnailCacheBusters[currentImage] = Date.now();

    if (allImages[currentImage] && data.imageData) {
      // Update local cache with full response (includes updated timestamp)
      allImages[currentImage] = data.imageData;
    }

    setToolbarStatus('Edits applied. Sync when ready.', 'success');
    exitEditMode({ resetState: true });
    refreshModalImageAfterEdit();
  } catch (error) {
    console.error('Error applying edits:', error);
    setToolbarStatus(error.message || 'Failed to apply edits', 'error');
  } finally {
    if (applyBtn) {
      applyBtn.disabled = !editState.active || !editState.isDirty;
    }
    await updateSyncStatus();
  }
}

function refreshModalImageAfterEdit() {
  if (!currentImage) return;
  const bust = Date.now();
  reloadModalImage(bust);

  if (allImages[currentImage]) {
    renderModalResolutionFromMetadata(allImages[currentImage]);
  }

  loadGallery().catch(error => {
    console.error('Error refreshing gallery after edit:', error);
  });
}

function reloadModalImage(cacheBuster = Date.now()) {
  if (!editControls?.modalImage || !currentImage) return;
  editControls.modalImage.src = `library/${currentImage}?v=${cacheBuster}`;
}

async function loadEditStateForImage(filename) {
  if (!filename) return;
  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(filename)}/edit-state`);
    const data = await response.json();
    if (data.success) {
      editState.hasBackup = !!data.hasBackup;
      updateToolbarState();
    }
  } catch (error) {
    console.error('Error loading edit state:', error);
  }
}

async function revertImageToOriginal() {
  if (!currentImage) return;
  if (!confirm('Revert this image to the original version? This will discard current edits.')) {
    return;
  }

  if (editState.active) {
    cancelEdits();
  }

  setToolbarStatus('Reverting to original...', 'info');
  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}/revert`, {
      method: 'POST'
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to revert image');
    }

    editState.hasBackup = !!data.hasBackup;

    if (allImages[currentImage] && data.imageData) {
      // Update local cache with full response (includes updated timestamp)
      allImages[currentImage] = data.imageData;
    }

    resetEditState({ hasBackup: editState.hasBackup, keepDimensions: true, silent: true });
    updateToolbarState();
    refreshModalImageAfterEdit();
    setToolbarStatus('Reverted to original image.', 'success');

    await updateSyncStatus();
  } catch (error) {
    console.error('Error reverting image:', error);
    setToolbarStatus(error.message || 'Failed to revert image', 'error');
  }
}

function renderModalResolutionFromMetadata(imageData) {
  const resolutionEl = document.getElementById('modal-resolution');
  const aspectBadgeEl = document.getElementById('modal-aspect-badge');
  const fileSizeEl = document.getElementById('modal-file-size');

  if (!resolutionEl || !aspectBadgeEl) return;

  if (imageData?.dimensions?.width && imageData?.dimensions?.height) {
    const { width, height } = imageData.dimensions;
    const aspectRatio = imageData.aspectRatio || (width / height);
    const is16x9 = Math.abs(aspectRatio - 1.78) < 0.05;
    const fileSize = imageData.fileSize || 0;
    const fileSizeMB = fileSize / (1024 * 1024);
    
    // Check if image meets "sam" criteria: 3840x2160 and <= 20MB
    const isSam = width === 3840 && height === 2160 && fileSizeMB <= 20;
    
    resolutionEl.textContent = `${width} × ${height}`;
    
    let badgesHtml = '';
    if (isSam) {
      badgesHtml += '<span class="sam-badge-inline" title="Image resolution and size (<20MB) is correct target for Frame TVs">sam</span>';
    }
    if (is16x9) {
      badgesHtml += '<span class="aspect-badge-inline">16:9</span>';
    }
    aspectBadgeEl.innerHTML = badgesHtml;
  } else {
    resolutionEl.textContent = 'Unknown';
    aspectBadgeEl.innerHTML = '';
  }
  
  // Display file size
  if (fileSizeEl) {
    if (imageData?.fileSize) {
      fileSizeEl.textContent = formatFileSize(imageData.fileSize);
    } else {
      fileSizeEl.textContent = 'Unknown';
    }
  }
}

// Modal Functions
function initModal() {
  const modal = document.getElementById('image-modal');
  if (!modal) {
    console.warn('Image modal element not found; skipping modal initialization.');
    return;
  }

  const closeBtn = document.getElementById('image-modal-close');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const deleteBtn = document.getElementById('modal-delete-btn');
  const editFilenameBtn = document.getElementById('edit-filename-btn');
  const saveFilenameBtn = document.getElementById('save-filename-btn');
  const cancelFilenameBtn = document.getElementById('cancel-filename-btn');
  const addTagsBtn = document.getElementById('modal-add-tags-btn');
  const tagsInput = document.getElementById('modal-tags-input');
  const matteSelect = document.getElementById('modal-matte');
  const filterSelect = document.getElementById('modal-filter');
  const expandBtn = document.getElementById('expand-image-btn');

  const closeModalAndSync = async () => {
    if (editState.active) {
      cancelEdits();
    }
    modal.classList.remove('active');
    document.body.classList.remove('modal-open');
    renderGallery();
    resetEditState({ hasBackup: false, keepDimensions: false, silent: true });
    clearToolbarStatus();
    try {
      const status = await fetch(`${API_BASE}/sync/status`).then(r => r.json());
      if (status.success && status.status?.hasChanges) {
        await manualSync();
      }
    } catch (error) {
      console.error('Error checking sync status on modal close:', error);
    }
  };

  closeBtn?.addEventListener('click', closeModalAndSync);
  cancelBtn?.addEventListener('click', closeModalAndSync);

  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModalAndSync();
    }
  });

  // Mobile modal tab switching
  const modalContent = modal.querySelector('.modal-content');
  const mobileTabs = modal.querySelectorAll('.mobile-modal-tab');
  
  mobileTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.modalTab;
      
      // Update active tab button
      mobileTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update modal content data attribute to control visibility
      if (modalContent) {
        modalContent.dataset.mobileTab = targetTab;
      }
    });
  });

  // Create Show on TV button for mobile action row (next to Delete on left side)
  const modalActions = modal.querySelector('.modal-actions');
  const modalActionsLeft = modal.querySelector('.modal-actions-left');
  if (modalActionsLeft && window.matchMedia('(max-width: 768px)').matches) {
    // Create the Show on TV button for mobile
    const mobileShowTvAction = document.createElement('button');
    mobileShowTvAction.id = 'mobile-show-tv-action';
    mobileShowTvAction.className = 'btn-primary mobile-show-tv-action';
    mobileShowTvAction.textContent = 'Show on TV';
    modalActionsLeft.appendChild(mobileShowTvAction);
    
    // Wire up click handler (same as mobile-show-tv-btn)
    mobileShowTvAction.addEventListener('click', () => {
      const mobileShowTvBtn = document.getElementById('mobile-show-tv-btn');
      if (mobileShowTvBtn) {
        mobileShowTvBtn.click();
      }
    });
  }

  // Reset to preview tab when modal opens
  const originalOpenModal = window.openImageModal;
  if (typeof originalOpenModal === 'function') {
    window.openImageModal = function(...args) {
      // Reset to preview tab
      mobileTabs.forEach(t => t.classList.toggle('active', t.dataset.modalTab === 'preview'));
      if (modalContent) {
        modalContent.dataset.mobileTab = 'preview';
      }
      return originalOpenModal.apply(this, args);
    };
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteImage);
  }

  if (editFilenameBtn && saveFilenameBtn && cancelFilenameBtn) {
    editFilenameBtn.addEventListener('click', showEditFilenameForm);
    saveFilenameBtn.addEventListener('click', saveFilenameChange);
    cancelFilenameBtn.addEventListener('click', hideEditFilenameForm);
  } else {
    if (editFilenameBtn || saveFilenameBtn || cancelFilenameBtn) {
      console.warn('Incomplete filename editing controls detected; skipping filename editing bindings.');
    }
  }

  if (addTagsBtn) {
    addTagsBtn.addEventListener('click', addImageTags);
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      if (currentImage) {
        showFullScreenImage(currentImage);
      }
    });
  }

  // Stats link in modal - navigate to analytics page with this image selected
  const modalStatsLink = document.getElementById('modal-stats-link');
  if (modalStatsLink) {
    modalStatsLink.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentImage) {
        modal.classList.remove('active');
        window.location.hash = `#/analytics?image=${encodeURIComponent(currentImage)}`;
      }
    });
  }
  if (matteSelect) {
    matteSelect.addEventListener('change', saveImageChanges);
  }

  if (filterSelect) {
    filterSelect.addEventListener('change', saveImageChanges);
  }

  if (tagsInput) {
    tagsInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addImageTags();
      }
    });
  }

  initImageEditor();
}

function showFullScreenImage(filename) {
  // Create full-screen overlay
  const overlay = document.createElement('div');
  overlay.id = 'fullscreen-image-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: pointer;
  `;
  
  // Create image element
  const img = document.createElement('img');
  img.src = `library/${filename}`;
  img.style.cssText = `
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  `;
  
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  
  // Click anywhere to close
  overlay.onclick = () => {
    document.body.removeChild(overlay);
  };
  
  // ESC key to close
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('fullscreen-image-overlay')) {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', handleEsc);
      }
    }
  };
  document.addEventListener('keydown', handleEsc);
}

function openImageModal(filename) {
  const modal = document.getElementById('image-modal');
  const imageData = allImages[filename];
  
  currentImage = filename;

  if (!modal) {
    console.warn('Image modal not found; cannot open image modal view.');
    return;
  }

  // Hide bulk actions bar while modal is open (selection is preserved)
  const bulkActions = document.getElementById('bulk-actions');
  if (bulkActions) {
    bulkActions.classList.remove('visible');
  }

  // Set image
  const cacheBuster = Date.now();
  const modalImageEl = document.getElementById('modal-image');
  if (modalImageEl) {
    modalImageEl.src = `library/${filename}?v=${cacheBuster}`;
  }
  document.getElementById('modal-filename').textContent = getDisplayName(filename);
  document.getElementById('modal-actual-filename').textContent = filename;
  
  renderModalResolutionFromMetadata(imageData);

  // Set form values
  const metadataMatte = imageData.matte || METADATA_DEFAULT_MATTE;
  const metadataFilter = imageData.filter || METADATA_DEFAULT_FILTER;

  // Determine if image is portrait and update matte dropdown accordingly
  const imgWidth = imageData.dimensions?.width || 0;
  const imgHeight = imageData.dimensions?.height || 0;
  const isPortrait = imgHeight > imgWidth;
  updateMatteOptionsForOrientation('modal-matte', isPortrait, metadataMatte);

  document.getElementById('modal-matte').value = metadataMatte;
  document.getElementById('modal-filter').value = metadataFilter;

  if (allImages[currentImage]) {
    allImages[currentImage].matte = metadataMatte;
    allImages[currentImage].filter = metadataFilter;
  }

  selectFilter('none', { silent: true });
  
  // Render tag badges and TV tags helper
  renderImageTagBadges(imageData.tags || []);
  renderTvTagsHelper();

  exitEditMode();
  const initialPreset = detectInitialCropPreset(imageData);
  resetEditState({ hasBackup: false, keepDimensions: false, silent: true, initialPreset });
  
  // Load existing crop values if present
  if (imageData.crop && typeof imageData.crop === 'object') {
    const { top = 0, right = 0, bottom = 0, left = 0 } = imageData.crop;
    setCropInsets({ top, right, bottom, left }, { silent: true });
  }
  
  clearToolbarStatus();
  updateToolbarState();
  updateCropOverlay();
  applyPreviewFilters();

  loadEditStateForImage(filename);

  modal.classList.add('active');
  document.body.classList.add('modal-open');
}

function showEditFilenameForm() {
  const filenameContainer = document.querySelector('.modal-filename-container');
  const editForm = document.getElementById('edit-filename-form');
  const editInput = document.getElementById('edit-filename-input');
  
  // Extract just the base name (without UUID and extension)
  // currentImage format: basename-uuid.ext
  const ext = currentImage.substring(currentImage.lastIndexOf('.'));
  const nameWithoutExt = currentImage.substring(0, currentImage.lastIndexOf('.'));
  
  // Check if it has UUID pattern (dash followed by 8 hex chars at the end)
  const uuidPattern = /-[0-9a-f]{8}$/i;
  let baseName;
  
  if (uuidPattern.test(nameWithoutExt)) {
    // Extract base name without UUID
    baseName = nameWithoutExt.substring(0, nameWithoutExt.lastIndexOf('-'));
  } else {
    // No UUID found, use the name without extension
    baseName = nameWithoutExt;
  }
  
  editInput.value = baseName;
  
  // Hide the h3 and show the form
  filenameContainer.style.display = 'none';
  editForm.style.display = 'flex';
  editInput.focus();
  editInput.select();
}

function hideEditFilenameForm() {
  const filenameContainer = document.querySelector('.modal-filename-container');
  const editForm = document.getElementById('edit-filename-form');
  
  filenameContainer.style.display = 'flex';
  editForm.style.display = 'none';
}

async function saveFilenameChange() {
  if (!currentImage) return;
  
  const newBaseName = document.getElementById('edit-filename-input').value.trim();
  
  if (!newBaseName) {
    alert('Please enter a valid name');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newBaseName })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update current image reference
      currentImage = result.newFilename;
      
      // Reload gallery and refresh modal
      await loadGallery();
      
      // Update modal display
      document.getElementById('modal-filename').textContent = getDisplayName(result.newFilename);
      document.getElementById('modal-actual-filename').textContent = result.newFilename;
      document.getElementById('modal-image').src = `library/${result.newFilename}`;
      
      hideEditFilenameForm();
      
      // Update sync status since files changed
      await updateSyncStatus();
    } else {
      alert(result.error || 'Failed to rename image');
    }
  } catch (error) {
    console.error('Error renaming image:', error);
    alert('Failed to rename image');
  }
}

async function saveImageChanges() {
  if (!currentImage) return;

  const matte = document.getElementById('modal-matte').value || METADATA_DEFAULT_MATTE;
  const filter = document.getElementById('modal-filter').value || METADATA_DEFAULT_FILTER;

  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matte, filter })
    });

    const result = await response.json();

    if (result.success && result.data) {
      // Update local cache with full response (includes updated timestamp)
      allImages[currentImage] = result.data;
      
      // Don't reload gallery on every dropdown change - it causes visual jitter
      // Gallery will be reloaded when modal closes if there are changes
      
      // Update sync status since metadata changed
      await updateSyncStatus();
    }
  } catch (error) {
    console.error('Error saving changes:', error);
    alert('Failed to save changes');
  }
}

async function deleteImage() {
  if (!currentImage) return;
  if (!confirm(`Delete "${currentImage}"? This cannot be undone.`)) return;

  if (editState.active) {
    cancelEdits();
  }

  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      document.getElementById('image-modal').classList.remove('active');
      await loadGallery();
      
      // Update sync status since file was deleted
      await updateSyncStatus();
      
      // Refresh similar groups and filter count
      await fetchSimilarGroups();
      await loadTagsForFilter();
      if (similarFilterActive) {
        renderGallery();
      }
      
      // Auto-sync after deletion (same as closing modal with changes)
      const status = await fetch(`${API_BASE}/sync/status`).then(r => r.json());
      if (status.success && status.status.hasChanges) {
        await manualSync();
      }
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    alert('Failed to delete image');
  }
}

// Metadata Viewer Functions
function initMetadataViewer() {
  const btn = document.getElementById('refresh-metadata-btn');
  btn.addEventListener('click', loadMetadata);
  
  // Load metadata on initial page load
  loadMetadata();
}

async function loadMetadata() {
  const contentDiv = document.getElementById('metadata-content');
  contentDiv.textContent = 'Loading metadata...';

  try {
    const response = await fetch(`${API_BASE}/metadata`);
    const metadata = await response.json();
    
    // Pretty print the JSON with syntax highlighting
    contentDiv.textContent = JSON.stringify(metadata, null, 2);
  } catch (error) {
    console.error('Error loading metadata:', error);
    contentDiv.textContent = 'Error loading metadata: ' + error.message;
  }
}

// Sync Detail Functions
function initSyncDetail() {
  // Load initial data
  loadSyncStatus();
  loadSyncLogs();
  
  // Set up conflict filter checkbox
  const problemsCheckbox = document.getElementById('show-problems-only');
  if (problemsCheckbox) {
    problemsCheckbox.addEventListener('change', () => {
      loadSyncLogs();
    });
  }
}

async function loadSyncLogs() {
  const container = document.getElementById('sync-log-container');
  if (!container) return;

  // Show loading state when the container is empty
  if (!container.dataset.loaded) {
    container.innerHTML = '<div class="loading-indicator">Loading sync history...</div>';
  }

  try {
    const response = await fetch(`${API_BASE}/sync/logs`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to load sync history');
    }

    let logs = Array.isArray(data.logs) ? data.logs : [];
    
    // Apply conflict filter if checkbox is checked
    const problemsCheckbox = document.getElementById('show-problems-only');
    const showProblemsOnly = problemsCheckbox && problemsCheckbox.checked;
    
    if (showProblemsOnly) {
      logs = logs.filter(entry => {
        const status = (entry.status || '').toLowerCase();
        return status !== 'success';
      });
    }

    if (logs.length === 0) {
      const emptyMessage = showProblemsOnly 
        ? 'No sync problems found in history.' 
        : 'No sync history yet. Run a sync to see activity here.';
      container.innerHTML = `<div class="sync-log-empty">${emptyMessage}</div>`;
      container.dataset.loaded = 'true';
      return;
    }

    const entriesHtml = logs.map(renderSyncLogEntry).join('');
    container.innerHTML = `<ul class="sync-log-list-compact">${entriesHtml}</ul>`;
    container.dataset.loaded = 'true';
  } catch (error) {
    console.error('Error loading sync logs:', error);
    container.innerHTML = `<div class="error">Failed to load sync history: ${escapeHtml(error.message || 'Unknown error')}</div>`;
    container.dataset.loaded = 'true';
  }
}

function renderSyncLogEntry(entry) {
  const statusMap = {
    success: { className: 'success', label: 'Success' },
    warning: { className: 'warning', label: 'Warning' },
    failure: { className: 'failure', label: 'Error' }
  };

  const normalizedStatus = (entry.status || '').toLowerCase();
  const statusMeta = statusMap[normalizedStatus] || { className: 'info', label: formatStatusLabel(entry.status) };

  const timestamp = entry.timestamp
    ? formatSyncLogTimestamp(entry.timestamp)
    : '—';

  const mainMessage = entry.message
    || formatOperationLabel(entry.operation)
    || 'Sync update';

  const detailLines = [];

  // Simple non-conflict details
  if (entry.remoteCommit) {
    detailLines.push(`Commit: ${entry.remoteCommit.slice(0, 7)}`);
  }

  if (entry.branch && entry.branch !== 'unknown') {
    detailLines.push(`Branch: ${entry.branch}`);
  }

  // Format conflicts with newlines
  if (entry.hasConflicts && Array.isArray(entry.conflictedFiles) && entry.conflictedFiles.length > 0) {
    const conflictType = entry.conflictType ? `${entry.conflictType}: ` : '';
    detailLines.push(`Conflicts: ${conflictType}`);
    entry.conflictedFiles.forEach(file => {
      const filename = file.split('/').pop();
      detailLines.push(`---${filename}`);
    });
    detailLines.push(''); // blank line after conflicts
  }

  // Format remote changes with newlines
  if (Array.isArray(entry.remoteChanges) && entry.remoteChanges.length > 0) {
    detailLines.push('Remote:');
    entry.remoteChanges.forEach(change => {
      const cleaned = change.trim().replace(/^[-•]\s*/, '');
      if (cleaned) {
        detailLines.push(`---${cleaned}`);
      }
    });
    detailLines.push(''); // blank line after remote
  }

  // Format discarded changes with newlines
  if (Array.isArray(entry.lostChanges) && entry.lostChanges.length > 0) {
    detailLines.push('Discarded:');
    entry.lostChanges.forEach(change => {
      const cleaned = change.trim().replace(/^[-•]\s*/, '');
      if (cleaned) {
        detailLines.push(`---${cleaned}`);
      }
    });
    detailLines.push(''); // blank line after discarded
  }

  // Error info
  if (entry.error) {
    detailLines.push(`Error: ${entry.error}`);
  }

  const detailText = detailLines.join('\n').trim();

  return `
    <li class="sync-log-row">
      <div class="sync-log-main">
        <span class="sync-log-time">${escapeHtml(timestamp)}</span>
        <span class="sync-log-status ${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>
        <span class="sync-log-message">${escapeHtml(mainMessage)}</span>
      </div>
      ${detailText ? `<div class="sync-log-detail"><pre>${escapeHtml(detailText)}</pre></div>` : ''}
    </li>
  `;
}

function summarizeLogLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return '';
  }

  const result = [];
  let currentHeading = null;
  let buffer = [];

  const flush = () => {
    if (currentHeading && buffer.length > 0) {
      result.push(`${currentHeading}: ${buffer.join('; ')}`);
    } else if (currentHeading) {
      result.push(currentHeading);
    } else if (buffer.length > 0) {
      result.push(buffer.join('; '));
    }
    currentHeading = null;
    buffer = [];
  };

  lines.forEach(raw => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return;

    if (trimmed.endsWith(':')) {
      flush();
      currentHeading = trimmed.slice(0, -1).trim();
      return;
    }

    const normalized = trimmed
      .replace(/^[-•]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (normalized) {
      buffer.push(normalized);
    }
  });

  flush();
  return result.join(' • ');
}

function formatOperationLabel(operation) {
  if (!operation) return 'Sync';
  return operation
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatStatusLabel(status) {
  if (!status) return 'Info';
  const normalized = status.replace(/[-_\s]+/g, ' ').trim();
  if (!normalized) return 'Info';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatSyncLogTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function escapeHtml(untrustedValue) {
  if (untrustedValue === null || untrustedValue === undefined) return '';
  return String(untrustedValue)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadSyncStatus() {
  const container = document.getElementById('git-status-container');
  
  container.innerHTML = '<div class="loading-indicator">Loading git status...</div>';

  try {
    const response = await fetch(`${API_BASE}/sync/git-status`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error);
    }
    
    const status = data.gitStatus;
    
    // Build status display
    let html = '<div class="git-status-container">';
    
    // Status grid
    html += '<div class="git-status-grid">';
    
    // Sync status
    html += '<div class="git-status-label">Sync Status:</div>';
    html += '<div class="git-status-value">';
    const uncommittedCount = (status.modified || []).length + (status.created || []).length + (status.deleted || []).length;
    
    // Build badges
    let badges = '';
    let explanation = '';
    
    if (status.ahead === 0 && status.behind === 0 && uncommittedCount === 0) {
      badges += '<span class="status-badge clean">✓ Clean</span>';
      explanation = '<span class="sync-explanation">Your local repository is fully synced with the cloud. All changes have been committed and pushed.</span>';
    } else {
      // Build explanation based on what's present
      let explanationParts = [];
      
      if (status.ahead > 0) {
        badges += `<span class="status-badge ahead">↑ ${status.ahead} ahead</span>`;
        const commitWord = status.ahead === 1 ? 'commit' : 'commits';
        explanationParts.push(`${status.ahead} local ${commitWord} not pushed to cloud`);
      }
      
      if (status.behind > 0) {
        badges += `<span class="status-badge behind">↓ ${status.behind} behind</span>`;
        const commitWord = status.behind === 1 ? 'commit' : 'commits';
        explanationParts.push(`${status.behind} cloud ${commitWord} not downloaded`);
      }
      
      if (uncommittedCount > 0) {
        badges += '<span class="status-badge uncommitted">● Uncommitted</span>';
        
        // Fetch detailed changes for metadata.json
        const modFiles = status.modified || [];
        let detailedDescription = '';
        
        if (modFiles.includes('metadata.json')) {
          // Fetch detailed metadata changes
          try {
            const detailsResponse = await fetch(`${API_BASE}/sync/uncommitted-details`);
            const detailsData = await detailsResponse.json();
            
            if (detailsData.success && detailsData.changes && detailsData.changes.length > 0) {
              // Format the changes as a readable list
              detailedDescription = detailsData.changes.join('; ');
            } else {
              detailedDescription = 'modified: metadata.json';
            }
          } catch (detailsError) {
            console.warn('Could not fetch uncommitted details:', detailsError);
            detailedDescription = 'modified: metadata.json';
          }
        } else {
          // For non-metadata files, list them
          let fileDetails = [];
          
          if (modFiles.length > 0) {
            const fileNames = modFiles.map(f => f.split('/').pop()).join(', ');
            fileDetails.push(`modified: ${fileNames}`);
          }
          const addFiles = status.created || [];
          if (addFiles.length > 0) {
            const fileNames = addFiles.map(f => f.split('/').pop()).join(', ');
            fileDetails.push(`new: ${fileNames}`);
          }
          const delFiles = status.deleted || [];
          if (delFiles.length > 0) {
            const fileNames = delFiles.map(f => f.split('/').pop()).join(', ');
            fileDetails.push(`deleted: ${fileNames}`);
          }
          
          detailedDescription = fileDetails.join('; ');
        }
        
        explanationParts.push(detailedDescription);
      }
      
      if (status.hasConflicts) {
        badges += '<span class="status-badge conflict">⚠ Conflicts</span>';
        const conflictFiles = status.conflicted || [];
        const fileNames = conflictFiles.map(f => f.split('/').pop()).join(', ');
        explanationParts.push(`Merge conflicts in: ${fileNames}`);
      }
      
      explanation = '<span class="sync-explanation">' + explanationParts.join('. ') + '.</span>';
    }
    
    html += badges + ' ' + explanation;
    html += '</div>';
    
    html += '</div>'; // Close git-status-grid
    
    // Recent commits - scrollable list (completely outside the grid)
    if (status.recentCommits && status.recentCommits.length > 0) {
      html += '<div style="margin-top:20px; display:block; clear:both;"><strong>Recent Commits:</strong>';
      html += '<div class="commits-container-scrollable"><ul class="commits-list-compact">';
      status.recentCommits.forEach(commit => {
        // Escape HTML first
        const escapedMessage = commit.message
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, ' '); // Replace newlines with space
        // Replace -- separators with line breaks for better readability
        // Then format with bold base names and gray parentheticals
        // Pattern: "baseName: action (filename)" - bold only up to first colon
        const formattedMessage = escapedMessage
          .replace(/ -- /g, '<br>')
          .replace(/(^|<br>)(\s*)([^:]+?):/g, '$1$2<span class="commit-base-name">$3</span>:')
          .replace(/(\([^)]+\))/g, '<span class="commit-filename-paren">$1</span>');
        // Format date/time
        const commitDate = new Date(commit.date);
        const dateStr = commitDate.toLocaleDateString() + ' ' + commitDate.toLocaleTimeString();
        // No truncation - let CSS handle wrapping
        html += `<li><code class="commit-hash-small">${commit.hash}</code> <span class="commit-date">${dateStr}</span> <span class="commit-message-text">${formattedMessage}</span></li>`;
      });
      html += '</ul></div></div>';
    }
    
    html += '</div>'; // Close git-status-container
    
    container.innerHTML = html;
    
  } catch (error) {
    console.error('Error loading sync status:', error);
    container.innerHTML = `<div class="error">Error loading status: ${error.message}</div>`;
  }
}

function getFileStatusIcon(status) {
  switch(status) {
    case 'M': return 'M';
    case 'A': case '?': return '+';
    case 'D': return '−';
    case 'R': return '→';
    default: return '•';
  }
}

function getFileStatusClass(status) {
  switch(status) {
    case 'M': return 'modified';
    case 'A': case '?': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    default: return '';
  }
}

// Bulk Actions Functions
function initBulkActions() {
  const bulkTagBtn = document.getElementById('bulk-tag-btn');
  const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
  const selectAllBtn = document.getElementById('select-all-btn');
  const clearBtn = document.getElementById('clear-selection-btn');
  const addTagsBtn = document.getElementById('add-bulk-tags-btn');
  const cancelBtn = document.getElementById('cancel-bulk-tags-btn');
  const closeBtn = document.getElementById('bulk-modal-close');
  
  console.log('initBulkActions - bulkTagBtn:', bulkTagBtn);
  
  if (bulkTagBtn) {
    bulkTagBtn.addEventListener('click', openBulkTagModal);
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', deleteBulkImages);
  }
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', selectAllImages);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', clearSelection);
  }
  if (addTagsBtn) {
    addTagsBtn.addEventListener('click', saveBulkTags);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeBulkTagModal);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', closeBulkTagModal);
  }
  
  // Add Enter key support to bulk tags input
  const bulkTagsInput = document.getElementById('bulk-tags-input');
  if (bulkTagsInput) {
    bulkTagsInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBulkTags();
      }
    });
  }
  
  // Close modal on outside click
  const modal = document.getElementById('bulk-tag-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeBulkTagModal();
      }
    });
  }
}

async function deleteBulkImages() {
  const count = selectedImages.size;
  const plural = count !== 1 ? 's' : '';
  
  if (!confirm(`Are you sure you want to delete ${count} image${plural}? This cannot be undone.`)) {
    return;
  }
  
  const selectedArray = Array.from(selectedImages);
  let successCount = 0;
  let errorCount = 0;
  
  // Delete each selected image
  for (const filename of selectedArray) {
    try {
      const response = await fetch(`${API_BASE}/images/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Error deleting ${filename}:`, error);
      errorCount++;
    }
  }
  
  // Show result
  if (errorCount > 0) {
    alert(`Deleted ${successCount} image${successCount !== 1 ? 's' : ''}. ${errorCount} failed.`);
  }
  
  // Clear selection and refresh gallery
  clearSelection();
  await loadGallery();
  
  // Update sync status since files were deleted
  await updateSyncStatus();
  
  // Refresh similar groups and filter count
  await fetchSimilarGroups();
  await loadTagsForFilter();
  if (similarFilterActive) {
    renderGallery();
  }
  
  // Auto-sync after deletion if there are changes
  const status = await fetch(`${API_BASE}/sync/status`).then(r => r.json());
  if (status.success && status.status.hasChanges) {
    await manualSync();
  }
}

// TV Selection Modal
function initTvModal() {
  const tvModal = document.getElementById('tv-select-modal');
  const showTvBtn = document.getElementById('modal-show-tv-btn');
  const mobileShowTvBtn = document.getElementById('mobile-show-tv-btn');
  const closeBtn = document.getElementById('tv-modal-close');
  const tvListContainer = document.getElementById('tv-list-container');
  const logContainer = document.getElementById('tv-upload-logs');

  if (!tvModal) return;

  const handleShowTvClick = async () => {
    if (!currentImage) return;
    
    tvModal.classList.add('active');
    tvListContainer.innerHTML = '<div class="loading-indicator">Loading TVs...</div>';
    if (logContainer) {
      logContainer.style.display = 'none';
      logContainer.textContent = '';
    }
    
    try {
      const response = await fetch(`${API_BASE}/ha/tvs`);
      const data = await response.json();
      
      if (data.success && Array.isArray(data.tvs)) {
        renderTvList(data.tvs);
      } else {
        const errorMsg = data.details || data.error || 'Unknown error';
        console.error('TV Load Error:', data);
        tvListContainer.innerHTML = `<div class="error-message">Failed to load TVs: ${escapeHtml(errorMsg)}<br><br>Ensure the integration is installed and check Add-on logs.</div>`;
      }
    } catch (error) {
      console.error('Error fetching TVs:', error);
      tvListContainer.innerHTML = `<div class="error-message">Error connecting to Home Assistant: ${escapeHtml(error.message)}</div>`;
    }
  };

  // Attach handler to both desktop and mobile Show on TV buttons
  showTvBtn?.addEventListener('click', handleShowTvClick);
  mobileShowTvBtn?.addEventListener('click', handleShowTvClick);

  const closeModal = () => {
    tvModal.classList.remove('active');
  };

  closeBtn?.addEventListener('click', closeModal);
  
  window.addEventListener('click', (event) => {
    if (event.target === tvModal) {
      closeModal();
    }
  });
}

function renderTvList(tvs) {
  const container = document.getElementById('tv-list-container');
  if (!container) return;

  if (tvs.length === 0) {
    container.innerHTML = '<div class="empty-state">No Frame TVs found.</div>';
    return;
  }

  container.innerHTML = tvs.map((tv, index) => {
    const id = tv.device_id || tv.entity_id;
    const idType = tv.device_id ? 'device_id' : 'entity_id';
    // Escape ID for use in onclick and selector
    const safeId = id.replace(/['"\\]/g, '');
    
    // Only add border if not the last item
    const borderStyle = index === tvs.length - 1 ? '' : 'border-bottom: 1px solid #eee;';
    
    return `
    <div class="tv-item" onclick="displayOnTv('${safeId}', '${idType}')" style="display: flex; align-items: center; padding: 15px; ${borderStyle} cursor: pointer; transition: background 0.2s;">
      <div class="tv-info" style="flex: 1;">
        <div class="tv-name" style="font-weight: bold; font-size: 1.1em;">${tv.name}</div>
      </div>
      <button class="btn-primary btn-small" id="btn-${safeId}">Show</button>
    </div>
  `}).join('');
  
  // Add hover effect via JS since we're using inline styles for speed
  const items = container.querySelectorAll('.tv-item');
  items.forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = '#f5f5f5');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
  });
}

// Make displayOnTv globally available since it's called from onclick
window.displayOnTv = async function(id, type) {
  if (!currentImage) return;
  
  const tvModal = document.getElementById('tv-select-modal');
  const safeId = id.replace(/['"\\]/g, '');
  const btn = document.getElementById(`btn-${safeId}`);
  const logContainer = document.getElementById('tv-upload-logs');
  
  // Prevent double-clicks if button is already disabled
  if (btn && btn.disabled) return;

  // Show loading state
  const originalText = btn ? btn.textContent : 'Show';
  if (btn) {
    btn.textContent = 'Sending...';
    btn.disabled = true;
  }
  
  // UX: Create a local "Initializing" log line immediately so the user sees instant feedback.
  // We format it to match the backend log style ([HH:MM:SS] Message) so it looks seamless
  // when the real logs are appended below it later.
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour12: false });
  const initMsg = `[${timeStr}] Initializing upload...`;

  // Define pollLogs helper
  const pollLogs = async () => {
    if (!logContainer) return;
    try {
      const res = await fetch(`${API_BASE}/ha/upload-log`);
      const data = await res.json();
      if (data.success) {
        const remoteLogs = data.logs || '';
        // UX: Prepend our local init message to the remote logs.
        // This prevents the "Initializing..." message from disappearing when the first
        // real log arrives, creating a smooth, continuous log history for the user.
        const fullLogs = remoteLogs ? `${initMsg}\n${remoteLogs}` : initMsg;
        
        if (logContainer.textContent !== fullLogs) {
          logContainer.textContent = fullLogs;
          logContainer.scrollTop = logContainer.scrollHeight;
        }
      }
    } catch (e) {
      console.error('Log poll error:', e);
    }
  };

  // Start log polling
  let pollInterval;
  if (logContainer) {
    logContainer.style.display = 'block';
    logContainer.textContent = initMsg;
    
    // UX: Wait 1s before first poll to allow backend to clear the log file.
    // If we poll immediately, we might fetch the logs from the *previous* run
    // before the backend has a chance to truncate the file, causing a confusing flash of old data.
    pollInterval = setInterval(pollLogs, 1000);
  }

  try {
    const payload = {
      filename: currentImage
    };

    // Add matte and filter if selected in the modal
    const matteSelect = document.getElementById('modal-matte');
    const filterSelect = document.getElementById('modal-filter');
    
    if (matteSelect && matteSelect.value && matteSelect.value !== 'none') {
      payload.matte = matteSelect.value;
    }
    
    if (filterSelect && filterSelect.value && filterSelect.value !== 'None') {
      payload.filter = filterSelect.value;
    }
    
    if (type === 'device_id') {
      payload.device_id = id;
    } else {
      payload.entity_id = id;
    }

    const response = await fetch(`${API_BASE}/ha/display`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    // Stop polling
    if (pollInterval) clearInterval(pollInterval);
    
    // Fetch logs one last time to ensure we see the final message
    await pollLogs();

    // Check if modal is still open - if user closed it, suppress all feedback
    if (!tvModal.classList.contains('active')) {
      console.log('Modal closed by user during send. Suppressing result.');
      return;
    }

    if (result.success) {
      if (btn) btn.textContent = 'Sent!';
      
      // Close modal after short delay
      setTimeout(() => {
        tvModal.classList.remove('active');
        // Only show alert in development
        if (appEnvironment === 'development') {
          alert('Image sent to TV!');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }, 2000); // Increased delay so user can see final logs
    } else {
      // Failure - logs are already displayed
      if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  } catch (error) {
    if (pollInterval) clearInterval(pollInterval);
    console.error('Error sending to TV:', error);
    // Only alert if modal is still open
    if (tvModal.classList.contains('active')) {
      if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  }
};

// ===== Analytics Functions =====

// Analytics state
let analyticsData = null;
let selectedTag = null;
let selectedImage = null;
let selectedTv = null;
let selectedTimeRange = '1w'; // default to 1 week

// Time range options in milliseconds
const TIME_RANGES = {
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1mo': 30 * 24 * 60 * 60 * 1000,
  '6mo': 180 * 24 * 60 * 60 * 1000
};

// Chart colors for pie charts
const CHART_COLORS = [
  '#3498db', // blue
  '#e74c3c', // red
  '#2ecc71', // green
  '#9b59b6', // purple
  '#f39c12', // orange
  '#1abc9c', // teal
  '#e67e22', // dark orange
  '#95a5a6'  // gray (for "other" / "<none>")
];

// Load analytics data silently in background for gallery "last display" info
async function loadAnalyticsDataForGallery() {
  try {
    const response = await fetch(`${API_BASE}/analytics/summary`);
    const result = await response.json();
    if (result.success && result.data) {
      analyticsData = result.data;
      // Re-render gallery to show "last display" info
      if (galleryHasLoadedAtLeastOnce) {
        renderGallery();
      }
    }
  } catch (error) {
    // Silently fail - analytics data is optional for gallery
    console.log('Could not load analytics data for gallery:', error.message);
  }
}

async function loadAnalytics(selectedImage = null) {
  const emptyState = document.getElementById('analytics-empty-state');
  const errorState = document.getElementById('analytics-error-state');
  const content = document.getElementById('analytics-content');
  
  // Hide states, show loading
  if (emptyState) emptyState.style.display = 'none';
  if (errorState) errorState.style.display = 'none';
  if (content) content.style.display = 'none';
  
  // Show loading in summary
  const tvSummaryList = document.getElementById('analytics-tv-summary-list');
  if (tvSummaryList) tvSummaryList.innerHTML = '<div class="loading-indicator">Loading analytics...</div>';
  
  try {
    // Ensure gallery data is loaded (needed for histogram)
    if (!galleryHasLoadedAtLeastOnce) {
      const galleryResponse = await fetch(`${API_BASE}/images`);
      allImages = await galleryResponse.json();
      galleryHasLoadedAtLeastOnce = true;
    }
    
    const response = await fetch(`${API_BASE}/analytics/summary`);
    const result = await response.json();
    
    if (!result.success) {
      if (result.reason === 'no_data') {
        // Show empty state
        if (emptyState) emptyState.style.display = 'block';
        return;
      }
      throw new Error(result.message || 'Failed to load analytics');
    }
    
    analyticsData = result.data;
    
    // Check if logging is disabled
    if (analyticsData.logging_enabled === false) {
      if (emptyState) {
        emptyState.querySelector('h3').textContent = 'Activity logging is disabled';
        emptyState.querySelector('p').textContent = 'Enable logging in the Frame Art Shuffler integration settings to start tracking display statistics.';
        emptyState.style.display = 'block';
      }
      return;
    }
    
    // Show content
    if (content) content.style.display = 'block';
    
    // Render all sections
    renderAnalyticsSummary();
    renderOverallPieChart();
    renderTVSelector();
    renderTagSelector();
    renderImageSelector();
    setupAnalyticsEventListeners();
    
    // If an image was specified, try to select it
    if (selectedImage) {
      // On mobile, switch to the Images tab
      const pageContent = document.querySelector('.analytics-page-content');
      if (pageContent) {
        pageContent.dataset.activeColumn = 'images';
        // Update tab button states
        document.querySelectorAll('.analytics-mobile-tab').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.column === 'images');
        });
      }
      
      // Try to select the image in the dropdown
      const imageSelect = document.getElementById('analytics-image-select');
      if (imageSelect) {
        // Check if the exact filename exists as an option
        const options = Array.from(imageSelect.options);
        const exactMatch = options.find(opt => opt.value === selectedImage);
        
        if (exactMatch) {
          imageSelect.value = selectedImage;
          imageSelect.dispatchEvent(new Event('change'));
        } else {
          // Try partial match (filename without path)
          const baseFilename = selectedImage.split('/').pop();
          const partialMatch = options.find(opt => opt.value.includes(baseFilename) || baseFilename.includes(opt.value));
          if (partialMatch) {
            imageSelect.value = partialMatch.value;
            imageSelect.dispatchEvent(new Event('change'));
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error loading analytics:', error);
    if (errorState) {
      const errorMsg = document.getElementById('analytics-error-message');
      if (errorMsg) errorMsg.textContent = error.message;
      errorState.style.display = 'block';
    }
  }
}

function renderAnalyticsSummary() {
  if (!analyticsData) return;
  
  const imageCount = Object.keys(analyticsData.images || {}).length;
  
  // Update image count
  const imagesEl = document.getElementById('analytics-total-images');
  if (imagesEl) imagesEl.textContent = imageCount;
  
  // Render TV summary list
  const tvSummaryList = document.getElementById('analytics-tv-summary-list');
  if (!tvSummaryList) return;
  
  const tvs = analyticsData.tvs || {};
  const tvIds = Object.keys(tvs);
  
  if (tvIds.length === 0) {
    tvSummaryList.innerHTML = '<div class="empty-state-small">No TV data</div>';
    return;
  }
  
  // Sort by display time descending
  tvIds.sort((a, b) => (tvs[b].total_display_seconds || 0) - (tvs[a].total_display_seconds || 0));
  
  tvSummaryList.innerHTML = tvIds.map(tvId => {
    const tv = tvs[tvId];
    const hours = formatHoursNice(tv.total_display_seconds || 0);
    // Derive unique image count from per_image array length
    const imageCount = Array.isArray(tv.per_image) ? tv.per_image.length : 0;
    return `
      <div class="tv-summary-item">
        <span class="tv-summary-name">${escapeHtml(tv.name || 'Unknown TV')}</span>
        <span class="tv-summary-stats">${hours} / ${imageCount} images</span>
      </div>
    `;
  }).join('');
}

// Store buckets globally for click handlers
let histogramBuckets = [];
let selectedBucketIndex = -1;
let bucketSortColumn = 'time'; // 'time' or 'count'
let bucketSortAsc = true;

function renderOverallPieChart() {
  const container = document.getElementById('analytics-image-pie');
  const statsContainer = document.getElementById('analytics-distribution-stats');
  const detailContainer = document.getElementById('analytics-bucket-detail');
  if (!container) return;
  
  const analyticsImages = analyticsData?.images || {};
  const galleryImageNames = Object.keys(allImages || {});
  
  // Calculate time-filtered display seconds for each image
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  // Helper to calculate display seconds and count within the time range for an image
  function getImageStatsInRange(imageData) {
    if (!imageData?.display_periods) return { seconds: 0, count: 0 };
    let seconds = 0;
    let count = 0;
    for (const [tvId, periods] of Object.entries(imageData.display_periods)) {
      for (const period of periods) {
        if (period.end > rangeStart) {
          const start = Math.max(period.start, rangeStart);
          const end = Math.min(period.end, now);
          seconds += (end - start) / 1000;
          count++;
        }
      }
    }
    return { seconds, count };
  }
  
  // Merge gallery images with analytics data - include ALL images from gallery
  // Images not in analytics get 0 seconds, others get time-filtered seconds
  // Note: We only include images that exist in the gallery. Deleted images that
  // may still have analytics data are excluded from the histogram.
  const mergedImages = galleryImageNames.map(name => {
    const stats = getImageStatsInRange(analyticsImages[name]);
    return {
      name,
      seconds: stats.seconds,
      displayCount: stats.count
    };
  });
  
  if (mergedImages.length === 0) {
    container.innerHTML = '<div class="empty-state-small">No image data</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    if (detailContainer) detailContainer.innerHTML = '';
    return;
  }
  
  // Sort by display time descending
  const imageList = mergedImages.sort((a, b) => b.seconds - a.seconds);
  
  const totalSeconds = imageList.reduce((sum, img) => sum + img.seconds, 0);
  
  // Calculate stats
  const count = imageList.length;
  const avgSeconds = count > 0 ? totalSeconds / count : 0;
  const sortedByTime = [...imageList].sort((a, b) => a.seconds - b.seconds);
  const medianSeconds = count === 0 ? 0 : (count % 2 === 0 
    ? (sortedByTime[count/2 - 1].seconds + sortedByTime[count/2].seconds) / 2
    : sortedByTime[Math.floor(count/2)].seconds);
  const minSeconds = sortedByTime[0]?.seconds || 0;
  const maxSeconds = sortedByTime[count - 1]?.seconds || 0;
  
  // Render stats line
  if (statsContainer) {
    statsContainer.innerHTML = `
      <span class="dist-title">Accumulated Display Time</span>
      <span class="dist-metrics">
        <span class="dist-stat">${count} images</span>
        <span class="dist-stat-sep">•</span>
        <span class="dist-stat">Avg: ${formatHoursNice(avgSeconds)}</span>
        <span class="dist-stat-sep">•</span>
        <span class="dist-stat">Median: ${formatHoursNice(medianSeconds)}</span>
        <span class="dist-stat-sep">•</span>
        <span class="dist-stat">Range: ${formatHoursNice(minSeconds)} – ${formatHoursNice(maxSeconds)}</span>
      </span>
    `;
  }
  
  // Define histogram buckets (in seconds)
  histogramBuckets = [
    { min: 0, max: 0, label: '0m', images: [] },
    { min: 1, max: 15 * 60, label: '<15m', images: [] },
    { min: 15 * 60, max: 60 * 60, label: '15m-1h', images: [] },
    { min: 60 * 60, max: 3 * 60 * 60, label: '1-3h', images: [] },
    { min: 3 * 60 * 60, max: 6 * 60 * 60, label: '3-6h', images: [] },
    { min: 6 * 60 * 60, max: 12 * 60 * 60, label: '6-12h', images: [] },
    { min: 12 * 60 * 60, max: 24 * 60 * 60, label: '12-24h', images: [] },
    { min: 24 * 60 * 60, max: 48 * 60 * 60, label: '1-2d', images: [] },
    { min: 48 * 60 * 60, max: Infinity, label: '2d+', images: [] }
  ];
  
  // Distribute images into buckets
  imageList.forEach(img => {
    for (const bucket of histogramBuckets) {
      if (img.seconds >= bucket.min && img.seconds < bucket.max) {
        bucket.images.push(img);
        break;
      }
      // Handle exact 0 case
      if (bucket.min === 0 && bucket.max === 0 && img.seconds === 0) {
        bucket.images.push(img);
        break;
      }
    }
  });
  
  // Find max bucket count for scaling
  const maxBucketCount = Math.max(...histogramBuckets.map(b => b.images.length), 1);
  const maxBarHeight = 90; // pixels
  
  // Build histogram bars
  const barsHtml = histogramBuckets.map((bucket, index) => {
    const heightPx = Math.max((bucket.images.length / maxBucketCount) * maxBarHeight, bucket.images.length > 0 ? 18 : 0);
    const isZeroBucket = bucket.min === 0 && bucket.max === 0;
    const hasImages = bucket.images.length > 0;
    const isSelected = index === selectedBucketIndex;
    const bucketClass = `histogram-bar ${isZeroBucket && hasImages ? 'zero-bucket' : ''} ${hasImages ? 'clickable' : ''} ${isSelected ? 'selected' : ''}`;
    
    // Only show bar if bucket has images
    const barInnerHtml = hasImages ? `
      <div class="histogram-bar-inner" style="height: ${heightPx}px">
        <span class="histogram-count">${bucket.images.length}</span>
      </div>
    ` : '';
    
    return `
      <div class="${bucketClass}" data-bucket-index="${index}">
        ${barInnerHtml}
        <div class="histogram-label">${bucket.label}</div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = `
    <div class="histogram-chart">
      <div class="histogram-bars">${barsHtml}</div>
    </div>
  `;
  
  // Clear detail container
  if (detailContainer) detailContainer.innerHTML = '';
  selectedBucketIndex = -1;
  
  // Add click handlers for histogram bars
  container.querySelectorAll('.histogram-bar.clickable').forEach(bar => {
    bar.addEventListener('click', () => {
      const bucketIndex = parseInt(bar.dataset.bucketIndex);
      toggleBucketDetail(bucketIndex);
    });
  });

  // On mobile, auto-select the first clickable bar to show the table
  if (window.innerWidth <= 768) {
    const firstClickableBar = container.querySelector('.histogram-bar.clickable');
    if (firstClickableBar) {
      const bucketIndex = parseInt(firstClickableBar.dataset.bucketIndex);
      toggleBucketDetail(bucketIndex);
    }
  }
}

// Helper to format days ago
function formatDaysAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return `${diffDays}d`;
}

// Toggle bucket detail table
function toggleBucketDetail(bucketIndex) {
  const container = document.getElementById('analytics-image-pie');
  const detailContainer = document.getElementById('analytics-bucket-detail');
  if (!detailContainer) return;
  
  // If clicking the same bucket, collapse it
  if (selectedBucketIndex === bucketIndex) {
    selectedBucketIndex = -1;
    detailContainer.innerHTML = '';
    // Remove selected class from all bars
    container.querySelectorAll('.histogram-bar').forEach(bar => bar.classList.remove('selected'));
    return;
  }
  
  selectedBucketIndex = bucketIndex;
  
  // Update selected state on bars
  container.querySelectorAll('.histogram-bar').forEach(bar => {
    bar.classList.toggle('selected', parseInt(bar.dataset.bucketIndex) === bucketIndex);
  });
  
  // Reset sort to default when opening new bucket
  bucketSortColumn = 'time';
  bucketSortAsc = true;
  
  renderBucketDetailTable();
}

// Render the bucket detail table (called by toggleBucketDetail and sort handlers)
function renderBucketDetailTable() {
  const detailContainer = document.getElementById('analytics-bucket-detail');
  if (!detailContainer || selectedBucketIndex < 0) return;
  
  const bucket = histogramBuckets[selectedBucketIndex];
  if (!bucket || bucket.images.length === 0) {
    detailContainer.innerHTML = '';
    return;
  }
  
  // Sort images based on current sort column and direction
  const sortedImages = [...bucket.images].sort((a, b) => {
    let cmp = 0;
    if (bucketSortColumn === 'time') {
      cmp = a.seconds - b.seconds;
    } else if (bucketSortColumn === 'count') {
      cmp = (a.displayCount || 0) - (b.displayCount || 0);
    }
    // Apply primary sort direction
    cmp = bucketSortAsc ? cmp : -cmp;
    // Secondary sort by upload date ascending (oldest to newest) - always ascending
    if (cmp === 0) {
      const dateA = allImages[a.name]?.added || '';
      const dateB = allImages[b.name]?.added || '';
      cmp = dateA.localeCompare(dateB);
    }
    return cmp;
  });
  
  // Build table rows
  const rows = sortedImages.map(img => {
    const imageData = allImages[img.name] || {};
    const tags = imageData.tags || [];
    const tagsHtml = tags.length > 0 
      ? tags.map(t => escapeHtml(t)).join(', ')
      : '<span class="bucket-tag untagged">(untagged)</span>';
    const displayTime = formatHoursNice(img.seconds);
    const isZeroTime = img.seconds === 0;
    const displayCount = img.displayCount || 0;
    // Calculate average time per appearance
    const avgSecondsPerAppearance = displayCount > 0 ? img.seconds / displayCount : 0;
    const avgTimeStr = displayCount > 0 ? ` (${formatHoursNice(avgSecondsPerAppearance)})` : '';
    const displayCountStr = `${displayCount}${avgTimeStr}`;
    const addedDateShort = imageData.added ? formatDateShort(imageData.added) : '—';
    const daysAgo = imageData.added ? formatDaysAgo(imageData.added) : '';
    // Mobile-friendly format: m/d/yy (Xd)
    const uploadDisplay = imageData.added ? `${addedDateShort} (${daysAgo})` : '—';
    const displayName = getAnalyticsDisplayName(img.name);
    
    // Use current metadata for filter/matte, fallback to display history for deleted images
    let currentFilter = imageData.filter;
    let currentMatte = imageData.matte;
    
    // Fallback to display history if image not in gallery (deleted)
    if (!currentFilter && !currentMatte) {
      const imgAnalytics = analyticsData?.images?.[img.name];
      if (imgAnalytics?.display_periods) {
        for (const periods of Object.values(imgAnalytics.display_periods)) {
          for (const p of periods) {
            if (p.photo_filter && p.photo_filter.toLowerCase() !== 'none') currentFilter = p.photo_filter;
            if (p.matte && p.matte.toLowerCase() !== 'none') currentMatte = p.matte;
          }
        }
      }
    }
    const filterMatteSuffix = formatFilterMatteSuffix(currentFilter, currentMatte);
    
    return `
      <div class="bucket-row" data-filename="${escapeHtml(img.name)}">
        <span class="bucket-time${isZeroTime ? ' zero' : ''}">${displayTime}</span>
        <span class="bucket-count">${displayCountStr}</span>
        <span class="bucket-filename" title="${escapeHtml(img.name)}"><span class="bucket-filename-text">${escapeHtml(displayName)}</span>${filterMatteSuffix}<button class="bucket-open-btn" title="Open image">⧉</button></span>
        <span class="bucket-tags">${tagsHtml}</span>
        <span class="bucket-date">${uploadDisplay}</span>
      </div>
    `;
  }).join('');
  
  const timeArrow = bucketSortColumn === 'time' ? (bucketSortAsc ? ' ▲' : ' ▼') : '';
  const countArrow = bucketSortColumn === 'count' ? (bucketSortAsc ? ' ▲' : ' ▼') : '';
  
  detailContainer.innerHTML = `
    <div class="bucket-table-wrapper">
      <div class="bucket-table-header">
        <span class="sortable" data-sort="time">Time${timeArrow}</span>
        <span class="sortable center" data-sort="count"># (avg)${countArrow}</span>
        <span>Filename</span>
        <span>Tags</span>
        <span class="bucket-date">Upload Date</span>
      </div>
      <div class="bucket-table-scroll">
        ${rows}
      </div>
    </div>
  `;
  
  // Add click handlers for sortable headers
  detailContainer.querySelectorAll('.bucket-table-header .sortable').forEach(header => {
    header.addEventListener('click', () => {
      const col = header.dataset.sort;
      if (bucketSortColumn === col) {
        bucketSortAsc = !bucketSortAsc;
      } else {
        bucketSortColumn = col;
        bucketSortAsc = true;
      }
      renderBucketDetailTable();
    });
  });
  
  // Add click handlers for rows (select image in 3rd column, or open modal on mobile)
  detailContainer.querySelectorAll('.bucket-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't handle if clicking the open button
      if (e.target.classList.contains('bucket-open-btn')) return;
      
      const filename = row.dataset.filename;
      if (filename) {
        // On mobile, open the image modal directly
        if (window.innerWidth <= 768) {
          if (allImages[filename]) openImageModal(filename);
        } else {
          // On desktop, select the row and update 3rd column display
          detailContainer.querySelectorAll('.bucket-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          selectAnalyticsImage(filename);
        }
      }
    });
  });
  
  // Add click handlers for open buttons (desktop only, hidden on mobile)
  detailContainer.querySelectorAll('.bucket-open-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.bucket-row');
      const filename = row?.dataset.filename;
      if (filename && allImages[filename]) openImageModal(filename);
    });
  });
}

function renderTVSelector() {
  const select = document.getElementById('analytics-tv-select');
  if (!select || !analyticsData) return;
  
  const tvs = analyticsData.tvs || {};
  const tvIds = Object.keys(tvs);
  
  // Sort by display time descending
  tvIds.sort((a, b) => (tvs[b].total_display_seconds || 0) - (tvs[a].total_display_seconds || 0));
  
  select.innerHTML = tvIds.map(tvId => {
      const tv = tvs[tvId];
      return `<option value="${escapeHtml(tvId)}">${escapeHtml(tv.name || 'Unknown TV')}</option>`;
    }).join('');
  
  // Auto-select first TV
  if (tvIds.length > 0) {
    selectedTv = tvIds[0];
    select.value = selectedTv;
    renderTVDetail(selectedTv);
  }
}

function renderTVDetail(tvId) {
  const container = document.getElementById('analytics-tv-detail');
  const statsContainer = document.getElementById('analytics-tv-stats');
  if (!container || !analyticsData) return;
  
  if (!tvId) {
    container.innerHTML = '<div class="empty-state-small">Select a TV to view details</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    return;
  }
  
  const tvData = analyticsData.tvs?.[tvId];
  if (!tvData) {
    container.innerHTML = '<div class="empty-state-small">TV not found in analytics data</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    return;
  }
  
  // Get time-filtered data for this TV
  const perImage = getTopImagesForTVInRange(tvId);
  
  // Calculate stats for selected time range
  const tvStats = calculateTVStatsForRange(tvId);
  
  // Render stats in header area
  if (statsContainer) {
    statsContainer.innerHTML = `
      <div class="stat-row-inline">
        <span class="stat-inline"><strong>${formatHoursNice(tvStats.totalSeconds)}</strong> display time</span>
        <span class="stat-sep">·</span>
        <span class="stat-inline"><strong>${tvStats.eventCount}</strong> shuffles</span>
      </div>
    `;
  }
  
  let html = '';
  
  // Activity timeline (when TV was displaying vs not)
  html += renderTVActivityTimeline(tvId);
  
  // Event log for this TV
  html += renderTVEventLog(tvId);
  
  container.innerHTML = html;
  
  // Add click handlers for event log rows
  container.querySelectorAll('.event-log-row.clickable').forEach(row => {
    row.addEventListener('click', () => {
      const filename = row.dataset.filename;
      if (filename) selectAnalyticsImage(filename);
    });
  });
}

// Generate timeline axis with edge labels and tick marks based on time range
function generateTimelineAxis(rangeStart, rangeMs, isCompact = false) {
  const now = Date.now();
  
  // Determine tick interval based on selected time range
  const tickConfig = {
    '1h': { interval: 15 * 60 * 1000, format: { hour: 'numeric', minute: '2-digit' } },           // 15 min
    '12h': { interval: 2 * 60 * 60 * 1000, format: { hour: 'numeric' } },                         // 2 hours
    '1d': { interval: 4 * 60 * 60 * 1000, format: { hour: 'numeric' } },                          // 4 hours
    '1w': { interval: 24 * 60 * 60 * 1000, format: { weekday: 'short' } },                        // 1 day
    '1mo': { interval: 7 * 24 * 60 * 60 * 1000, format: { month: 'short', day: 'numeric' } },     // 1 week
    '6mo': { interval: 30 * 24 * 60 * 60 * 1000, format: { month: 'short' } }                     // 1 month
  };
  
  const config = tickConfig[selectedTimeRange] || tickConfig['1w'];
  
  // Generate tick marks
  const ticks = [];
  let tickTime = Math.ceil(rangeStart / config.interval) * config.interval; // Start at first clean interval
  
  while (tickTime < now) {
    const pct = ((tickTime - rangeStart) / rangeMs) * 100;
    if (pct > 5 && pct < 95) { // Avoid ticks too close to edges
      const label = new Date(tickTime).toLocaleString(undefined, config.format);
      ticks.push({ pct, label });
    }
    tickTime += config.interval;
  }
  
  // Edge labels
  const startDate = new Date(rangeStart);
  const startFormat = (selectedTimeRange === '1h' || selectedTimeRange === '12h' || selectedTimeRange === '1d') 
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  const startLabel = startDate.toLocaleString(undefined, startFormat);
  
  // Build tick marks HTML
  const tickMarks = ticks.map(t => 
    `<div class="timeline-tick" style="left: ${t.pct}%"><span class="timeline-tick-label">${t.label}</span></div>`
  ).join('');
  
  // Edge labels HTML (above track)
  const edgesHtml = `<div class="timeline-edges"><span>${startLabel}</span><span>Now</span></div>`;
  
  // Ticks HTML (below track)
  const ticksHtml = tickMarks ? `<div class="timeline-ticks">${tickMarks}</div>` : '';
  
  // For compact (inline) timelines, just return edges
  if (isCompact) {
    return { edges: edgesHtml, ticks: '' };
  }
  
  return { edges: edgesHtml, ticks: ticksHtml };
}

// Render activity timeline for a TV (showing when it was on/displaying) with image tooltips
function renderTVActivityTimeline(tvId) {
  const tvData = analyticsData?.tvs?.[tvId];
  if (!tvData) return '';
  
  // Collect all display periods from all images for this TV (with image names)
  const allPeriods = [];
  const images = analyticsData.images || {};
  
  for (const [filename, imageData] of Object.entries(images)) {
    const periods = imageData.display_periods?.[tvId] || [];
    for (const period of periods) {
      allPeriods.push({ start: period.start, end: period.end, filename });
    }
  }
  
  if (allPeriods.length === 0) {
    return '<div class="tv-timeline"><div class="inline-timeline-empty">No timeline data available</div></div>';
  }
  
  // Sort by start time
  allPeriods.sort((a, b) => a.start - b.start);
  
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  // Build timeline segments with tooltips showing image name and time
  const segments = allPeriods
    .filter(p => p.end > rangeStart)
    .map(period => {
      const start = Math.max(period.start, rangeStart);
      const end = Math.min(period.end, now);
      const leftPct = ((start - rangeStart) / rangeMs) * 100;
      const widthPct = Math.max(((end - start) / rangeMs) * 100, 0.3);
      const startTime = new Date(period.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const duration = formatHoursNice((period.end - period.start) / 1000);
      const tooltip = `${period.filename} (${startTime}, ${duration})`;
      return `<div class="tv-timeline-segment" style="left: ${leftPct}%; width: ${widthPct}%" title="${escapeHtml(tooltip)}"></div>`;
    })
    .join('');
  
  // Generate axis parts (edges above, ticks below)
  const axis = generateTimelineAxis(rangeStart, rangeMs, false);
  
  return `
    <div class="tv-timeline">
      ${axis.edges}
      <div class="tv-timeline-track">${segments || '<div class="tv-timeline-empty">No activity</div>'}</div>
      ${axis.ticks}
    </div>
  `;
}

// Render event log for a specific TV
function renderTVEventLog(tvId) {
  const images = analyticsData?.images || {};
  const tvName = analyticsData?.tvs?.[tvId]?.name || 'Unknown TV';
  
  // Collect all events for this TV
  const allEvents = [];
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  for (const [filename, imageData] of Object.entries(images)) {
    const periods = imageData.display_periods?.[tvId] || [];
    for (const period of periods) {
      if (period.end > rangeStart) {
        allEvents.push({
          filename,
          start: period.start,
          end: period.end,
          duration: period.end - period.start,
          matte: period.matte,
          photo_filter: period.photo_filter
        });
      }
    }
  }
  
  if (allEvents.length === 0) {
    return '<div class="event-log"><div class="event-log-title">Display Events</div><div class="event-log-empty">No events in selected time range</div></div>';
  }
  
  // Sort by start time descending
  allEvents.sort((a, b) => b.start - a.start);
  
  const eventRows = allEvents.map(evt => {
    const startDate = new Date(evt.start);
    // duration is in ms, convert to seconds for formatHoursNice
    const durationFormatted = formatHoursNice(evt.duration / 1000);
    const dateStr = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const imageName = truncateFilename(evt.filename, 18);
    const filterMatteSuffix = formatFilterMatteSuffix(evt.photo_filter, evt.matte);
    
    return `
      <div class="event-log-row clickable" data-filename="${escapeHtml(evt.filename)}">
        <span class="event-log-date">${dateStr}</span>
        <span class="event-log-time">${timeStr}</span>
        <span class="event-log-image"><span class="event-log-image-text">${escapeHtml(imageName)}</span>${filterMatteSuffix}</span>
        <span class="event-log-duration">${durationFormatted}</span>
      </div>
    `;
  }).join('');
  
  return `
    <div class="event-log">
      <div class="event-log-title">Display Events (${allEvents.length})</div>
      <div class="event-log-header">
        <span>Date</span>
        <span>Time</span>
        <span>Image</span>
        <span>Duration</span>
      </div>
      <div class="event-log-scroll">
        ${eventRows}
      </div>
    </div>
  `;
}

function renderPieChart(tags, tvId) {
  if (!tags || tags.length === 0) {
    return '<div class="empty-state-small" style="padding: 10px;">No tag data</div>';
  }
  
  // Take top 5 tags, combine rest into "other"
  const sortedTags = [...tags].sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
  const topTags = sortedTags.slice(0, 5);
  const otherSeconds = sortedTags.slice(5).reduce((sum, t) => sum + (t.seconds || 0), 0);
  
  if (otherSeconds > 0) {
    const totalSeconds = sortedTags.reduce((sum, t) => sum + (t.seconds || 0), 0);
    topTags.push({
      tag: 'other',
      seconds: otherSeconds,
      share: (otherSeconds / totalSeconds) * 100
    });
  }
  
  // Build conic gradient
  let gradientStops = [];
  let currentPct = 0;
  
  topTags.forEach((tag, index) => {
    const pct = tag.share || 0;
    const color = tag.tag === '<none>' || tag.tag === 'other' 
      ? CHART_COLORS[7] 
      : CHART_COLORS[index % (CHART_COLORS.length - 1)];
    
    gradientStops.push(`${color} ${currentPct}% ${currentPct + pct}%`);
    currentPct += pct;
  });
  
  // Fill remaining to 100% if needed
  if (currentPct < 100) {
    gradientStops.push(`#e9ecef ${currentPct}% 100%`);
  }
  
  const gradient = `conic-gradient(${gradientStops.join(', ')})`;
  
  // Build legend
  const legendItems = topTags.map((tag, index) => {
    const color = tag.tag === '<none>' || tag.tag === 'other' 
      ? CHART_COLORS[7] 
      : CHART_COLORS[index % (CHART_COLORS.length - 1)];
    const displayTag = tag.tag === '<none>' ? '(untagged)' : tag.tag;
    
    return `
      <div class="pie-legend-item" data-tag="${escapeHtml(tag.tag)}" title="Click to view tag details">
        <span class="pie-legend-color" style="background: ${color}"></span>
        <span class="pie-legend-label">${escapeHtml(displayTag)}</span>
        <span class="pie-legend-pct">${(tag.share || 0).toFixed(0)}%</span>
      </div>
    `;
  }).join('');
  
  return `
    <div class="pie-chart-container">
      <div class="pie-chart" style="background: ${gradient}"></div>
      <div class="pie-legend">${legendItems}</div>
    </div>
  `;
}

function renderTagSelector() {
  const select = document.getElementById('analytics-tag-select');
  if (!select || !analyticsData) return;
  
  // Get tags that have activity in the selected time range
  const tagsWithActivity = getTagsWithActivityInRange();
  
  // Sort alphabetically, but keep <none> (untagged) at the end
  tagsWithActivity.sort((a, b) => {
    if (a === '<none>') return 1;
    if (b === '<none>') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  
  select.innerHTML = tagsWithActivity.map(tag => {
      const displayTag = tag === '<none>' ? '(untagged)' : tag;
      return `<option value="${escapeHtml(tag)}">${escapeHtml(displayTag)}</option>`;
    }).join('');
  
  // If current selection is no longer available, auto-select first
  if (tagsWithActivity.length > 0) {
    if (!selectedTag || !tagsWithActivity.includes(selectedTag)) {
      selectedTag = tagsWithActivity[0];
    }
    select.value = selectedTag;
    renderTagDetail(selectedTag);
  } else {
    selectedTag = null;
    renderTagDetail(null);
  }
}

function renderImageSelector() {
  const select = document.getElementById('analytics-image-select');
  if (!select) return;
  
  // Use ALL gallery images, not just ones with analytics data
  const analyticsImages = analyticsData?.images || {};
  const galleryImageNames = Object.keys(allImages || {});
  
  // If no gallery images loaded yet, fall back to analytics images only
  const imageNames = galleryImageNames.length > 0 ? galleryImageNames : Object.keys(analyticsImages);
  
  // Sort alphabetically for easy lookup
  imageNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  
  select.innerHTML = imageNames.map(filename => {
      const displayName = truncateFilename(filename, 40);
      return `<option value="${escapeHtml(filename)}">${escapeHtml(displayName)}</option>`;
    }).join('');
  
  // Auto-select first image
  if (imageNames.length > 0) {
    selectedImage = imageNames[0];
    select.value = selectedImage;
    renderImageDetail(selectedImage);
  }
}

function renderTagDetail(tagName) {
  const container = document.getElementById('analytics-tag-detail');
  const statsContainer = document.getElementById('analytics-tag-stats');
  if (!container || !analyticsData) return;
  
  if (!tagName) {
    container.innerHTML = '<div class="empty-state-small">Select a tag to view details</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    return;
  }
  
  const tagData = analyticsData.tags?.[tagName];
  if (!tagData) {
    container.innerHTML = '<div class="empty-state-small">Tag not found</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    return;
  }
  
  const displayTag = tagName === '<none>' ? '(untagged)' : tagName;
  
  // Get time-filtered data for this tag
  const perTv = getPerTVStatsForTagInRange(tagName);
  const topImages = getTopImagesForTagInRange(tagName);
  
  // Calculate stats for selected time range
  const tagStats = calculateTagStatsForRange(tagName);
  
  // Render stats in header area
  if (statsContainer) {
    statsContainer.innerHTML = `
      <div class="stat-row-inline">
        <span class="stat-inline"><strong>${formatHoursNice(tagStats.totalSeconds)}</strong> display time</span>
        <span class="stat-sep">·</span>
        <span class="stat-inline"><strong>${tagStats.eventCount}</strong> appearances</span>
      </div>
    `;
  }
  
  let html = '';
  
  // TV breakdown - stacked horizontal bar (only if multiple TVs)
  const totalTvCount = Object.keys(analyticsData.tvs || {}).length;
  const showStackedBar = perTv.length > 0 && totalTvCount > 1;
  
  // Build TV color map for consistent colors between chart and event log
  const tvColorMap = {};
  perTv.forEach((tv, index) => {
    tvColorMap[tv.tv_id] = CHART_COLORS[index % CHART_COLORS.length];
  });
  
  if (showStackedBar) {
    const segments = perTv.map((tv, index) => {
      const tvName = analyticsData.tvs?.[tv.tv_id]?.name || tv.tv_id || 'Unknown';
      const color = tvColorMap[tv.tv_id];
      const pct = tv.share || 0;
      return `<div class="stacked-bar-segment clickable" data-tv-id="${escapeHtml(tv.tv_id)}" style="width: ${pct}%; background: ${color}" title="${escapeHtml(tvName)} (${formatPercent(pct)}, ${formatHoursNice(tv.seconds || 0)})"></div>`;
    }).join('');
    
    const legend = perTv.map((tv, index) => {
      const tvName = analyticsData.tvs?.[tv.tv_id]?.name || tv.tv_id || 'Unknown';
      const color = tvColorMap[tv.tv_id];
      return `<span class="stacked-bar-legend-item clickable" data-tv-id="${escapeHtml(tv.tv_id)}"><span class="stacked-bar-legend-color" style="background: ${color}"></span>${escapeHtml(tvName)}</span>`;
    }).join('');
    
    html += `
      <div class="stacked-bar-section">
        <div class="stacked-bar-track">${segments}</div>
        <div class="stacked-bar-legend">${legend}</div>
      </div>
    `;
  }
  
  // Event log for this tag (show separator only if stacked bar is shown, pass TV colors for dots)
  html += renderTagEventLog(tagName, showStackedBar, tvColorMap);
  
  container.innerHTML = html;
  
  // Add click handlers for stacked bar segments
  container.querySelectorAll('.stacked-bar-segment.clickable').forEach(segment => {
    segment.addEventListener('click', () => {
      const tvId = segment.dataset.tvId;
      if (tvId) selectAnalyticsTv(tvId);
    });
  });
  
  // Add click handlers for stacked bar legend items
  container.querySelectorAll('.stacked-bar-legend-item.clickable').forEach(item => {
    item.addEventListener('click', () => {
      const tvId = item.dataset.tvId;
      if (tvId) selectAnalyticsTv(tvId);
    });
  });
  
  // Add click handlers for event log rows
  container.querySelectorAll('.event-log-row.clickable').forEach(row => {
    row.addEventListener('click', () => {
      const filename = row.dataset.filename;
      selectAnalyticsImage(filename);
    });
  });
}

function renderImageDetail(filename) {
  const container = document.getElementById('analytics-image-detail');
  const statsContainer = document.getElementById('analytics-image-stats');
  const tagsContainer = document.getElementById('analytics-image-tags');
  
  if (!container) return;
  
  if (!filename) {
    container.innerHTML = '<div class="empty-state-small">Select an image to view details</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    if (tagsContainer) tagsContainer.innerHTML = '';
    return;
  }
  
  const imageData = analyticsData?.images?.[filename];
  const galleryData = allImages?.[filename];
  
  // Get tags from gallery data if no analytics data, or from analytics data
  const tags = imageData?.tags || galleryData?.tags || [];
  
  // Render tags in header row (next to title)
  if (tagsContainer) {
    tagsContainer.innerHTML = tags.length > 0 
      ? tags.map(tag => `<span class="image-tag-pill-small">${escapeHtml(tag)}</span>`).join('')
      : '<span class="image-tag-pill-small untagged">(untagged)</span>';
  }
  
  // Get time-filtered data for this image (will be empty arrays/zeros if no analytics data)
  const perTv = imageData ? getPerTVStatsForImageInRange(filename) : [];
  
  // Calculate stats for selected time range (will be zeros if no analytics data)
  const imageStats = imageData ? calculateImageStatsForRange(filename) : { totalSeconds: 0, eventCount: 0 };
  
  // Render stats below dropdown
  if (statsContainer) {
    const lastDisplay = imageData ? getLastDisplayInfo(filename) : null;
    const lastDisplayText = lastDisplay ? lastDisplay.timeAgo : 'N/A';
    statsContainer.innerHTML = `
      <div class="stat-row-inline">
        <span class="stat-inline"><strong>${formatHoursNice(imageStats.totalSeconds)}</strong> time</span>
        <span class="stat-sep">·</span>
        <span class="stat-inline"><strong>${imageStats.eventCount}</strong> appearances</span>
        <span class="stat-sep">·</span>
        <span class="stat-inline">Last display <strong>${lastDisplayText}</strong></span>
      </div>
    `;
  }
  
  let html = '';
  
  // Image thumbnail with fallback handling for deleted images
  const displayName = getAnalyticsDisplayName(filename);
  html += `
    <div class="analytics-image-preview">
      <img src="thumbs/thumb_${encodeURIComponent(filename)}" 
           onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';" 
           alt="${escapeHtml(displayName)}" />
      <div class="analytics-image-unavailable" style="display:none;">Image not available</div>
    </div>
  `;
  
  // Build TV color map for consistent colors between chart and event log
  const tvColorMap = {};
  perTv.forEach((tv, index) => {
    tvColorMap[tv.tv_id] = CHART_COLORS[index % CHART_COLORS.length];
  });
  
  // TV breakdown - stacked horizontal bar (only if multiple TVs)
  const totalTvCount = Object.keys(analyticsData?.tvs || {}).length;
  if (perTv.length > 0 && totalTvCount > 1) {
    const segments = perTv.map((tv, index) => {
      const tvName = analyticsData.tvs?.[tv.tv_id]?.name || tv.tv_id || 'Unknown';
      const color = tvColorMap[tv.tv_id];
      const pct = tv.share || 0;
      return `<div class="stacked-bar-segment" style="width: ${pct}%; background: ${color}" title="${escapeHtml(tvName)} (${formatPercent(pct)}, ${formatHoursNice(tv.seconds || 0)})"></div>`;
    }).join('');
    
    const legend = perTv.map((tv, index) => {
      const tvName = analyticsData.tvs?.[tv.tv_id]?.name || tv.tv_id || 'Unknown';
      const color = tvColorMap[tv.tv_id];
      return `<span class="stacked-bar-legend-item"><span class="stacked-bar-legend-color" style="background: ${color}"></span>${escapeHtml(tvName)}</span>`;
    }).join('');
    
    html += `
      <div class="stacked-bar-section">
        <div class="stacked-bar-track">${segments}</div>
        <div class="stacked-bar-legend">${legend}</div>
      </div>
    `;
  }
    
  // Labeled timelines section
  if (perTv.length > 0) {
    html += `
      <div class="labeled-timelines-section">
        <div class="labeled-timelines-title">Activity Timeline</div>
        ${perTv.map((tv, index) => {
          const tvName = analyticsData.tvs?.[tv.tv_id]?.name || tv.tv_id || 'Unknown';
          const color = tvColorMap[tv.tv_id];
          const timelineHtml = renderInlineTimeline(filename, tv.tv_id);
          // Only show TV label if multiple TVs
          const labelHtml = totalTvCount > 1 ? `
            <div class="labeled-timeline-header">
              <span class="labeled-timeline-color" style="background: ${color}"></span>
              <span class="labeled-timeline-name">${escapeHtml(tvName)}</span>
              <span class="labeled-timeline-hours">${formatHoursNice(tv.seconds || 0)}</span>
            </div>
          ` : '';
          return `
          <div class="labeled-timeline-row">
            ${labelHtml}
            ${timelineHtml}
          </div>
        `}).join('')}
      </div>
    `;
  }
  
  // Event log section (pass TV colors for dots)
  html += renderImageEventLog(filename, tvColorMap);
  
  container.innerHTML = html;
}

// Helper to format relative time ago
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const diffWeeks = diffDays / 7;
  const diffMonths = diffDays / 30;
  
  if (diffHours < 1) return 'less than an hour ago';
  if (diffHours < 24) return diffHours < 2 ? 'an hour ago' : `${Math.floor(diffHours)} hours ago`;
  if (diffDays < 7) return diffDays < 2 ? 'a day ago' : `${Math.floor(diffDays)} days ago`;
  if (diffWeeks < 4) return diffWeeks < 2 ? 'a week ago' : `${Math.floor(diffWeeks)} weeks ago`;
  return diffMonths < 2 ? 'a month ago' : `${Math.floor(diffMonths)} months ago`;
}

// Render inline timeline for a specific TV
function renderInlineTimeline(filename, tvId) {
  const imageData = analyticsData?.images?.[filename];
  if (!imageData) return '';
  
  const displayPeriods = imageData.display_periods?.[tvId] || [];
  
  if (displayPeriods.length === 0) {
    // No display_periods means we have aggregate data but no timeline detail for this TV
    return '<div class="inline-timeline"><div class="inline-timeline-empty">No detailed timeline available</div></div>';
  }
  
  // Calculate timeline using selected time range
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  // Build timeline segments with detailed tooltips
  const segments = displayPeriods
    .filter(p => p.end > rangeStart)
    .map(period => {
      const start = Math.max(period.start, rangeStart);
      const end = Math.min(period.end, now);
      const leftPct = ((start - rangeStart) / rangeMs) * 100;
      const widthPct = Math.max(((end - start) / rangeMs) * 100, 0.5); // min width for visibility
      const startTime = new Date(period.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const duration = formatHoursNice((period.end - period.start) / 1000);
      const tooltip = `${startTime} (${duration})`;
      return `<div class="inline-timeline-segment" style="left: ${leftPct}%; width: ${widthPct}%" title="${escapeHtml(tooltip)}"></div>`;
    })
    .join('');
  
  if (!segments) {
    // Has display_periods but none in the selected time range - find most recent
    const mostRecent = displayPeriods.reduce((latest, p) => p.end > latest ? p.end : latest, 0);
    const timeAgo = formatTimeAgo(mostRecent);
    return `<div class="inline-timeline"><div class="inline-timeline-empty">Not displayed since ${timeAgo}</div></div>`;
  }
  
  // Generate full axis (edge labels above, ticks below)
  const axis = generateTimelineAxis(rangeStart, rangeMs, false);
  
  return `
    <div class="inline-timeline">
      ${axis.edges}
      <div class="inline-timeline-track">${segments}</div>
      ${axis.ticks}
    </div>
  `;
}

// Render event log for an image (all events in selected time range)
function renderImageEventLog(filename, tvColorMap = {}) {
  const imageData = analyticsData?.images?.[filename];
  if (!imageData || !imageData.display_periods) {
    return '';
  }
  
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  // Collect all events from all TVs within time range
  const allEvents = [];
  for (const [tvId, periods] of Object.entries(imageData.display_periods)) {
    const tvName = analyticsData.tvs?.[tvId]?.name || 'Unknown TV';
    for (const period of periods) {
      if (period.end > rangeStart) {
        allEvents.push({
          tvName,
          tvId,
          start: period.start,
          end: period.end,
          duration: period.end - period.start,
          matte: period.matte,
          photo_filter: period.photo_filter
        });
      }
    }
  }
  
  if (allEvents.length === 0) {
    return '<div class="event-log"><div class="event-log-title">Display Events</div><div class="event-log-empty">No events in selected time range</div></div>';
  }
  
  // Sort by start time descending (most recent first)
  allEvents.sort((a, b) => b.start - a.start);
  
  const hasTvColors = Object.keys(tvColorMap).length > 0;
  
  const eventRows = allEvents.map(evt => {
    const startDate = new Date(evt.start);
    // duration is in ms, convert to seconds for formatHoursNice
    const durationFormatted = formatHoursNice(evt.duration / 1000);
    const dateStr = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const filterMatteSuffix = formatFilterMatteSuffix(evt.photo_filter, evt.matte);
    const tvColor = tvColorMap[evt.tvId] || '#95a5a6';
    const tvDot = hasTvColors ? `<span class="event-log-tv-dot" style="background: ${tvColor}" title="${escapeHtml(evt.tvName)}"></span>` : '';
    
    return `
      <div class="event-log-row">
        <span class="event-log-date">${tvDot}${dateStr}</span>
        <span class="event-log-time">${timeStr}</span>
        <span class="event-log-tv"><span class="event-log-tv-text">${escapeHtml(evt.tvName)}</span>${filterMatteSuffix}</span>
        <span class="event-log-duration">${durationFormatted}</span>
      </div>
    `;
  }).join('');
  
  return `
    <div class="event-log">
      <div class="event-log-title">Display Events (${allEvents.length})</div>
      <div class="event-log-header">
        <span>Date</span>
        <span>Time</span>
        <span>TV</span>
        <span>Duration</span>
      </div>
      <div class="event-log-scroll">
        ${eventRows}
      </div>
    </div>
  `;
}

function renderImageTimeline(filename, tvId) {
  const container = document.getElementById('analytics-timeline-container');
  if (!container || !analyticsData) return;
  
  const imageData = analyticsData.images?.[filename];
  if (!imageData) {
    container.style.display = 'none';
    return;
  }
  
  // Get display periods for this TV (from imageData.display_periods if available)
  const displayPeriods = imageData.display_periods?.[tvId] || [];
  
  if (displayPeriods.length === 0) {
    // Show placeholder with generic timeline
    container.style.display = 'block';
    container.innerHTML = `
      <div class="timeline-bar-container">
        <div class="timeline-bar">
          <div class="timeline-bar-track">
            <div class="timeline-bar-empty">No detailed timeline data available</div>
          </div>
        </div>
      </div>
    `;
    return;
  }
  
  // Calculate timeline (last 7 days)
  const now = Date.now();
  const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
  const totalRange = now - weekAgo;
  
  // Build timeline segments
  const segments = displayPeriods
    .filter(p => p.end > weekAgo)
    .map(period => {
      const start = Math.max(period.start, weekAgo);
      const end = Math.min(period.end, now);
      const leftPct = ((start - weekAgo) / totalRange) * 100;
      const widthPct = ((end - start) / totalRange) * 100;
      return `<div class="timeline-bar-segment" style="left: ${leftPct}%; width: ${widthPct}%" title="${new Date(start).toLocaleString()}"></div>`;
    })
    .join('');
  
  container.style.display = 'block';
  container.innerHTML = `
    <div class="timeline-bar-container">
      <div class="timeline-bar-label">Display history (last 7 days)</div>
      <div class="timeline-bar">
        <div class="timeline-bar-track">
          ${segments || '<div class="timeline-bar-empty">No displays in last 7 days</div>'}
        </div>
      </div>
      <div class="timeline-bar-axis">
        <span>7d ago</span>
        <span>Now</span>
      </div>
    </div>
  `;
}

function setupAnalyticsEventListeners() {
  // Retry button
  const retryBtn = document.getElementById('analytics-retry-btn');
  if (retryBtn) {
    retryBtn.onclick = () => loadAnalytics();
  }
  
  // Time range buttons (time pills)
  document.querySelectorAll('#analytics-time-range-buttons .time-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      document.querySelectorAll('#analytics-time-range-buttons .time-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update selected range and re-render affected views
      selectedTimeRange = btn.dataset.range;
      updateDateRangeHint();
      if (selectedTv) renderTVDetail(selectedTv);
      // Re-render tag selector (filters by time range)
      renderTagSelector();
      if (selectedImage) renderImageDetail(selectedImage);
      // Re-render main chart too
      renderOverallPieChart();
    });
  });
  
  // Initial date range hint
  updateDateRangeHint();
  
  // TV selector
  const tvSelect = document.getElementById('analytics-tv-select');
  if (tvSelect) {
    tvSelect.onchange = (e) => {
      selectedTv = e.target.value || null;
      renderTVDetail(selectedTv);
    };
  }
  
  // Tag selector
  const tagSelect = document.getElementById('analytics-tag-select');
  if (tagSelect) {
    tagSelect.onchange = (e) => {
      selectedTag = e.target.value || null;
      renderTagDetail(selectedTag);
    };
  }
  
  // Image selector (dropdown)
  const imageSelect = document.getElementById('analytics-image-select');
  if (imageSelect) {
    imageSelect.onchange = (e) => {
      selectedImage = e.target.value || null;
      renderImageDetail(selectedImage);
    };
  }
}

function selectAnalyticsTv(tvId) {
  selectedTv = tvId;
  
  // Update TV dropdown
  const tvSelect = document.getElementById('analytics-tv-select');
  if (tvSelect) {
    tvSelect.value = tvId;
  }
  
  renderTVDetail(tvId);
}

function selectAnalyticsImage(filename) {
  selectedImage = filename;
  
  // Update image dropdown
  const imageSelect = document.getElementById('analytics-image-select');
  if (imageSelect) {
    imageSelect.value = filename;
  }
  
  renderImageDetail(filename);
}

// Helper: get display name for analytics (remove hash if unique)
function getAnalyticsDisplayName(filename) {
  const { base, ext, hasUuid } = extractBaseComponents(filename);
  if (!hasUuid) {
    return filename;
  }
  
  // Check if removing the hash would cause ambiguity with other files
  // Use allImages (all gallery files) since we now show all images in the dropdown
  const allFilenames = Object.keys(allImages || {});
  const baseWithExt = base + ext;
  const sharedBaseCount = allFilenames.filter(fn => {
    const parsed = extractBaseComponents(fn);
    return (parsed.base + parsed.ext) === baseWithExt;
  }).length;
  
  if (sharedBaseCount > 1) {
    return filename; // Keep hash to disambiguate
  }
  
  return baseWithExt; // Safe to remove hash
}

// Helper: truncate filename for display
function truncateFilename(filename, maxLen) {
  // First, get the display name (remove hash if unique)
  const displayName = getAnalyticsDisplayName(filename);
  
  if (!displayName || displayName.length <= maxLen) return displayName;
  const ext = displayName.lastIndexOf('.');
  if (ext > 0 && displayName.length - ext < 6) {
    // Keep extension
    const extPart = displayName.substring(ext);
    const namePart = displayName.substring(0, ext);
    const availLen = maxLen - extPart.length - 3;
    if (availLen > 5) {
      return namePart.substring(0, availLen) + '...' + extPart;
    }
  }
  return displayName.substring(0, maxLen - 3) + '...';
}

// Helper: format filter/matte suffix for display in event logs and gallery
// Returns a small icon with tooltip showing the non-none filter/matte values
function formatFilterMatteSuffix(photoFilter, matte) {
  const hasFilter = photoFilter && photoFilter.toLowerCase() !== 'none';
  const hasMatte = matte && matte.toLowerCase() !== 'none';
  
  if (!hasFilter && !hasMatte) return '';
  
  let html = '';
  if (hasFilter) {
    html += `<span class="indicator-filter" title="filter: ${photoFilter}">✦</span>`;
  }
  if (hasMatte) {
    html += `<span class="indicator-matte" title="matte: ${matte}">⧈</span>`;
  }
  
  return ` <span class="filter-matte-indicators">${html}</span>`;
}

// Helper: format seconds to hours (1 decimal) - legacy
function formatHours(seconds) {
  return (seconds / 3600).toFixed(1);
}

// Helper: format seconds to nice hours display (XhYm format, no decimals)
function formatHoursNice(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  
  // Show days for >= 48 hours
  if (hours >= 48) {
    const days = Math.round(hours / 24);
    return days + 'd';
  }
  // Just minutes if under 1 hour
  if (hours < 1) {
    return mins + 'm';
  }
  // XhYm format for hours >= 1
  if (mins === 0) {
    return hours + 'h';
  }
  return hours + 'h' + mins + 'm';
}

// Helper: format percentage nicely (no unnecessary decimals)
function formatPercent(value) {
  if (value >= 10 || value === 0) {
    return Math.round(value) + '%';
  }
  return value.toFixed(1).replace(/\.0$/, '') + '%';
}

// Helper: calculate TV stats for the selected time range
function calculateTVStatsForRange(tvId) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const images = analyticsData?.images || {};
  let totalSeconds = 0;
  let eventCount = 0;
  
  // Sum up display time for this TV across all images in the time range
  for (const [filename, imageData] of Object.entries(images)) {
    const periods = imageData.display_periods?.[tvId] || [];
    for (const period of periods) {
      if (period.end > rangeStart) {
        const start = Math.max(period.start, rangeStart);
        const end = Math.min(period.end, now);
        totalSeconds += (end - start) / 1000;
        eventCount++;
      }
    }
  }
  
  // Calculate share of total (all TVs in this time range)
  let allTVsTotal = 0;
  const tvIds = Object.keys(analyticsData?.tvs || {});
  for (const otherTvId of tvIds) {
    for (const [filename, imageData] of Object.entries(images)) {
      const periods = imageData.display_periods?.[otherTvId] || [];
      for (const period of periods) {
        if (period.end > rangeStart) {
          const start = Math.max(period.start, rangeStart);
          const end = Math.min(period.end, now);
          allTVsTotal += (end - start) / 1000;
        }
      }
    }
  }
  
  const shareOfTotal = allTVsTotal > 0 ? (totalSeconds / allTVsTotal) * 100 : 0;
  
  return { totalSeconds, eventCount, shareOfTotal };
}

// Helper: get tags that have activity in the selected time range
function getTagsWithActivityInRange() {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const images = analyticsData?.images || {};
  const tagsWithActivity = new Set();
  
  for (const [filename, imageData] of Object.entries(images)) {
    // Check if this image has any display periods in range
    let hasActivityInRange = false;
    for (const periods of Object.values(imageData.display_periods || {})) {
      for (const period of periods) {
        if (period.end > rangeStart) {
          hasActivityInRange = true;
          break;
        }
      }
      if (hasActivityInRange) break;
    }
    
    if (hasActivityInRange) {
      const imageTags = imageData.tags || [];
      if (imageTags.length === 0) {
        tagsWithActivity.add('<none>');
      } else {
        imageTags.forEach(tag => tagsWithActivity.add(tag));
      }
    }
  }
  
  return Array.from(tagsWithActivity);
}

// Helper: calculate tag stats for the selected time range
function calculateTagStatsForRange(tagName) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const images = analyticsData?.images || {};
  let totalSeconds = 0;
  let eventCount = 0;
  
  for (const [filename, imageData] of Object.entries(images)) {
    const imageTags = imageData.tags || [];
    const hasTag = tagName === '<none>' 
      ? imageTags.length === 0 
      : imageTags.includes(tagName);
    
    if (!hasTag) continue;
    
    for (const [tvId, periods] of Object.entries(imageData.display_periods || {})) {
      for (const period of periods) {
        if (period.end > rangeStart) {
          const start = Math.max(period.start, rangeStart);
          const end = Math.min(period.end, now);
          totalSeconds += (end - start) / 1000;
          eventCount++;
        }
      }
    }
  }
  
  return { totalSeconds, eventCount };
}

// Helper: calculate image stats for the selected time range
function calculateImageStatsForRange(filename) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const imageData = analyticsData?.images?.[filename];
  if (!imageData) return { totalSeconds: 0, eventCount: 0, tvCount: 0 };
  
  let totalSeconds = 0;
  let eventCount = 0;
  const tvsWithActivity = new Set();
  
  for (const [tvId, periods] of Object.entries(imageData.display_periods || {})) {
    for (const period of periods) {
      if (period.end > rangeStart) {
        const start = Math.max(period.start, rangeStart);
        const end = Math.min(period.end, now);
        totalSeconds += (end - start) / 1000;
        eventCount++;
        tvsWithActivity.add(tvId);
      }
    }
  }
  
  return { totalSeconds, eventCount, tvCount: tvsWithActivity.size };
}

// Helper: get top images for a TV within the selected time range
function getTopImagesForTVInRange(tvId) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const images = analyticsData?.images || {};
  const imageSeconds = {};
  
  for (const [filename, imageData] of Object.entries(images)) {
    const periods = imageData.display_periods?.[tvId] || [];
    let seconds = 0;
    for (const period of periods) {
      if (period.end > rangeStart) {
        const start = Math.max(period.start, rangeStart);
        const end = Math.min(period.end, now);
        seconds += (end - start) / 1000;
      }
    }
    if (seconds > 0) {
      imageSeconds[filename] = seconds;
    }
  }
  
  // Sort by seconds descending and return top entries
  return Object.entries(imageSeconds)
    .map(([filename, seconds]) => ({ filename, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

// Helper: get top images for a tag within the selected time range
function getTopImagesForTagInRange(tagName) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const images = analyticsData?.images || {};
  const imageSeconds = {};
  
  for (const [filename, imageData] of Object.entries(images)) {
    const imageTags = imageData.tags || [];
    const hasTag = tagName === '<none>' 
      ? imageTags.length === 0 
      : imageTags.includes(tagName);
    
    if (!hasTag) continue;
    
    let seconds = 0;
    for (const [tvId, periods] of Object.entries(imageData.display_periods || {})) {
      for (const period of periods) {
        if (period.end > rangeStart) {
          const start = Math.max(period.start, rangeStart);
          const end = Math.min(period.end, now);
          seconds += (end - start) / 1000;
        }
      }
    }
    if (seconds > 0) {
      imageSeconds[filename] = seconds;
    }
  }
  
  return Object.entries(imageSeconds)
    .map(([filename, seconds]) => ({ filename, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

// Helper: get per-TV stats for an image within the selected time range
function getPerTVStatsForImageInRange(filename) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const imageData = analyticsData?.images?.[filename];
  if (!imageData) return [];
  
  const tvStats = {};
  let totalSeconds = 0;
  
  for (const [tvId, periods] of Object.entries(imageData.display_periods || {})) {
    let seconds = 0;
    for (const period of periods) {
      if (period.end > rangeStart) {
        const start = Math.max(period.start, rangeStart);
        const end = Math.min(period.end, now);
        seconds += (end - start) / 1000;
      }
    }
    if (seconds > 0) {
      tvStats[tvId] = seconds;
      totalSeconds += seconds;
    }
  }
  
  // Return array with share percentages
  return Object.entries(tvStats)
    .map(([tv_id, seconds]) => ({
      tv_id,
      seconds,
      share: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

// Helper: get per-TV stats for a tag within the selected time range
function getPerTVStatsForTagInRange(tagName) {
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  const images = analyticsData?.images || {};
  const tvStats = {};
  let totalSeconds = 0;
  
  for (const [filename, imageData] of Object.entries(images)) {
    const imageTags = imageData.tags || [];
    const hasTag = tagName === '<none>' 
      ? imageTags.length === 0 
      : imageTags.includes(tagName);
    
    if (!hasTag) continue;
    
    for (const [tvId, periods] of Object.entries(imageData.display_periods || {})) {
      for (const period of periods) {
        if (period.end > rangeStart) {
          const start = Math.max(period.start, rangeStart);
          const end = Math.min(period.end, now);
          const seconds = (end - start) / 1000;
          tvStats[tvId] = (tvStats[tvId] || 0) + seconds;
          totalSeconds += seconds;
        }
      }
    }
  }
  
  return Object.entries(tvStats)
    .map(([tv_id, seconds]) => ({
      tv_id,
      seconds,
      share: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

// Helper: format date range for display
function formatDateRange(startMs, endMs) {
  const startDate = new Date(startMs);
  const startStr = startDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return `[data since ${startStr}]`;
}

// Update the date range hint in the header
function updateDateRangeHint() {
  const hintEl = document.getElementById('analytics-date-range');
  if (!hintEl) return;
  
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  // Map time range to human-readable label
  const rangeLabels = {
    '1h': 'hour',
    '1d': 'day',
    '1w': 'week',
    '1mo': 'month',
    '6mo': '6 months'
  };
  const rangeLabel = rangeLabels[selectedTimeRange] || 'week';
  
  const startDate = new Date(rangeStart);
  
  // For hour/day, include time; for longer ranges, just date
  let dateStr;
  if (selectedTimeRange === '1h' || selectedTimeRange === '1d') {
    dateStr = startDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) +
              ' at ' + startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } else {
    dateStr = startDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  
  hintEl.textContent = `Displaying last ${rangeLabel} of shuffle data (since ${dateStr})`;
}

// Render event log for a tag (all events for images with this tag)
function renderTagEventLog(tagName, showSeparator = true, tvColorMap = {}) {
  const images = analyticsData?.images || {};
  const tvs = analyticsData?.tvs || {};
  
  const now = Date.now();
  const rangeMs = TIME_RANGES[selectedTimeRange] || TIME_RANGES['1w'];
  const rangeStart = now - rangeMs;
  
  // Collect all events for images with this tag
  const allEvents = [];
  
  for (const [filename, imageData] of Object.entries(images)) {
    const imageTags = imageData.tags || [];
    const hasTag = tagName === '<none>' 
      ? imageTags.length === 0 
      : imageTags.includes(tagName);
    
    if (!hasTag) continue;
    
    for (const [tvId, periods] of Object.entries(imageData.display_periods || {})) {
      const tvName = tvs[tvId]?.name || 'Unknown TV';
      for (const period of periods) {
        if (period.end > rangeStart) {
          allEvents.push({
            filename,
            tvId,
            tvName,
            start: period.start,
            end: period.end,
            duration: period.end - period.start,
            matte: period.matte,
            photo_filter: period.photo_filter
          });
        }
      }
    }
  }
  
  const separatorClass = showSeparator ? '' : ' no-separator';
  const hasTvColors = Object.keys(tvColorMap).length > 0;
  
  if (allEvents.length === 0) {
    return `<div class="event-log${separatorClass}"><div class="event-log-title">Display Events</div><div class="event-log-empty">No events in selected time range</div></div>`;
  }
  
  // Sort by start time descending
  allEvents.sort((a, b) => b.start - a.start);
  
  const eventRows = allEvents.map(evt => {
    const startDate = new Date(evt.start);
    const dateStr = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const imageName = truncateFilename(evt.filename, 18);
    const filterMatteSuffix = formatFilterMatteSuffix(evt.photo_filter, evt.matte);
    const tvColor = tvColorMap[evt.tvId] || '#95a5a6';
    const tvDot = hasTvColors ? `<span class="event-log-tv-dot" style="background: ${tvColor}" title="${escapeHtml(evt.tvName)}"></span>` : '';
    
    return `
      <div class="event-log-row clickable" data-filename="${escapeHtml(evt.filename)}">
        <span class="event-log-date">${tvDot}${dateStr}</span>
        <span class="event-log-time">${timeStr}</span>
        <span class="event-log-image"><span class="event-log-image-text">${escapeHtml(imageName)}</span>${filterMatteSuffix}</span>
        <span class="event-log-duration">${formatHoursNice((evt.duration) / 1000)}</span>
      </div>
    `;
  }).join('');
  
  return `
    <div class="event-log${separatorClass}">
      <div class="event-log-title">Display Events (${allEvents.length})</div>
      <div class="event-log-header">
        <span>Date</span>
        <span>Time</span>
        <span>Image</span>
        <span>Duration</span>
      </div>
      <div class="event-log-scroll">
        ${eventRows}
      </div>
    </div>
  `;
}
