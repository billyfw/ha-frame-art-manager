// API Base URL
const API_BASE = '/api';

// State
let allImages = {};
let allTags = [];
let allTVs = [];
let currentImage = null;
let selectedImages = new Set();
let lastClickedIndex = null;
let sortAscending = true; // true = ascending (A-Z, oldest first), false = descending

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
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadLibraryPath();
  loadGallery();
  loadTags();
  loadTVs();
  initUploadForm();
  initTVForm();
  initTagForm();
  initModal();
  initMetadataViewer();
  initBulkActions();
  initTVModal();
  initTVTagPickerModal();
  initSettingsNavigation();
  initUploadNavigation();
});

// Load and display library path
async function loadLibraryPath() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    const pathValue = data.frameArtPath || 'Unknown';
    
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
  if (tabName === 'gallery') loadGallery();
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
      switchToTab('upload');
    });
  }

  if (goHomeUploadBtn) {
    goHomeUploadBtn.addEventListener('click', () => {
      switchToTab('gallery');
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
      switchToTab('advanced');
    });
  }

  if (goHomeBtn) {
    goHomeBtn.addEventListener('click', () => {
      switchToTab('gallery');
    });
  }
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

function openBulkTagModal() {
  console.log('openBulkTagModal called, selectedImages:', selectedImages);
  const modal = document.getElementById('bulk-tag-modal');
  const countSpan = document.getElementById('bulk-count');
  console.log('modal:', modal, 'countSpan:', countSpan);
  countSpan.textContent = selectedImages.size;
  modal.classList.add('visible');
  console.log('modal classes after add:', modal.className);
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
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Error updating ${filename}:`, error);
      errorCount++;
    }
  }
  
  // Show result and refresh
  if (errorCount > 0) {
    alert(`Updated ${successCount} images. ${errorCount} failed.`);
  }
  
  closeBulkTagModal();
  clearSelection();
  await loadGallery();
  await loadTags();
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

  // Filter by tags (image must have ALL selected tags)
  if (selectedTags.length > 0) {
    filteredImages = filteredImages.filter(([_, data]) => 
      data.tags && selectedTags.every(tag => data.tags.includes(tag))
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
        <img src="/thumbs/thumb_${filename}" 
             onerror="this.src='/library/${filename}'" 
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
      tagFilterBtn?.classList.remove('active');
      tagFilterDropdown?.classList.remove('active');
    });
  }

  // Toggle tag filter dropdown
  if (tagFilterBtn) {
    tagFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tagFilterBtn.classList.toggle('active');
      tagFilterDropdown.classList.toggle('active');
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (tagFilterDropdown && !e.target.closest('.custom-multiselect')) {
      tagFilterBtn?.classList.remove('active');
      tagFilterDropdown.classList.remove('active');
    }
  });

  if (sortOrderSelect) {
    sortOrderSelect.addEventListener('change', () => renderGallery());
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
function initUploadForm() {
  const form = document.getElementById('upload-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const statusDiv = document.getElementById('upload-status');
    
    statusDiv.innerHTML = '<div class="info">Uploading...</div>';

    try {
      const response = await fetch(`${API_BASE}/images/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        statusDiv.innerHTML = '<div class="success">Image uploaded successfully!</div>';
        form.reset();
        loadGallery();
        loadTags(); // Reload tags in case new ones were added
      } else {
        statusDiv.innerHTML = `<div class="error">Upload failed: ${result.error}</div>`;
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      statusDiv.innerHTML = '<div class="error">Upload failed</div>';
    }
  });
}

// TV Management
async function loadTVs() {
  try {
    const response = await fetch(`${API_BASE}/tvs`);
    allTVs = await response.json();
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
    const tvTags = tv.tags || [];
    const tagText = tvTags.length === 0 ? 'All images' : 
                    tvTags.length === 1 ? tvTags[0] : 
                    tvTags.join(', ');
    
    return `
    <div class="list-item list-item-clickable" onclick="openTVModal('${tv.id}')">
      <div class="list-item-info">
        <div class="list-item-name">${tv.name}</div>
        <div class="list-item-detail">${tv.ip}</div>
        <div class="list-item-detail">${tagText}</div>
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

    try {
      const response = await fetch(`${API_BASE}/tvs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ip })
      });

      const result = await response.json();

      if (result.success) {
        form.reset();
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

function openTVModal(tvId) {
  const tv = allTVs.find(t => t.id === tvId);
  if (!tv) return;

  currentTVId = tvId;
  
  // Populate modal fields
  document.getElementById('tv-modal-name').value = tv.name;
  document.getElementById('tv-modal-ip').value = tv.ip;
  document.getElementById('tv-modal-date').textContent = formatDate(tv.added);
  
  // Populate tag pills
  renderTVModalTagPills(tv.tags || []);
  
  // Show modal with active class for proper centering
  const modal = document.getElementById('tv-modal');
  modal.classList.add('active');
  modal.style.display = 'flex';
}

function renderTVModalTagPills(tags) {
  const container = document.getElementById('tv-modal-tag-pills');
  if (!container) return;
  
  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = tags.map(tag => `
    <div class="tag-pill">
      <span>${tag}</span>
      <span class="tag-pill-remove" data-tag="${tag}">&times;</span>
    </div>
  `).join('');
  
  // Add click handlers for remove buttons
  container.querySelectorAll('.tag-pill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tagToRemove = e.target.dataset.tag;
      const tv = allTVs.find(t => t.id === currentTVId);
      if (tv && tv.tags) {
        tv.tags = tv.tags.filter(t => t !== tagToRemove);
        renderTVModalTagPills(tv.tags);
      }
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

function openTVTagPicker() {
  if (!currentTVId) return;
  
  const tv = allTVs.find(t => t.id === currentTVId);
  if (!tv) return;
  
  const tvTags = tv.tags || [];
  const listContainer = document.getElementById('tv-tag-picker-list');
  
  // Populate tag checkboxes
  listContainer.innerHTML = allTags.map(tag => {
    const safeId = `tv-tag-picker-${tag.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const checked = tvTags.includes(tag) ? 'checked' : '';
    return `
      <div class="tag-picker-item">
        <input type="checkbox" id="${safeId}" value="${tag}" ${checked} class="tv-tag-picker-checkbox" />
        <label for="${safeId}">${tag}</label>
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
  
  // Get selected tags
  const checkboxes = document.querySelectorAll('.tv-tag-picker-checkbox');
  const selectedTags = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  // Update local TV object
  tv.tags = selectedTags;
  
  // Update UI
  renderTVModalTagPills(selectedTags);
  
  // Close picker
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
  
  // Get selected tags from local TV object
  const tv = allTVs.find(t => t.id === currentTVId);
  const tags = tv ? (tv.tags || []) : [];
  
  try {
    // Update TV basic info
    const response = await fetch(`${API_BASE}/tvs/${currentTVId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ip })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update tags
      const tagsResponse = await fetch(`${API_BASE}/tvs/${currentTVId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
      });
      
      const tagsResult = await tagsResponse.json();
      
      if (tagsResult.success) {
        // Update local data
        const tvIndex = allTVs.findIndex(t => t.id === currentTVId);
        if (tvIndex !== -1) {
          allTVs[tvIndex] = tagsResult.tv;
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
    
    // Populate TV shortcuts section
    const tvShortcutsContainer = document.getElementById('tv-shortcuts');
    if (allTVs && allTVs.length > 0) {
      const tvsWithTags = allTVs.filter(tv => tv.tags && tv.tags.length > 0);
      
      if (tvsWithTags.length > 0) {
        tvShortcutsContainer.innerHTML = `
          <div class="tv-shortcuts-header">TV Shortcuts</div>
          ${tvsWithTags.map(tv => `
            <div class="multiselect-option">
              <input type="checkbox" id="tv-shortcut-${tv.id}" value="${tv.id}" class="tv-shortcut-checkbox" data-tv-tags='${JSON.stringify(tv.tags)}'>
              <label for="tv-shortcut-${tv.id}">${tv.name}</label>
            </div>
          `).join('')}
          <div class="tv-shortcuts-divider"></div>
        `;
        
        // Add event listeners to TV shortcut checkboxes
        const tvCheckboxes = tvShortcutsContainer.querySelectorAll('.tv-shortcut-checkbox');
        tvCheckboxes.forEach(checkbox => {
          checkbox.addEventListener('change', handleTVShortcutChange);
        });
      } else {
        tvShortcutsContainer.innerHTML = '';
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
  const tvTags = JSON.parse(checkbox.dataset.tvTags);
  const isChecked = checkbox.checked;
  
  // Select or deselect all tags for this TV
  tvTags.forEach(tag => {
    const tagCheckbox = document.getElementById(`tag-${tag}`);
    if (tagCheckbox) {
      tagCheckbox.checked = isChecked;
    }
  });
  
  // Update the display and re-render gallery
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
  
  tvCheckboxes.forEach(tvCheckbox => {
    const tvTags = JSON.parse(tvCheckbox.dataset.tvTags);
    const selectedTagCheckboxes = document.querySelectorAll('.tag-checkbox:checked');
    const selectedTags = Array.from(selectedTagCheckboxes).map(cb => cb.value);
    
    // Check if all TV tags are selected
    const allTVTagsSelected = tvTags.every(tag => selectedTags.includes(tag));
    
    // Update checkbox state without triggering change event
    const wasChecked = tvCheckbox.checked;
    tvCheckbox.checked = allTVTagsSelected;
    
    // Set indeterminate state if some but not all tags are selected
    const someTVTagsSelected = tvTags.some(tag => selectedTags.includes(tag));
    tvCheckbox.indeterminate = someTVTagsSelected && !allTVTagsSelected;
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

// Modal Functions
function initModal() {
  const modal = document.getElementById('image-modal');
  const closeBtn = modal.querySelector('.close');
  const saveBtn = document.getElementById('modal-save-btn');
  const deleteBtn = document.getElementById('modal-delete-btn');
  const editFilenameBtn = document.getElementById('edit-filename-btn');
  const saveFilenameBtn = document.getElementById('save-filename-btn');
  const cancelFilenameBtn = document.getElementById('cancel-filename-btn');

  closeBtn.onclick = () => modal.classList.remove('active');
  
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.classList.remove('active');
    }
  };

  saveBtn.onclick = saveImageChanges;
  deleteBtn.onclick = deleteImage;
  editFilenameBtn.onclick = showEditFilenameForm;
  saveFilenameBtn.onclick = saveFilenameChange;
  cancelFilenameBtn.onclick = hideEditFilenameForm;
}

function openImageModal(filename) {
  const modal = document.getElementById('image-modal');
  const imageData = allImages[filename];
  
  currentImage = filename;

  // Set image
  document.getElementById('modal-image').src = `/library/${filename}`;
  document.getElementById('modal-filename').textContent = getDisplayName(filename);
  document.getElementById('modal-actual-filename').textContent = filename;
  
  // Set resolution
  const resolutionEl = document.getElementById('modal-resolution');
  if (imageData.dimensions) {
    const { width, height } = imageData.dimensions;
    const aspectRatio = imageData.aspectRatio || (width / height).toFixed(2);
    const is16x9 = Math.abs(aspectRatio - 1.78) < 0.05;
    resolutionEl.textContent = `${width} × ${height}${is16x9 ? ' (16:9)' : ''}`;
  } else {
    resolutionEl.textContent = 'Unknown';
  }

  // Set form values
  document.getElementById('modal-matte').value = imageData.matte || 'none';
  document.getElementById('modal-filter').value = imageData.filter || 'none';
  document.getElementById('modal-tags').value = (imageData.tags || []).join(', ');

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
      document.getElementById('modal-image').src = `/library/${result.newFilename}`;
      
      hideEditFilenameForm();
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
  const tagsInput = document.getElementById('modal-tags').value;
  const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);

  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matte, filter, tags })
    });

    const result = await response.json();

    if (result.success) {
      document.getElementById('image-modal').classList.remove('active');
      loadGallery();
      loadTags(); // Reload in case new tags were added
      loadTagsForFilter(); // Update the filter dropdown too
    }
  } catch (error) {
    console.error('Error saving changes:', error);
    alert('Failed to save changes');
  }
}

async function deleteImage() {
  if (!currentImage) return;
  if (!confirm(`Delete "${currentImage}"? This cannot be undone.`)) return;

  try {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(currentImage)}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      document.getElementById('image-modal').classList.remove('active');
      loadGallery();
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    alert('Failed to delete image');
  }
}

// Sync Functions
function initSyncButton() {
  const btn = document.getElementById('verify-sync-btn');
  btn.addEventListener('click', verifySync);
}

async function verifySync() {
  const resultsDiv = document.getElementById('sync-results');
  resultsDiv.innerHTML = '<div class="info">Checking sync status...</div>';

  try {
    const response = await fetch(`${API_BASE}/images/verify`);
    const results = await response.json();

    let html = '<div class="info">';
    html += `<h3>Sync Results</h3>`;
    html += `<p><strong>Synced:</strong> ${results.synced.length} files</p>`;
    
    if (results.onDiskNotInMetadata.length > 0) {
      html += `<p><strong>On disk but not in metadata:</strong></p><ul>`;
      results.onDiskNotInMetadata.forEach(f => html += `<li>${getDisplayName(f)}</li>`);
      html += `</ul>`;
    }
    
    if (results.inMetadataNotOnDisk.length > 0) {
      html += `<p><strong>In metadata but not on disk:</strong></p><ul>`;
      results.inMetadataNotOnDisk.forEach(f => html += `<li>${getDisplayName(f)}</li>`);
      html += `</ul>`;
    }
    
    html += '</div>';
    resultsDiv.innerHTML = html;
  } catch (error) {
    console.error('Error verifying sync:', error);
    resultsDiv.innerHTML = '<div class="error">Failed to verify sync</div>';
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

// Bulk Actions Functions
function initBulkActions() {
  const bulkTagBtn = document.getElementById('bulk-tag-btn');
  const clearBtn = document.getElementById('clear-selection-btn');
  const addTagsBtn = document.getElementById('add-bulk-tags-btn');
  const cancelBtn = document.getElementById('cancel-bulk-tags-btn');
  const closeBtn = document.getElementById('bulk-modal-close');
  
  console.log('initBulkActions - bulkTagBtn:', bulkTagBtn);
  
  if (bulkTagBtn) {
    bulkTagBtn.addEventListener('click', openBulkTagModal);
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

// TV Modal Functions
function initTVModal() {
  const saveBtn = document.getElementById('tv-modal-save-btn');
  const deleteBtn = document.getElementById('tv-modal-delete-btn');
  const cancelBtn = document.getElementById('tv-modal-cancel-btn');
  const closeBtn = document.getElementById('tv-modal-close');
  const addTagBtn = document.getElementById('tv-modal-add-tag-btn');
  
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
    addTagBtn.addEventListener('click', openTVTagPicker);
  }
  
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
