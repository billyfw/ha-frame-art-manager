// API Base URL
const API_BASE = 'api';

// Global state
let libraryPath = null; // Store library path for tooltips
let isSyncInProgress = false; // Track if a sync operation is currently running

// State
let allImages = {};
let allTags = [];
let allTVs = [];
let currentImage = null;
let selectedImages = new Set();
let lastClickedIndex = null;
let sortAscending = true; // true = ascending (A-Z, oldest first), false = descending

const createDefaultEditState = () => ({
  active: false,
  hasBackup: false,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  adjustments: { brightness: 0, contrast: 0 },
  filter: 'none',
  naturalWidth: 0,
  naturalHeight: 0,
  cropPreset: 'free',
  activeTool: null,
  isDirty: false
});

let editState = createDefaultEditState();
let editControls = null;
let cropInteraction = null;

// Hash-based routing
function handleRoute() {
  const hash = window.location.hash.slice(1) || '/'; // Remove '#' and default to '/'
  
  if (hash.startsWith('/advanced')) {
    const parts = hash.split('/');
    const subTab = parts[2] || 'settings'; // /advanced/sync -> 'sync'
    switchToTab('advanced');
    switchToAdvancedSubTab(subTab);
  } else if (hash === '/upload') {
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
  // Remove active class from all buttons and contents
  document.querySelectorAll('.advanced-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.advanced-tab-content').forEach(content => content.classList.remove('active'));
  
  // Add active class to target button and content
  const targetButton = document.querySelector(`[data-tab="${tabName}"]`);
  const targetContent = document.getElementById(`advanced-${tabName}-content`);
  
  if (targetButton) targetButton.classList.add('active');
  if (targetContent) targetContent.classList.add('active');
  
  // Reload data based on which sub-tab
  if (tabName === 'sync') {
    // Always reload sync status when viewing sync tab
    // Use setTimeout to ensure DOM is fully ready
    setTimeout(() => {
      console.log('Loading sync status...');
      loadSyncStatus();
      loadSyncLogs();
    }, 0);
  } else if (tabName === 'metadata') {
    // Reload metadata when viewing metadata tab
    loadMetadata();
  }
  // settings tab doesn't need reload, data is already loaded
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

  // Ensure options exist on first open
  const optionsContainer = dropdown.querySelector('.multiselect-options');
  if (optionsContainer && optionsContainer.children.length === 0) {
    try { void loadTagsForFilter(); } catch {}
  }

  // Reposition on resize/scroll while open
  tagDropdownState.resizeHandler = () => positionTagDropdownToButton();
  tagDropdownState.scrollHandler = () => positionTagDropdownToButton();
  window.addEventListener('resize', tagDropdownState.resizeHandler);
  window.addEventListener('scroll', tagDropdownState.scrollHandler, true);

  tagDropdownState.isOpen = true;
}

function closeTagDropdownPortal() {
  const { btn, dropdown } = getTagFilterElements();
  if (!dropdown || !tagDropdownState.isOpen) {
    // Also ensure inline display is off even if we think it's closed
    if (dropdown) {
      dropdown.classList.remove('active');
      dropdown.style.display = 'none';
      dropdown.style.pointerEvents = 'none'; // Ensure it can't intercept clicks
    }
    if (btn) btn.classList.remove('active');
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
  if (btn) btn.classList.remove('active');

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

// Helper function to get display name without UUID
function getDisplayName(filename) {
  // Remove UUID pattern (8 hex chars before extension): name-a1b2c3d4.jpg -> name
  const ext = filename.substring(filename.lastIndexOf('.'));
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
  
  // Check if it ends with -UUID pattern (dash followed by 8 hex chars)
  const uuidPattern = /-[0-9a-f]{8}$/i;
  if (!uuidPattern.test(nameWithoutExt)) {
    return filename; // No UUID, return as-is
  }
  
  const baseNameWithoutUUID = nameWithoutExt.substring(0, nameWithoutExt.lastIndexOf('-'));
  const displayName = baseNameWithoutUUID + ext;
  
  // Check if there are multiple images with the same base name
  const allFilenames = Object.keys(allImages);
  const sameBasisCount = allFilenames.filter(fn => {
    const fnExt = fn.substring(fn.lastIndexOf('.'));
    const fnNameWithoutExt = fn.substring(0, fn.lastIndexOf('.'));
    
    if (uuidPattern.test(fnNameWithoutExt)) {
      const fnBase = fnNameWithoutExt.substring(0, fnNameWithoutExt.lastIndexOf('-'));
      return (fnBase + fnExt) === displayName;
    }
    return fn === displayName;
  }).length;
  
  // If there are duplicates, show the full filename with UUID and extension
  if (sameBasisCount > 1) {
    return filename;
  }
  
  // No duplicates - return just the base name without UUID or extension
  return baseNameWithoutUUID;
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

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  loadLibraryPath();
  initCloudSyncButton(); // Initialize cloud sync button in toolbar - BEFORE checking sync
  
  // Set up hash-based routing
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('load', handleRoute);
  
  // Load UI first so user can start working immediately
  await loadTVs(); // Load TVs first so they're available for the filter dropdown
  loadGallery();
  loadTags();
  initUploadForm();
  initBatchUploadForm(); // Initialize batch upload
  initTVForm();
  initTagForm();
  initModal();
  initMetadataViewer();
  initSyncDetail();
  initBulkActions();
  initTVModal();
  initTVTagPickerModal();
  initSettingsNavigation();
  initUploadNavigation();
  
  // Handle initial route
  handleRoute();
  
  // Check for sync updates in the background (after UI is loaded)
  checkSyncOnLoad();
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
}

async function refreshGalleryAfterSync(syncData) {
  const previousKeys = new Set(Object.keys(allImages || {}));
  await loadGallery();
  const currentKeys = Object.keys(allImages || {});
  const addedKeys = currentKeys.filter(key => !previousKeys.has(key));

  if (addedKeys.length > 0 || hasRemoteNewImages(syncData)) {
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
    
    // Store globally for use in tooltips
    libraryPath = pathValue;
    
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
    loadTVs(); // Load TVs when opening Advanced
    loadMetadata();
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
  const goHomeBtn = document.getElementById('go-home-btn');

  if (openAdvancedBtn) {
    openAdvancedBtn.addEventListener('click', () => {
      // Close any open dropdowns in the gallery toolbar
      const tagFilterBtn = document.getElementById('tag-filter-btn');
      const tagFilterDropdown = document.getElementById('tag-filter-dropdown');
      tagFilterBtn?.classList.remove('active');
      tagFilterDropdown?.classList.remove('active');
      // Also ensure hidden and portal closed
      closeTagDropdownPortal();
      navigateTo('/advanced/settings');
    });
  }

  if (goHomeBtn) {
    goHomeBtn.addEventListener('click', () => {
      navigateTo('/');
    });
  }

  // Initialize advanced sub-tabs
  initAdvancedSubTabs();
}

function initAdvancedSubTabs() {
  const tabButtons = document.querySelectorAll('.advanced-tab-btn');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      navigateTo(`/advanced/${tabName}`);
    });
  });
}

// Gallery Functions
async function loadGallery() {
  const grid = document.getElementById('image-grid');
  grid.innerHTML = '<div class="loading">Loading images...</div>';

  try {
    const response = await fetch(`${API_BASE}/images`);
    allImages = await response.json();

    // Also load tags for filter dropdown
    await loadTagsForFilter();

    renderGallery();
  } catch (error) {
    console.error('Error loading gallery:', error);
    grid.innerHTML = '<div class="error">Failed to load images</div>';
  }
}

// Selection Functions
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
  renderGallery();
}

function updateBulkActionsBar() {
  const bulkActions = document.getElementById('bulk-actions');
  const selectedCount = document.getElementById('selected-count');
  
  if (selectedImages.size > 0) {
    bulkActions.classList.add('visible');
    selectedCount.textContent = selectedImages.size;
  } else {
    bulkActions.classList.remove('visible');
  }
}

function clearSelection() {
  selectedImages.clear();
  lastClickedIndex = null;
  renderGallery();
}

function selectAllImages() {
  // Get all currently visible/filtered images
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const selectedTagCheckboxes = document.querySelectorAll('.tag-checkbox:checked');
  const selectedTags = Array.from(selectedTagCheckboxes).map(cb => cb.value);

  let filteredImages = Object.entries(allImages);

  // Apply same filters as renderGallery
  if (searchTerm) {
    filteredImages = filteredImages.filter(([filename]) => 
      filename.toLowerCase().includes(searchTerm)
    );
  }

  if (selectedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => 
      data.tags && selectedTags.some(tag => data.tags.includes(tag))
    );
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
  
  modal.classList.add('visible');
  console.log('modal classes after add:', modal.className);
}

function renderBulkTagBadges(containerId, tags, isPartial) {
  const container = document.getElementById(containerId);
  
  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = tags.sort().map(tag => `
    <div class="tag-item${isPartial ? ' partial' : ''}">
      <div class="tag-content">
        <span class="tag-name">${tag}</span>
        ${isPartial ? `<a href="#" class="tag-make-all" onclick="makeTagAll('${tag}'); return false;">make all</a>` : ''}
      </div>
      <button class="tag-remove" onclick="removeBulkTag('${tag}', ${isPartial})" title="Remove tag">×</button>
    </div>
  `).join('');
}

async function removeBulkTag(tagName, isPartial) {
  const selectedArray = Array.from(selectedImages);
  let successCount = 0;
  let errorCount = 0;
  
  // Remove tag from all selected images that have it
  for (const filename of selectedArray) {
    try {
      const imageData = allImages[filename];
      const existingTags = imageData.tags || [];
      
      // Only update if this image has the tag
      if (existingTags.includes(tagName)) {
        const newTags = existingTags.filter(t => t !== tagName);
        
        const response = await fetch(`${API_BASE}/images/${filename}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: newTags })
        });
        
        const result = await response.json();
        if (result.success) {
          successCount++;
          // Update local cache
          allImages[filename].tags = newTags;
        } else {
          errorCount++;
        }
      }
    } catch (error) {
      console.error(`Error removing tag from ${filename}:`, error);
      errorCount++;
    }
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
  
  // Reload gallery in background
  loadGallery();
  
  // Update sync status since metadata changed
  await updateSyncStatus();
}

async function makeTagAll(tagName) {
  const selectedArray = Array.from(selectedImages);
  let successCount = 0;
  let errorCount = 0;
  
  // Add tag to all selected images that don't have it
  for (const filename of selectedArray) {
    try {
      const imageData = allImages[filename];
      const existingTags = imageData.tags || [];
      
      // Only update if this image doesn't have the tag
      if (!existingTags.includes(tagName)) {
        const newTags = [...existingTags, tagName];
        
        const response = await fetch(`${API_BASE}/images/${filename}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: newTags })
        });
        
        const result = await response.json();
        if (result.success) {
          successCount++;
          // Update local cache
          allImages[filename].tags = newTags;
        } else {
          errorCount++;
        }
      }
    } catch (error) {
      console.error(`Error adding tag to ${filename}:`, error);
      errorCount++;
    }
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
  
  // Reload gallery in background
  loadGallery();
  
  // Update sync status since metadata changed
  await updateSyncStatus()
}

function closeBulkTagModal() {
  const modal = document.getElementById('bulk-tag-modal');
  modal.classList.remove('visible');
  document.getElementById('bulk-tags-input').value = '';
}

async function saveBulkTags() {
  const tagsInput = document.getElementById('bulk-tags-input').value;
  const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
  
  if (tags.length === 0) {
    alert('Please enter at least one tag');
    return;
  }
  
  const selectedArray = Array.from(selectedImages);
  let successCount = 0;
  let errorCount = 0;
  
  // Update each selected image
  for (const filename of selectedArray) {
    try {
      const imageData = allImages[filename];
      const existingTags = imageData.tags || [];
      const newTags = [...new Set([...existingTags, ...tags])]; // Merge and dedupe
      
      const response = await fetch(`${API_BASE}/images/${filename}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags })
      });
      
      const result = await response.json();
      if (result.success) {
        successCount++;
        // Update local cache
        allImages[filename].tags = newTags;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Error updating ${filename}:`, error);
      errorCount++;
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
  
  // Show result
  if (errorCount > 0) {
    alert(`Added tags to ${successCount} images. ${errorCount} failed.`);
  }
  
  // Reload gallery and tags in background
  await loadGallery();
  await loadTags();
  
  // Update sync status since metadata changed
  await updateSyncStatus();
}

// Image modal tag management functions
function renderImageTagBadges(tags) {
  const container = document.getElementById('modal-tags-badges');
  
  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = tags.sort().map(tag => `
    <div class="tag-item">
      <div class="tag-content">
        <span class="tag-name">${tag}</span>
      </div>
      <button class="tag-remove" onclick="removeImageTag('${tag}')" title="Remove tag">×</button>
    </div>
  `).join('');
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
      
      // Re-render badges
      renderImageTagBadges(newTags);
      
      // Reload gallery in background
      loadGallery();
      
      // Update sync status since metadata changed
      await updateSyncStatus()
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
    if (result.success) {
      console.log(`✅ [TAG CHANGE] Tags updated successfully for ${currentImage}`);
      
      // Update local cache
      allImages[currentImage].tags = newTags;
      
      // Clear input and re-render badges
      document.getElementById('modal-tags-input').value = '';
      renderImageTagBadges(newTags);
      
      // Reload gallery and tags in background
      loadGallery();
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

function renderGallery(filter = '') {
  const grid = document.getElementById('image-grid');
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const selectedTagCheckboxes = document.querySelectorAll('.tag-checkbox:checked');
  const selectedTags = Array.from(selectedTagCheckboxes).map(cb => cb.value);
  const sortOrder = document.getElementById('sort-order').value;

  let filteredImages = Object.entries(allImages);

  // Filter by search term
  if (searchTerm) {
    filteredImages = filteredImages.filter(([filename]) => 
      filename.toLowerCase().includes(searchTerm)
    );
  }

  // Filter by tags (image must have ANY of the selected tags)
  if (selectedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => 
      data.tags && selectedTags.some(tag => data.tags.includes(tag))
    );
  }

  // Sort images
  filteredImages.sort((a, b) => {
    const [filenameA, dataA] = a;
    const [filenameB, dataB] = b;
    
    let comparison = 0;
    if (sortOrder === 'date') {
      // Sort by date added
      const dateA = new Date(dataA.added || 0);
      const dateB = new Date(dataB.added || 0);
      comparison = dateA - dateB; // older first when ascending
    } else {
      // Sort by name (alphabetically)
      comparison = filenameA.localeCompare(filenameB);
    }
    
    // Reverse if descending
    return sortAscending ? comparison : -comparison;
  });

  if (filteredImages.length === 0) {
    grid.innerHTML = '<div class="empty-state">No images found</div>';
    return;
  }

  grid.innerHTML = filteredImages.map(([filename, data], index) => {
    const isSelected = selectedImages.has(filename);
    
    // Check if image is 16:9 (aspect ratio ~1.78)
    const is16x9 = data.aspectRatio && Math.abs(data.aspectRatio - 1.78) < 0.05;
    
    // Format date
    const dateAdded = formatDate(data.added);
    
    return `
    <div class="image-card ${isSelected ? 'selected' : ''}" 
         data-filename="${filename}" 
         data-index="${index}">
      <div class="image-wrapper">
        <img src="thumbs/thumb_${filename}" 
             onerror="this.src='library/${filename}'" 
             alt="${getDisplayName(filename)}" />
        <button class="select-badge" data-filename="${filename}" data-index="${index}" title="Select image">
          <span class="select-icon">☑</span>
        </button>
      </div>
      <div class="image-info">
        <div class="image-filename">${getDisplayName(filename)}</div>
        ${is16x9 ? '<span class="aspect-badge">16:9</span>' : ''}
        <div class="image-tags">
          ${(data.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
        ${dateAdded ? `<div class="image-date">${dateAdded}</div>` : ''}
      </div>
    </div>
  `;
  }).join('');

  // Add click listeners to image cards
  const imageCards = grid.querySelectorAll('.image-card');
  imageCards.forEach(card => {
    card.addEventListener('click', (e) => {
      // Check if clicked on select badge
      if (e.target.closest('.select-badge')) {
        e.stopPropagation();
        // Create a synthetic event that mimics Cmd/Ctrl+click for toggle behavior
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
        // Normal click opens modal
        openImageModal(card.dataset.filename);
      }
    });
  });

  updateBulkActionsBar();
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
      // Uncheck all tag checkboxes
      const checkboxes = document.querySelectorAll('.tag-checkbox:checked');
      checkboxes.forEach(cb => cb.checked = false);
      updateTagFilterDisplay();
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

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (DEBUG_ALWAYS_SHOW_TAG_DROPDOWN) return;
    const { btn, dropdown } = getTagFilterElements();
    if (!dropdown || !btn) return;
    const clickInsideDropdown = dropdown.contains(e.target);
    const clickOnButton = btn.contains(e.target);
    // IMPORTANT: Don't intercept clicks on the gear button
    const clickOnGear = e.target.closest('#open-advanced-btn');
    if (!clickInsideDropdown && !clickOnButton && !clickOnGear) {
      console.log('[TagDropdown] outside click - closing');
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
    });
  }
});

// Fallback: ensure gear button opens Advanced even if initSettingsNavigation didn't bind
// (No fallback gear handler needed now that UI binds first.)

function updateSortDirectionIcon() {
  const icon = document.getElementById('sort-direction-icon');
  if (icon) {
    icon.textContent = sortAscending ? '⬆' : '⬇';
  }
}

function updateTagFilterCount() {
  // This function is no longer needed with custom dropdown
  // Keeping for backwards compatibility
}

// Upload Functions
function updateUploadPreview(file) {
  const container = document.getElementById('upload-preview-container');
  const previewImage = document.getElementById('upload-preview-image');

  if (!container || !previewImage) return;

  if (!file) {
    previewImage.src = '';
    container.classList.add('hidden');
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  previewImage.src = objectUrl;
  container.classList.remove('hidden');

  previewImage.onload = () => URL.revokeObjectURL(objectUrl);
}

function initUploadForm() {
  const form = document.getElementById('upload-form');
  if (!form) return;

  const fileInput = document.getElementById('image-file');
  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
      updateUploadPreview(file);
    });
  }

  form.addEventListener('reset', () => updateUploadPreview(null));
  updateUploadPreview(null);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const statusDiv = document.getElementById('upload-status');
    const submitButton = form.querySelector('button[type="submit"]');
    
    statusDiv.innerHTML = '<div class="info">Uploading...</div>';
    submitButton.disabled = true;

    try {
      const response = await fetch(`${API_BASE}/images/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        // Set sort to Date Added, descending (newest first) BEFORE navigation
        const sortOrderSelect = document.getElementById('sort-order');
        if (sortOrderSelect) {
          sortOrderSelect.value = 'date';
          // Trigger resize to accommodate "Date Added" text width
          const event = new Event('change', { bubbles: true });
          sortOrderSelect.dispatchEvent(event);
        }
        sortAscending = false; // descending
        updateSortDirectionIcon();
        
        // Reset form for next use
  form.reset();
        statusDiv.innerHTML = '';
        submitButton.disabled = false;
        
        // Reload tags in case new ones were added
        await loadTags();
        
        // Close upload modal and return to gallery (this will call loadGallery automatically)
        navigateTo('/');
        
        // Trigger auto-sync (has built-in guards for sync-in-progress)
        await manualSync();
      } else {
        statusDiv.innerHTML = `<div class="error">Upload failed: ${result.error}</div>`;
        submitButton.disabled = false;
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      statusDiv.innerHTML = '<div class="error">Upload failed</div>';
      submitButton.disabled = false;
    }
  });
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
      
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
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
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const skippedFiles = [];
  const totalFiles = files.length;
  
  // Show progress indicator in gallery
  const grid = document.getElementById('image-grid');
  const progressDiv = document.createElement('div');
  progressDiv.className = 'loading';
  progressDiv.style.fontSize = '1.2rem';
  progressDiv.style.padding = '40px';
  progressDiv.innerHTML = `Uploading ${totalFiles} image${totalFiles !== 1 ? 's' : ''}...<br><span style="font-size: 1.5rem; font-weight: bold;">0 / ${totalFiles}</span>`;
  grid.innerHTML = '';
  grid.appendChild(progressDiv);
  
  // Upload each file with default metadata
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Check file size before uploading
    if (file.size > MAX_FILE_SIZE) {
      skippedCount++;
      skippedFiles.push({
        name: file.name,
        size: formatFileSize(file.size)
      });
      console.warn(`Skipped ${file.name}: ${formatFileSize(file.size)} exceeds 5MB limit`);
      
      // Update progress
      const completedCount = i + 1;
      progressDiv.innerHTML = `Processing ${totalFiles} image${totalFiles !== 1 ? 's' : ''}...<br><span style="font-size: 1.5rem; font-weight: bold;">${completedCount} / ${totalFiles}</span>`;
      continue;
    }
    
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('matte', 'none'); // Default metadata
      formData.append('filter', 'none'); // Default metadata
      formData.append('tags', ''); // No tags by default
      
      const response = await fetch(`${API_BASE}/images/upload`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
        console.error(`Failed to upload ${file.name}:`, result.error);
      }
      
      // Update progress
      const completedCount = i + 1;
      progressDiv.innerHTML = `Processing ${totalFiles} image${totalFiles !== 1 ? 's' : ''}...<br><span style="font-size: 1.5rem; font-weight: bold;">${completedCount} / ${totalFiles}</span>`;
      
    } catch (error) {
      errorCount++;
      console.error(`Error uploading ${file.name}:`, error);
    }
  }
  
  // Build summary message
  let summaryParts = [];
  
  if (successCount > 0) {
    summaryParts.push(`${successCount} image${successCount !== 1 ? 's' : ''} uploaded successfully`);
  }
  
  if (skippedCount > 0) {
    summaryParts.push(`${skippedCount} skipped (over 5MB limit)`);
  }
  
  if (errorCount > 0) {
    summaryParts.push(`${errorCount} failed`);
  }
  
  // Show result summary if there were issues
  if (skippedCount > 0 || errorCount > 0) {
    let message = 'Batch upload completed:\n\n' + summaryParts.join('\n');
    
    if (skippedFiles.length > 0) {
      message += '\n\nSkipped files (over 5MB):';
      skippedFiles.forEach(file => {
        message += `\n• ${file.name} (${file.size})`;
      });
    }
    
    alert(message);
  }
  
  // Reload gallery and tags
  await loadGallery();
  await loadTags();
  
  // Trigger auto-sync
  await manualSync();
}

// TV Management
function ensureTVCollections(tv = {}) {
  if (!Array.isArray(tv.tags)) {
    if (typeof tv.tags === 'string' && tv.tags.trim().length > 0) {
      tv.tags = [tv.tags.trim()];
    } else {
      tv.tags = [];
    }
  }

  if (!Array.isArray(tv.notTags)) {
    if (typeof tv.notTags === 'string' && tv.notTags.trim().length > 0) {
      tv.notTags = [tv.notTags.trim()];
    } else {
      tv.notTags = [];
    }
  }

  return tv;
}

function serializeTagsForDataAttribute(tags = []) {
  const json = JSON.stringify(Array.isArray(tags) ? tags : []);
  return json.replace(/'/g, '&#39;');
}

async function loadTVs() {
  try {
    const response = await fetch(`${API_BASE}/tvs`);
    const tvs = await response.json();
    allTVs = Array.isArray(tvs) ? tvs.map(ensureTVCollections) : [];
    renderTVList();
    // Update TV shortcuts in the tag filter dropdown
    loadTagsForFilter();
  } catch (error) {
    console.error('Error loading TVs:', error);
  }
}

function renderTVList() {
  const list = document.getElementById('tv-list');
  
  if (allTVs.length === 0) {
    list.innerHTML = '<div class="empty-state">No TVs added yet</div>';
    return;
  }

  list.innerHTML = allTVs.map(tv => {
    ensureTVCollections(tv);
    const tvTags = tv.tags || [];
    const notTags = tv.notTags || [];
    const tagText = tvTags.length === 0 ? 'All images' : 
                    tvTags.length === 1 ? tvTags[0] : 
                    tvTags.join(', ');
    const notTagText = notTags.length === 0 ? 'No exclusions' : 
                       notTags.length === 1 ? notTags[0] : 
                       notTags.join(', ');
    
    return `
    <div class="list-item list-item-clickable" onclick="openTVModal('${tv.id}')">
      <div class="list-item-info">
        <div class="list-item-name">${tv.name}</div>
        <div class="list-item-detail">${tv.ip}</div>
        <div class="list-item-detail">${tagText}</div>
        <div class="list-item-detail"><strong>Exclude:</strong> ${notTagText}</div>
        <div class="list-item-detail"><strong>Home:</strong> ${tv.home || 'Madrone'}</div>
      </div>
    </div>
  `;
  }).join('');
}

function initTVForm() {
  const form = document.getElementById('tv-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

  const name = document.getElementById('tv-name').value;
  const ip = document.getElementById('tv-ip').value;
  const homeSelect = document.getElementById('tv-home');
  const home = homeSelect ? homeSelect.value : 'Madrone';

    try {
      const response = await fetch(`${API_BASE}/tvs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ip, home })
      });

      const result = await response.json();

      if (result.success) {
        form.reset();
        if (homeSelect) homeSelect.value = 'Madrone';
        loadTVs();
      }
    } catch (error) {
      console.error('Error adding TV:', error);
    }
  });
}

async function removeTV(tvId) {
  if (!confirm('Are you sure you want to remove this TV?')) return;

  try {
    await fetch(`${API_BASE}/tvs/${tvId}`, { method: 'DELETE' });
    loadTVs();
  } catch (error) {
    console.error('Error removing TV:', error);
  }
}

let currentTVId = null;
let currentTVTagPickerMode = 'include';

function openTVModal(tvId) {
  const tv = allTVs.find(t => t.id === tvId);
  if (!tv) return;

  currentTVId = tvId;
  ensureTVCollections(tv);
  
  // Populate modal fields
  document.getElementById('tv-modal-name').value = tv.name;
  document.getElementById('tv-modal-ip').value = tv.ip;
  document.getElementById('tv-modal-date').textContent = formatDate(tv.added);
  // Set home toggle
  const homeValue = tv.home || 'Madrone';
  const madroneBtn = document.getElementById('tv-home-madrone');
  const mauiBtn = document.getElementById('tv-home-maui');
  if (madroneBtn && mauiBtn) {
    madroneBtn.classList.toggle('active', homeValue === 'Madrone');
    mauiBtn.classList.toggle('active', homeValue === 'Maui');
  }
  
  // Populate tag pills
  renderTVModalTagPills(tv.tags || [], 'include');
  renderTVModalTagPills(tv.notTags || [], 'exclude');
  
  // Show modal with active class for proper centering
  const modal = document.getElementById('tv-modal');
  modal.classList.add('active');
  modal.style.display = 'flex';
}

function renderTVModalTagPills(tags, type = 'include') {
  const containerId = type === 'exclude' ? 'tv-modal-not-tag-pills' : 'tv-modal-tag-pills';
  const container = document.getElementById(containerId);
  if (!container) return;

  const list = Array.isArray(tags) ? tags : [];

  if (list.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = list.map(tag => `
    <div class="tag-pill">
      <span>${tag}</span>
      <span class="tag-pill-remove" data-tag="${tag}" data-tag-type="${type}">&times;</span>
    </div>
  `).join('');

  container.querySelectorAll('.tag-pill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tagToRemove = e.currentTarget.dataset.tag;
      const tagType = e.currentTarget.dataset.tagType === 'exclude' ? 'notTags' : 'tags';
      const tv = allTVs.find(t => t.id === currentTVId);
      if (!tv) {
        return;
      }
      ensureTVCollections(tv);
      tv[tagType] = (tv[tagType] || []).filter(t => t !== tagToRemove);
      renderTVModalTagPills(tv[tagType], tagType === 'notTags' ? 'exclude' : 'include');
    });
  });
}

function closeTVModal() {
  const modal = document.getElementById('tv-modal');
  modal.classList.remove('active');
  modal.style.display = 'none';
  currentTVId = null;
}

function updateTVModalTagsDisplay() {
  // No longer used - tags removed from TV modal
}

function openTVTagPicker(mode = 'include') {
  if (!currentTVId) return;

  const tv = allTVs.find(t => t.id === currentTVId);
  if (!tv) return;

  ensureTVCollections(tv);
  currentTVTagPickerMode = mode === 'exclude' ? 'exclude' : 'include';
  const property = currentTVTagPickerMode === 'exclude' ? 'notTags' : 'tags';
  const selectedTags = tv[property] || [];
  const listContainer = document.getElementById('tv-tag-picker-list');
  const title = document.getElementById('tv-tag-picker-title');

  if (title) {
    title.textContent = currentTVTagPickerMode === 'exclude' ? 'Select Excluded Tags' : 'Select Display Tags';
  }

  if (!Array.isArray(allTags)) {
    // Fallback: ensure tags are loaded before rendering list
    loadTags().then(() => openTVTagPicker(currentTVTagPickerMode)).catch(() => {});
    return;
  }

  listContainer.innerHTML = allTags.map(tag => {
    const safeId = `tv-tag-picker-${tag.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const checked = selectedTags.includes(tag) ? 'checked' : '';
    const isDisplayTag = tv.tags.includes(tag);
    const isExcludeTag = tv.notTags.includes(tag);
    const isLocked = currentTVTagPickerMode === 'exclude' ? isDisplayTag : isExcludeTag;
    const disabled = isLocked ? 'disabled' : '';
    const annotation = isLocked
      ? currentTVTagPickerMode === 'exclude'
        ? ' (display tag)'
        : ' (excluded)'
      : '';
    return `
      <div class="tag-picker-item">
        <input type="checkbox" id="${safeId}" value="${tag}" ${checked} ${disabled} class="tv-tag-picker-checkbox" />
        <label for="${safeId}">${tag}${annotation}</label>
      </div>
    `;
  }).join('');

  // Show modal
  const modal = document.getElementById('tv-tag-picker-modal');
  modal.classList.add('active');
  modal.style.display = 'flex';

  // Focus search input
  setTimeout(() => {
    const searchInput = document.getElementById('tv-tag-picker-search');
    if (searchInput) searchInput.focus();
  }, 0);
}

function closeTVTagPicker() {
  const modal = document.getElementById('tv-tag-picker-modal');
  modal.classList.remove('active');
  modal.style.display = 'none';
  currentTVTagPickerMode = 'include';
  
  // Clear search
  const searchInput = document.getElementById('tv-tag-picker-search');
  if (searchInput) searchInput.value = '';
  
  // Reset visibility of all items
  document.querySelectorAll('.tag-picker-item').forEach(item => {
    item.style.display = 'flex';
  });
}

function saveTVTagPickerSelection() {
  if (!currentTVId) return;

  const tv = allTVs.find(t => t.id === currentTVId);
  if (!tv) return;

  ensureTVCollections(tv);

  const checkboxes = document.querySelectorAll('.tv-tag-picker-checkbox');
  const selectedTags = Array.from(checkboxes)
    .filter(cb => cb.checked && !cb.disabled)
    .map(cb => cb.value);

  const property = currentTVTagPickerMode === 'exclude' ? 'notTags' : 'tags';
  const oppositeProperty = property === 'tags' ? 'notTags' : 'tags';

  tv[property] = selectedTags;
  tv[oppositeProperty] = (tv[oppositeProperty] || []).filter(tag => !selectedTags.includes(tag));

  renderTVModalTagPills(tv[property], property === 'notTags' ? 'exclude' : 'include');
  renderTVModalTagPills(tv[oppositeProperty], oppositeProperty === 'notTags' ? 'exclude' : 'include');

  closeTVTagPicker();
}

async function saveTVModal() {
  if (!currentTVId) return;
  
  const name = document.getElementById('tv-modal-name').value.trim();
  const ip = document.getElementById('tv-modal-ip').value.trim();
  
  if (!name || !ip) {
    alert('Please fill in all required fields');
    return;
  }
  
  // Get selected tags and home from local TV object
  const tv = allTVs.find(t => t.id === currentTVId);
  const tags = tv ? (tv.tags || []) : [];
  const notTags = tv ? (tv.notTags || []) : [];
  const home = tv ? (tv.home || 'Madrone') : 'Madrone';
  
  try {
    // Update TV basic info (including home)
    const response = await fetch(`${API_BASE}/tvs/${currentTVId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ip, home })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update tags
      const tagsResponse = await fetch(`${API_BASE}/tvs/${currentTVId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, notTags })
      });
      
      const tagsResult = await tagsResponse.json();
      
      if (tagsResult.success) {
        // Update local data
        const tvIndex = allTVs.findIndex(t => t.id === currentTVId);
        if (tvIndex !== -1) {
          allTVs[tvIndex] = ensureTVCollections(tagsResult.tv);
        }
        
        renderTVList();
        loadTagsForFilter(); // Update TV shortcuts in filter dropdown
        closeTVModal();
      }
    }
  } catch (error) {
    console.error('Error saving TV:', error);
    alert('Failed to save TV changes');
  }
}

async function deleteTVFromModal() {
  if (!currentTVId) return;
  
  if (!confirm('Are you sure you want to delete this TV?')) return;
  
  try {
    await fetch(`${API_BASE}/tvs/${currentTVId}`, { method: 'DELETE' });
    loadTVs();
    closeTVModal();
  } catch (error) {
    console.error('Error deleting TV:', error);
    alert('Failed to delete TV');
  }
}

async function testTV(tvId) {
  try {
    const response = await fetch(`${API_BASE}/tvs/${tvId}/test`, { method: 'POST' });
    const result = await response.json();
    alert(result.message || 'Connection test completed');
  } catch (error) {
    console.error('Error testing TV:', error);
    alert('Connection test failed');
  }
}

// Tag Management
async function loadTags() {
  try {
    const response = await fetch(`${API_BASE}/tags`);
    allTags = await response.json();
    renderTagList();
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

async function loadTagsForFilter() {
  try {
    const response = await fetch(`${API_BASE}/tags`);
    allTags = await response.json();
    
    // Sort tags alphabetically
    allTags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    
    // Populate TV shortcuts section
    const tvShortcutsContainer = document.getElementById('tv-shortcuts');
    
    // Calculate tags that are not part of any TV
    const allTVTags = new Set();
    if (allTVs && allTVs.length > 0) {
      allTVs.forEach(tv => {
        if (tv.tags && tv.tags.length > 0) {
          tv.tags.forEach(tag => allTVTags.add(tag));
        }
      });
    }
    const nonTVTags = allTags.filter(tag => !allTVTags.has(tag));
    
    if (allTVs && allTVs.length > 0) {
      const normalizedTVs = allTVs.map(ensureTVCollections);
      
      // Sort TVs alphabetically by name
      normalizedTVs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      
      const shouldRenderShortcuts = normalizedTVs.length > 0 || nonTVTags.length > 0;

      if (shouldRenderShortcuts) {
        tvShortcutsContainer.innerHTML = `
          <div class="tv-shortcuts-header">TV Shortcuts</div>
          ${nonTVTags.length > 0 ? `
            <div class="multiselect-option">
              <input type="checkbox" id="tv-shortcut-no-tvs" value="no-tvs" class="tv-shortcut-checkbox" data-tv-tags='${serializeTagsForDataAttribute(nonTVTags)}'>
              <label for="tv-shortcut-no-tvs">*No TVs</label>
            </div>
          ` : ''}
          ${normalizedTVs.map(tv => `
            <div class="multiselect-option">
              <input type="checkbox" id="tv-shortcut-${tv.id}" value="${tv.id}" class="tv-shortcut-checkbox" data-tv-tags='${serializeTagsForDataAttribute(tv.tags)}'>
              <label for="tv-shortcut-${tv.id}">${tv.name}${tv.tags.length === 0 ? ' (no display tags)' : ''}</label>
            </div>
          `).join('')}
          <div class="tv-shortcuts-divider"></div>
        `;

        const tvCheckboxes = tvShortcutsContainer.querySelectorAll('.tv-shortcut-checkbox');
        tvCheckboxes.forEach(checkbox => {
          checkbox.addEventListener('change', handleTVShortcutChange);
        });
      } else {
        tvShortcutsContainer.innerHTML = '';
      }
    } else if (nonTVTags.length > 0) {
      // No TVs exist, but we have tags - show "No TVs" option
      tvShortcutsContainer.innerHTML = `
        <div class="tv-shortcuts-header">TV Shortcuts</div>
        <div class="multiselect-option">
          <input type="checkbox" id="tv-shortcut-no-tvs" value="no-tvs" class="tv-shortcut-checkbox" data-tv-tags='${serializeTagsForDataAttribute(nonTVTags)}'>
          <label for="tv-shortcut-no-tvs">*No TVs</label>
        </div>
        <div class="tv-shortcuts-divider"></div>
      `;
      
      // Add event listener
      const noTVsCheckbox = tvShortcutsContainer.querySelector('.tv-shortcut-checkbox');
      if (noTVsCheckbox) {
        noTVsCheckbox.addEventListener('change', handleTVShortcutChange);
      }
    } else {
      tvShortcutsContainer.innerHTML = '';
    }
    
    // Populate custom dropdown with checkboxes
    const dropdownOptions = document.querySelector('.multiselect-options');
    dropdownOptions.innerHTML = allTags.map(tag => `
      <div class="multiselect-option">
        <input type="checkbox" id="tag-${tag}" value="${tag}" class="tag-checkbox">
        <label for="tag-${tag}">${tag}</label>
      </div>
    `).join('');
    
    // Add event listeners to checkboxes
    const checkboxes = dropdownOptions.querySelectorAll('.tag-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', updateTagFilterDisplay);
    });
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

function handleTVShortcutChange(event) {
  const checkbox = event.target;
  const tvTags = JSON.parse(checkbox.dataset.tvTags || '[]');
  const allTagCheckboxes = document.querySelectorAll('.tag-checkbox');

  if (checkbox.checked) {
    // Apply the exact tag set represented by this shortcut
    const tagsToSelect = new Set(tvTags);
    allTagCheckboxes.forEach(tagCheckbox => {
      tagCheckbox.checked = tagsToSelect.has(tagCheckbox.value);
    });

    // Deselect other shortcuts explicitly before state reconciliation
    document.querySelectorAll('.tv-shortcut-checkbox').forEach(tvCheckbox => {
      if (tvCheckbox !== checkbox) {
        tvCheckbox.checked = false;
      }
    });
  } else {
    // Removing this shortcut clears its tags from the selection
    tvTags.forEach(tag => {
      const tagCheckbox = document.getElementById(`tag-${tag}`);
      if (tagCheckbox) {
        tagCheckbox.checked = false;
      }
    });
  }

  // Recalculate shortcut state and gallery based on the new tag selection
  updateTagFilterDisplay();
}

function updateTagFilterDisplay() {
  const checkboxes = document.querySelectorAll('.tag-checkbox:checked');
  const selectedTags = Array.from(checkboxes).map(cb => cb.value);
  const buttonText = document.getElementById('tag-filter-text');
  const clearBtn = document.getElementById('clear-tag-filter-btn');
  
  if (selectedTags.length === 0) {
    buttonText.textContent = 'All Tags';
    clearBtn.style.display = 'none';
  } else if (selectedTags.length === 1) {
    buttonText.textContent = selectedTags[0];
    clearBtn.style.display = 'block';
  } else {
    buttonText.textContent = selectedTags.join(', ');
    clearBtn.style.display = 'block';
  }
  
  // Update TV shortcut checkboxes to reflect current tag selection
  updateTVShortcutStates();
  
  renderGallery();
}

function updateTVShortcutStates() {
  const tvCheckboxes = document.querySelectorAll('.tv-shortcut-checkbox');
  const selectedTagCheckboxes = document.querySelectorAll('.tag-checkbox:checked');
  const selectedTags = Array.from(selectedTagCheckboxes).map(cb => cb.value);
  const selectedTagsSet = new Set(selectedTags);

  tvCheckboxes.forEach(tvCheckbox => {
    const shortcutTags = JSON.parse(tvCheckbox.dataset.tvTags || '[]');
    const shortcutTagSet = new Set(shortcutTags);
    const sameSize = selectedTagsSet.size === shortcutTagSet.size;
    const exactMatch = sameSize && [...shortcutTagSet].every(tag => selectedTagsSet.has(tag));

    tvCheckbox.checked = exactMatch;
    tvCheckbox.indeterminate = false;
  });
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
const CROP_PRESET_RATIOS = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '3:2': 3 / 2
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
      toolButtons: Array.from(toolbar.querySelectorAll('.toolbar-icon-btn')),
      toolGroup: toolbar.querySelector('.toolbar-group-tools'),
      divider: toolbar.querySelector('.toolbar-divider')
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
      contrastValue: document.getElementById('adjust-contrast-value')
    },
    filters: {
      chips: Array.from(document.querySelectorAll('#filter-chip-row .filter-chip'))
    },
    crop: {
      overlay: document.getElementById('crop-overlay'),
      box: document.getElementById('crop-box'),
      handles: Array.from(document.querySelectorAll('#crop-box .crop-handle')),
      presetButtons: Array.from(document.querySelectorAll('#crop-popover .crop-preset'))
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

  editControls.crop.box?.addEventListener('pointerdown', (event) => {
    if (!editState.active || editState.activeTool !== 'crop') return;
    startCropInteraction('move', 'move', event);
  });

  editControls.crop.handles.forEach(handle => {
    handle.addEventListener('pointerdown', (event) => {
      if (!editState.active || editState.activeTool !== 'crop') return;
      startCropInteraction('resize', handle.dataset.handle, event);
    });
  });

  modalImage.addEventListener('load', handleModalImageLoad);
  window.addEventListener('resize', () => {
    if (editState.active) {
      updateCropOverlay();
    }
  });

  updateAdjustmentUI();
  updateFilterButtons(editState.filter);
  updateCropPresetButtons(editState.cropPreset);
  updateToolbarState();
  applyPreviewFilters();
}

function handleModalImageLoad() {
  if (!editControls?.modalImage) return;
  const img = editControls.modalImage;
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
  }

  editState.isDirty = false;

  updateAdjustmentUI();
  updateFilterButtons(editState.filter);
  updateCropPresetButtons(editState.cropPreset);
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
  const { editBtn, applyBtn, cancelBtn, toolButtons } = editControls.toolbar;
  const isActive = editState.active;

  if (editBtn) {
    const shouldDisable = !currentImage || isActive;
    editBtn.disabled = shouldDisable;
    editBtn.textContent = 'Edit';
    if (shouldDisable) {
      editBtn.setAttribute('aria-disabled', 'true');
    } else {
      editBtn.removeAttribute('aria-disabled');
    }
  }

  if (editControls.toolbar.toolGroup) {
    editControls.toolbar.toolGroup.classList.toggle('hidden', !isActive);
  }

  if (editControls.toolbar.divider) {
    editControls.toolbar.divider.classList.toggle('hidden', !isActive);
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
  document.body.classList.add('editing-active');
  if (!editState.naturalWidth || !editState.naturalHeight) {
    const img = editControls.modalImage;
    if (img?.naturalWidth && img.naturalHeight) {
      editState.naturalWidth = img.naturalWidth;
      editState.naturalHeight = img.naturalHeight;
    }
  }
  updateToolbarState();
  if (editState.activeTool) {
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

function handleAdjustmentInput(event) {
  const input = event.target;
  const value = Number(input.value) || 0;
  if (input.id === 'adjust-brightness') {
    editState.adjustments.brightness = value;
  } else if (input.id === 'adjust-contrast') {
    editState.adjustments.contrast = value;
  }
  updateAdjustmentUI();
  markEditsDirty();
  applyPreviewFilters();
}

function updateAdjustmentUI() {
  if (!editControls?.adjustments) return;
  const { brightnessInput, contrastInput, brightnessValue, contrastValue } = editControls.adjustments;
  if (brightnessInput) {
    brightnessInput.value = editState.adjustments.brightness;
  }
  if (contrastInput) {
    contrastInput.value = editState.adjustments.contrast;
  }
  if (brightnessValue) {
    brightnessValue.textContent = editState.adjustments.brightness;
  }
  if (contrastValue) {
    contrastValue.textContent = editState.adjustments.contrast;
  }
}

function selectFilter(name, options = {}) {
  const filterName = (name || 'none').toLowerCase();
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
    chip.classList.toggle('active', (chip.dataset.filter || 'none') === activeFilter);
  });
}

function selectCropPreset(preset, options = {}) {
  const { silent = false } = options;
  editState.cropPreset = preset;
  updateCropPresetButtons(preset);
  applyCropPreset(preset, { silent });
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
  const { silent = false } = options;
  let next = clampInsets(insets);
  const ratio = getPresetRatio(editState.cropPreset);
  if (ratio) {
    next = normalizeInsetsForRatio(next, ratio);
  }
  editState.crop = next;
  updateCropOverlay();
  if (!silent) {
    markEditsDirty();
  }
}

function clampInsets(insets) {
  let { top, right, bottom, left } = insets;

  top = clamp(top, 0, 100);
  bottom = clamp(bottom, 0, 100);
  left = clamp(left, 0, 100);
  right = clamp(right, 0, 100);

  let width = 100 - left - right;
  if (width < MIN_CROP_PERCENT) {
    const shortfall = MIN_CROP_PERCENT - width;
    if (left >= right) {
      left = clamp(left - shortfall, 0, 100 - right - MIN_CROP_PERCENT);
    } else {
      right = clamp(right - shortfall, 0, 100 - left - MIN_CROP_PERCENT);
    }
    width = 100 - left - right;
  }

  let height = 100 - top - bottom;
  if (height < MIN_CROP_PERCENT) {
    const shortfall = MIN_CROP_PERCENT - height;
    if (top >= bottom) {
      top = clamp(top - shortfall, 0, 100 - bottom - MIN_CROP_PERCENT);
    } else {
      bottom = clamp(bottom - shortfall, 0, 100 - top - MIN_CROP_PERCENT);
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
  if (Math.abs(actualRatio - ratio) <= CROP_RATIO_TOLERANCE) {
    return { top, right, bottom, left };
  }

  const widthActual = (widthPercent / 100) * naturalWidth;
  const heightActual = (heightPercent / 100) * naturalHeight;

  const minWidthActual = (MIN_CROP_PERCENT / 100) * naturalWidth;
  const minHeightActual = (MIN_CROP_PERCENT / 100) * naturalHeight;

  const minHeightAllowed = Math.max(minHeightActual, minWidthActual / ratio);
  const maxHeightAllowed = Math.min(naturalHeight, naturalWidth / ratio);
  const minWidthAllowed = Math.max(minWidthActual, minHeightActual * ratio);
  const maxWidthAllowed = Math.min(naturalWidth, naturalHeight * ratio);

  if (minHeightAllowed >= maxHeightAllowed || minWidthAllowed >= maxWidthAllowed) {
    return clamped;
  }

  let targetWidthActual;
  let targetHeightActual;

  if (actualRatio > ratio) {
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

  if (!editState.active) {
    overlay.classList.add('hidden');
  } else {
    overlay.classList.remove('hidden');
  }

  overlay.classList.toggle('active', editState.active && editState.activeTool === 'crop');

  const { top, right, bottom, left } = editState.crop;
  const widthPercent = Math.max(MIN_CROP_PERCENT, 100 - left - right);
  const heightPercent = Math.max(MIN_CROP_PERCENT, 100 - top - bottom);

  box.style.top = `${top}%`;
  box.style.left = `${left}%`;
  box.style.width = `${widthPercent}%`;
  box.style.height = `${heightPercent}%`;
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
    pendingInsets: { ...editState.crop }
  };

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

  let nextInsets = { ...startInsets };

  if (type === 'move') {
    const width = 100 - startInsets.left - startInsets.right;
    const height = 100 - startInsets.top - startInsets.bottom;

    let newLeft = clamp(startInsets.left + dx, 0, 100 - width);
    let newTop = clamp(startInsets.top + dy, 0, 100 - height);
    const newRight = 100 - width - newLeft;
    const newBottom = 100 - height - newTop;

    nextInsets = clampInsets({ top: newTop, right: newRight, bottom: newBottom, left: newLeft });
  } else {
    let { top, right, bottom, left } = startInsets;

    if (handle.includes('w')) {
      left = clamp(startInsets.left + dx, 0, 100 - startInsets.right - MIN_CROP_PERCENT);
    }
    if (handle.includes('e')) {
      right = clamp(startInsets.right - dx, 0, 100 - left - MIN_CROP_PERCENT);
    }
    if (handle.includes('n')) {
      top = clamp(startInsets.top + dy, 0, 100 - startInsets.bottom - MIN_CROP_PERCENT);
    }
    if (handle.includes('s')) {
      bottom = clamp(startInsets.bottom - dy, 0, 100 - top - MIN_CROP_PERCENT);
    }

    nextInsets = clampInsets({ top, right, bottom, left });

    if (aspectRatio) {
      nextInsets = enforceAspectRatio(nextInsets, handle, aspectRatio);
    }
  }

  cropInteraction.pendingInsets = nextInsets;
  setCropInsets(nextInsets, { silent: true });
}

function handleCropPointerUp() {
  if (!cropInteraction) return;
  editControls?.crop?.box?.classList.remove('dragging');
  document.removeEventListener('pointermove', handleCropPointerMove);
  document.removeEventListener('pointerup', handleCropPointerUp, { once: false });
  document.removeEventListener('pointercancel', handleCropPointerUp, { once: false });

  const finalInsets = cropInteraction.pendingInsets || editState.crop;
  setCropInsets(finalInsets, { silent: false });

  cropInteraction = null;
}

function enforceAspectRatio(insets, handle, aspectRatio) {
  let { top, right, bottom, left } = insets;
  let width = 100 - left - right;
  let height = 100 - top - bottom;

  if (width <= 0 || height <= 0) {
    return clampInsets(insets);
  }

  const startWidth = cropInteraction?.startWidth || width;
  const startHeight = cropInteraction?.startHeight || height;
  const widthDelta = Math.abs(width - startWidth);
  const heightDelta = Math.abs(height - startHeight);

  if (widthDelta > heightDelta) {
    const targetHeight = width / aspectRatio;
    const diff = targetHeight - height;
    if (handle.includes('n') && !handle.includes('s')) {
      top = clamp(top - diff, 0, 100 - bottom - MIN_CROP_PERCENT);
    } else if (handle.includes('s') && !handle.includes('n')) {
      bottom = clamp(bottom - diff, 0, 100 - top - MIN_CROP_PERCENT);
    } else {
      const half = diff / 2;
      top = clamp(top - half, 0, 100 - bottom - MIN_CROP_PERCENT);
      bottom = clamp(bottom - half, 0, 100 - top - MIN_CROP_PERCENT);
    }
  } else {
    const targetWidth = height * aspectRatio;
    const diff = targetWidth - width;
    if (handle.includes('w') && !handle.includes('e')) {
      left = clamp(left - diff, 0, 100 - right - MIN_CROP_PERCENT);
    } else if (handle.includes('e') && !handle.includes('w')) {
      right = clamp(right - diff, 0, 100 - left - MIN_CROP_PERCENT);
    } else {
      const half = diff / 2;
      left = clamp(left - half, 0, 100 - right - MIN_CROP_PERCENT);
      right = clamp(right - half, 0, 100 - left - MIN_CROP_PERCENT);
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
  if (!editState.active) {
    img.style.filter = '';
    return;
  }

  const brightness = clamp(1 + editState.adjustments.brightness / 100, 0.1, 3).toFixed(3);
  const contrast = clamp(1 + editState.adjustments.contrast / 100, 0.1, 3).toFixed(3);
  const parts = [`brightness(${brightness})`, `contrast(${contrast})`];

  switch (editState.filter) {
    case 'gallery-soft':
      parts.push('sepia(0.12)', 'saturate(1.12)', 'brightness(1.05)');
      break;
    case 'vivid-sky':
      parts.push('saturate(1.24)', 'hue-rotate(350deg)', 'brightness(1.04)');
      break;
    case 'dusk-haze':
      parts.push('saturate(1.08)', 'hue-rotate(315deg)', 'brightness(0.98)', 'contrast(1.05)');
      break;
    case 'impressionist':
      parts.push('saturate(1.22)', 'contrast(0.94)', 'brightness(1.06)');
      break;
    case 'deco-gold':
      parts.push('sepia(0.35)', 'saturate(1.08)', 'hue-rotate(10deg)', 'brightness(1.02)');
      break;
    case 'charcoal':
      parts.push('grayscale(1)', 'contrast(1.25)');
      break;
    case 'silver-tone':
    case 'monochrome':
    case 'grayscale':
      parts.push('grayscale(1)', 'brightness(1.05)', 'contrast(0.92)');
      break;
    case 'ink-sketch':
      parts.push('grayscale(1)', 'contrast(1.45)', 'brightness(1.05)');
      break;
    default:
      break;
  }

  img.style.filter = parts.join(' ');
}

function buildEditPayload() {
  return {
    crop: { ...editState.crop },
    adjustments: { ...editState.adjustments },
    filter: editState.filter
  };
}

async function submitImageEdits() {
  if (!currentImage || !editState.isDirty) {
    setToolbarStatus('Adjust settings before applying edits.', 'info');
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

    if (allImages[currentImage]) {
      if (data.dimensions) {
        allImages[currentImage].dimensions = data.dimensions;
      }
      if (typeof data.aspectRatio === 'number') {
        allImages[currentImage].aspectRatio = data.aspectRatio;
      }
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

    if (allImages[currentImage]) {
      if (data.dimensions) {
        allImages[currentImage].dimensions = data.dimensions;
      }
      if (typeof data.aspectRatio === 'number') {
        allImages[currentImage].aspectRatio = data.aspectRatio;
      }
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

  if (!resolutionEl || !aspectBadgeEl) return;

  if (imageData?.dimensions?.width && imageData?.dimensions?.height) {
    const { width, height } = imageData.dimensions;
    const aspectRatio = imageData.aspectRatio || (width / height);
    const is16x9 = Math.abs(aspectRatio - 1.78) < 0.05;
    resolutionEl.textContent = `${width} × ${height}`;
    if (is16x9) {
      aspectBadgeEl.innerHTML = '<span class="aspect-badge-inline">16:9</span>';
    } else {
      aspectBadgeEl.innerHTML = '';
    }
  } else {
    resolutionEl.textContent = 'Unknown';
    aspectBadgeEl.innerHTML = '';
  }
}

// Modal Functions
function initModal() {
  const modal = document.getElementById('image-modal');
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

  // Helper function to close modal and auto-sync
  const closeModalAndSync = async () => {
    if (editState.active) {
      cancelEdits();
    }
    modal.classList.remove('active');
    resetEditState({ hasBackup: false, keepDimensions: false, silent: true });
    clearToolbarStatus();
    // Check if there are changes to sync and auto-sync
    const status = await fetch(`${API_BASE}/sync/status`).then(r => r.json());
    if (status.success && status.status.hasChanges) {
      await manualSync();
    }
  };
  
  if (closeBtn) closeBtn.onclick = closeModalAndSync;
  if (cancelBtn) cancelBtn.onclick = closeModalAndSync;
  
  window.onclick = (event) => {
    if (event.target === modal) {
      closeModalAndSync();
    }
  };

  deleteBtn.onclick = deleteImage;
  editFilenameBtn.onclick = showEditFilenameForm;
  saveFilenameBtn.onclick = saveFilenameChange;
  cancelFilenameBtn.onclick = hideEditFilenameForm;
  addTagsBtn.onclick = addImageTags;
  
  // Expand image to full screen
  if (expandBtn) {
    expandBtn.onclick = () => {
      if (currentImage) {
        showFullScreenImage(currentImage);
      }
    };
  }
  
  // Auto-save matte and filter on change
  matteSelect.onchange = saveImageChanges;
  filterSelect.onchange = saveImageChanges;
  
  // Add Enter key support for tags input
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

  // Clear multi-select when opening image detail modal
  // This ensures the multi-select toolbar disappears since we're focusing on a single image
  if (selectedImages.size > 0) {
    clearSelection();
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
  document.getElementById('modal-matte').value = imageData.matte || 'none';
  document.getElementById('modal-filter').value = imageData.filter || 'none';
  
  // Render tag badges
  renderImageTagBadges(imageData.tags || []);

  exitEditMode();
  const initialPreset = detectInitialCropPreset(imageData);
  resetEditState({ hasBackup: false, keepDimensions: false, silent: true, initialPreset });
  clearToolbarStatus();
  updateToolbarState();
  updateCropOverlay();
  applyPreviewFilters();

  loadEditStateForImage(filename);

  modal.classList.add('active');
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

  const matte = document.getElementById('modal-matte').value;
  const filter = document.getElementById('modal-filter').value;

  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matte, filter })
    });

    const result = await response.json();

    if (result.success) {
      // Update local cache
      allImages[currentImage].matte = matte;
      allImages[currentImage].filter = filter;
      
      // Reload gallery in background
      loadGallery();
      
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
      loadGallery();
      
      // Update sync status since file was deleted
      await updateSyncStatus();
      
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
  
  // Auto-sync after deletion if there are changes
  const status = await fetch(`${API_BASE}/sync/status`).then(r => r.json());
  if (status.success && status.status.hasChanges) {
    await manualSync();
  }
}

// TV Modal Functions
function initTVModal() {
  const saveBtn = document.getElementById('tv-modal-save-btn');
  const deleteBtn = document.getElementById('tv-modal-delete-btn');
  const cancelBtn = document.getElementById('tv-modal-cancel-btn');
  const closeBtn = document.getElementById('tv-modal-close');
  const addTagBtn = document.getElementById('tv-modal-add-tag-btn');
  const addNotTagBtn = document.getElementById('tv-modal-add-not-tag-btn');
  const madroneBtn = document.getElementById('tv-home-madrone');
  const mauiBtn = document.getElementById('tv-home-maui');
  
  if (saveBtn) {
    saveBtn.addEventListener('click', saveTVModal);
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteTVFromModal);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeTVModal);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', closeTVModal);
  }
  if (addTagBtn) {
    addTagBtn.addEventListener('click', () => openTVTagPicker('include'));
  }
  if (addNotTagBtn) {
    addNotTagBtn.addEventListener('click', () => openTVTagPicker('exclude'));
  }
  // Home toggle handlers
  function setHome(value) {
    if (madroneBtn && mauiBtn) {
      madroneBtn.classList.toggle('active', value === 'Madrone');
      mauiBtn.classList.toggle('active', value === 'Maui');
    }
    const tv = allTVs.find(t => t.id === currentTVId);
    if (tv) tv.home = value;
  }
  if (madroneBtn) madroneBtn.addEventListener('click', () => setHome('Madrone'));
  if (mauiBtn) mauiBtn.addEventListener('click', () => setHome('Maui'));
  
  // Close modal on outside click
  const modal = document.getElementById('tv-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeTVModal();
      }
    });
  }
}

// TV Tag Picker Modal Functions
function initTVTagPickerModal() {
  const doneBtn = document.getElementById('tv-tag-picker-done-btn');
  const cancelBtn = document.getElementById('tv-tag-picker-cancel-btn');
  const closeBtn = document.getElementById('tv-tag-picker-close');
  const searchInput = document.getElementById('tv-tag-picker-search');
  
  if (doneBtn) {
    doneBtn.addEventListener('click', saveTVTagPickerSelection);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeTVTagPicker);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', closeTVTagPicker);
  }
  
  // Search/filter functionality
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('.tag-picker-item').forEach(item => {
        const label = item.querySelector('label');
        if (!label) return;
        const match = label.textContent.toLowerCase().includes(term);
        item.style.display = match ? 'flex' : 'none';
      });
    });
  }
  
  // Close modal on outside click
  const modal = document.getElementById('tv-tag-picker-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeTVTagPicker();
      }
    });
  }
}
