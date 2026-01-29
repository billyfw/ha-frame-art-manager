const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Supervisor API configuration
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
// Allow overriding HA_URL for local development (e.g. http://192.168.1.100:8123/api)
const HA_API_BASE = process.env.HA_URL || 'http://supervisor/core/api';

// Middleware to check if we're running in HA environment
const requireHA = (req, res, next) => {
  if (!SUPERVISOR_TOKEN) {
    // For development/testing outside HA, you might want to mock this or error
    if (process.env.NODE_ENV === 'development') {
      return next();
    }
    return res.status(503).json({ error: 'Home Assistant Supervisor token not found. Are we running as an Add-on?' });
  }
  next();
};

// Mock tagsets for development - GLOBAL tagsets (not per-TV)
const MOCK_GLOBAL_TAGSETS = {
  'everyday': { 
    tags: ['Landscape', 'Nature', 'Beach', 'Sunset', 'Mountains', 'Ocean', 'Forest', 'Flowers', 'Sky', 'Clouds', 'River', 'Lake', 'Meadow', 'Wildlife', 'Scenic', 'Outdoor', 'Horizon', 'Golden Hour'], 
    exclude_tags: ['Abstract', 'Urban', 'Architecture', 'Modern'] 
  },
  'holidays': { 
    tags: ['Christmas', 'Winter', 'Snow', 'Holiday', 'Festive', 'Cozy', 'Fireplace', 'Pine', 'Decorations', 'Lights', 'Family', 'Celebration', 'Ornaments', 'Gifts', 'Wreath', 'Snowman'], 
    exclude_tags: ['Beach', 'Summer', 'Tropical', 'Warm', 'Sunny'] 
  },
  'billybirthday': { 
    tags: ['Family', 'Birthday', 'Party', 'Celebration', 'Kids', 'Cake', 'Balloons', 'Fun', 'Happy', 'Memories', 'Portrait', 'Candles', 'Presents', 'Streamers', 'Confetti', 'Gathering'], 
    exclude_tags: [] 
  },
  'primary': { 
    tags: ['Family', 'Portrait', 'Kids', 'Home', 'Love', 'Together', 'Candid', 'Moments', 'Everyday', 'Life', 'Smiles', 'Joy', 'Siblings', 'Parents', 'Grandparents', 'Pets', 'Indoor'], 
    exclude_tags: ['Abstract', 'Urban', 'Architecture', 'Commercial', 'Stock'] 
  },
  'work': { 
    tags: ['Abstract', 'Urban', 'Architecture', 'Modern', 'Minimalist', 'Geometric', 'City', 'Building', 'Design', 'Art', 'Contemporary', 'Lines', 'Shapes', 'Monochrome', 'Industrial', 'Corporate'], 
    exclude_tags: ['Family', 'Kids', 'Portrait', 'Casual', 'Personal', 'Baby', 'Children', 'Wedding', 'Birthday', 'Party', 'Pets', 'Animals', 'Cute', 'Playful', 'Silly', 'Vacation', 'Beach', 'Holiday'] 
  },
  'relax': { 
    tags: ['Nature', 'Landscape', 'Calm', 'Peaceful', 'Zen', 'Water', 'Garden', 'Serene', 'Tranquil', 'Soft', 'Gentle', 'Meditation', 'Spa', 'Wellness', 'Retreat', 'Silence', 'Harmony'], 
    exclude_tags: ['Urban', 'Busy', 'Bright', 'Loud', 'Crowded', 'Vibrant'] 
  }
};

// Mock TV assignments for development
const MOCK_TV_TAGSET_ASSIGNMENTS = {
  'mock_device_1': {
    selected_tagset: 'everyday',
    override_tagset: null,
    override_expiry_time: null,
    next_shuffle_time: new Date(Date.now() + 23 * 60 * 1000).toISOString() // 23 minutes from now
  },
  'mock_device_2': {
    selected_tagset: 'billybirthday',  // Assigned permanently to this TV
    override_tagset: null,
    override_expiry_time: null,
    next_shuffle_time: new Date(Date.now() + 2 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString() // 2h 15m from now
  },
  'mock_device_3': {
    selected_tagset: 'work',
    override_tagset: 'billybirthday',  // Same tagset overrides this TV temporarily
    override_expiry_time: new Date(Date.now() + 45 * 60 * 1000).toISOString(), // 45 minutes from now
    next_shuffle_time: new Date(Date.now() + 8 * 60 * 1000).toISOString() // 8 minutes from now
  },
  'mock_device_4': {
    selected_tagset: 'primary',
    override_tagset: null,
    override_expiry_time: null,
    next_shuffle_time: null // Auto-shuffle disabled
  }
};

// Helper for HA requests
const haRequest = async (method, endpoint, data = null) => {
  if (!SUPERVISOR_TOKEN && process.env.NODE_ENV === 'development') {
    // Mock responses for dev
    if (endpoint.includes('template')) {
      // Helper to get effective tags for a TV based on global tagsets
      const getEffectiveTags = (deviceId) => {
        const assignment = MOCK_TV_TAGSET_ASSIGNMENTS[deviceId];
        if (!assignment) return { tags: [], exclude_tags: [] };
        const activeTagset = assignment.override_tagset || assignment.selected_tagset;
        return MOCK_GLOBAL_TAGSETS[activeTagset] || { tags: [], exclude_tags: [] };
      };
      
      // Return mock data with GLOBAL tagsets structure
      return {
        tagsets: MOCK_GLOBAL_TAGSETS,
        tvs: [
          { 
            device_id: 'mock_device_1', 
            name: 'Living Room Frame', 
            ...getEffectiveTags('mock_device_1'),
            ...MOCK_TV_TAGSET_ASSIGNMENTS['mock_device_1']
          },
          { 
            device_id: 'mock_device_2', 
            name: 'Bedroom Frame', 
            ...getEffectiveTags('mock_device_2'),
            ...MOCK_TV_TAGSET_ASSIGNMENTS['mock_device_2']
          },
          { 
            device_id: 'mock_device_3', 
            name: 'Office Frame', 
            ...getEffectiveTags('mock_device_3'),
            ...MOCK_TV_TAGSET_ASSIGNMENTS['mock_device_3']
          },
          { 
            device_id: 'mock_device_4', 
            name: 'Kitchen Frame', 
            ...getEffectiveTags('mock_device_4'),
            ...MOCK_TV_TAGSET_ASSIGNMENTS['mock_device_4']
          }
        ]
      };
    }
    
    // Add delay for display_image to simulate upload time
    if (endpoint.includes('display_image')) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Mock service calls for tagsets
    if (endpoint.includes('services/frame_art_shuffler')) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true };
    }
    
    return { success: true };
  }

  try {
    const config = {
      method,
      url: `${HA_API_BASE}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${SUPERVISOR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data
    };
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`HA Request Error (${endpoint}):`, error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
};

// GET /api/ha/tvs - Get list of Frame TVs with tagset data
router.get('/tvs', requireHA, async (req, res) => {
  try {
    // Template to find devices belonging to the integration
    // Global tagsets are exposed as full definitions in sensor attributes
    const template = `
      {% set ns = namespace(tvs=[], global_tagsets={}) %}
      {% set devices = integration_entities('frame_art_shuffler') | map('device_id') | unique | list %}
      
      {% for device_id in devices %}
        {% if device_id and device_id != 'None' %}
          {% set device_name = device_attr(device_id, 'name') %}
          {% set entities = device_entities(device_id) %}
          {% set ns.tags = [] %}
          {% set ns.exclude_tags = [] %}
          {% set ns.selected_tagset = none %}
          {% set ns.override_tagset = none %}
          {% set ns.override_expiry_time = none %}
          {% set ns.active_tagset = none %}
          {% set ns.screen_on = none %}
          {% set ns.next_shuffle_time = none %}
          
          {% for entity in entities %}
            {% if entity.endswith('_auto_shuffle_next') %}
              {# Get next auto-shuffle time from sensor #}
              {% set next_shuffle = states(entity) %}
              {% if next_shuffle and next_shuffle not in ['unknown', 'unavailable', 'None'] %}
                {% set ns.next_shuffle_time = next_shuffle %}
              {% endif %}
            {% endif %}
            {% if entity.endswith('_screen_on') %}
              {# Get screen power state from binary_sensor #}
              {% set screen_state = states(entity) %}
              {% if screen_state == 'on' %}
                {% set ns.screen_on = true %}
              {% elif screen_state == 'off' %}
                {% set ns.screen_on = false %}
              {% endif %}
            {% endif %}
            {% if entity.endswith('_current_artwork') %}
              {# Get global tagsets (full definitions - same on all TVs) #}
              {% set tagsets_attr = state_attr(entity, 'tagsets') %}
              {% if tagsets_attr and tagsets_attr is mapping and not ns.global_tagsets %}
                {% set ns.global_tagsets = tagsets_attr %}
              {% endif %}
              {% set selected = state_attr(entity, 'selected_tagset') %}
              {% if selected %}{% set ns.selected_tagset = selected %}{% endif %}
              {% set override = state_attr(entity, 'override_tagset') %}
              {% if override %}{% set ns.override_tagset = override %}{% endif %}
              {% set expiry = state_attr(entity, 'override_expiry_time') %}
              {% if expiry %}{% set ns.override_expiry_time = expiry %}{% endif %}
              {% set active = state_attr(entity, 'active_tagset') %}
              {% if active %}{% set ns.active_tagset = active %}{% endif %}
              {# Get effective tags for this TV #}
              {% set tags_attr = state_attr(entity, 'tags') %}
              {% if tags_attr and tags_attr is iterable and tags_attr is not string %}
                {% set ns.tags = tags_attr %}
              {% endif %}
              {% set exclude_attr = state_attr(entity, 'exclude_tags') %}
              {% if exclude_attr and exclude_attr is iterable and exclude_attr is not string %}
                {% set ns.exclude_tags = exclude_attr %}
              {% endif %}
            {% endif %}
          {% endfor %}
          
          {% set ns.tvs = ns.tvs + [{
            'device_id': device_id,
            'name': device_name,
            'tags': ns.tags,
            'exclude_tags': ns.exclude_tags,
            'selected_tagset': ns.selected_tagset,
            'override_tagset': ns.override_tagset,
            'override_expiry_time': ns.override_expiry_time,
            'active_tagset': ns.active_tagset,
            'screen_on': ns.screen_on,
            'next_shuffle_time': ns.next_shuffle_time
          }] %}
        {% endif %}
      {% endfor %}
      {{ {'tagsets': ns.global_tagsets, 'tvs': ns.tvs} | to_json }}
    `;

    const result = await haRequest('POST', '/template', { template });
    
    // The template API returns the rendered string, we need to parse it
    let data = { tagsets: {}, tvs: [] };
    if (typeof result === 'string') {
      try {
        data = JSON.parse(result);
      } catch (e) {
        console.error('Failed to parse TV list template result:', result);
      }
    } else if (result && typeof result === 'object') {
      // Mock or direct object return
      data = result;
    }

    // Global tagsets as object: { name: { tags, exclude_tags }, ... }
    const tagsets = data.tagsets || {};
    const tvs = data.tvs || [];

    res.json({ success: true, tagsets, tvs });
  } catch (error) {
    console.error('Error in /tvs route:', error.message);
    if (error.config) {
      console.error('HA Request URL:', error.config.url);
    }
    if (error.response) {
      console.error('HA Response status:', error.response.status);
      console.error('HA Response data:', JSON.stringify(error.response.data));
    }
    res.status(500).json({ 
      error: 'Failed to fetch TVs from Home Assistant', 
      details: error.message,
      haError: error.response ? error.response.data : null
    });
  }
});

// POST /api/ha/display - Display image on TV
router.post('/display', requireHA, async (req, res) => {
  const { device_id, entity_id, filename, matte, filter } = req.body;

  if ((!device_id && !entity_id) || !filename) {
    return res.status(400).json({ error: 'Missing device_id/entity_id or filename' });
  }

  try {
    // Construct the path/URL to the image
    const imagePath = path.join(req.frameArtPath, 'library', filename);
    const relativePath = path.relative('/config/www', imagePath);
    const imageUrl = `/local/${relativePath}`;

    const payload = {
      image_path: imagePath,
      image_url: imageUrl,
      filename: filename
    };

    if (matte) payload.matte = matte;
    if (filter) payload.filter = filter;

    if (device_id) {
      payload.device_id = device_id;
    } else {
      payload.entity_id = entity_id;
    }

    await haRequest('POST', `/services/frame_art_shuffler/display_image`, payload);

    res.json({ success: true, message: 'Command sent to TV' });
  } catch (error) {
    // Extract meaningful error message from HA response
    let errorMessage = 'Failed to send command to TV';
    if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    console.error('Display error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/ha/upload-log - Get upload progress log
router.get('/upload-log', requireHA, async (req, res) => {
  // Mock logs for development if no token
  if (!SUPERVISOR_TOKEN && process.env.NODE_ENV === 'development') {
    const mockLogs = [
      "[10:00:01] Starting process for 192.168.1.50...",
      "[10:00:02] Checking Art Mode connection and listing current images...",
      "[10:00:03] Art Mode connection OK. Images on TV: 5",
      "[10:00:04] Uploading image to 192.168.1.50 (attempt 1/3)...",
      "[10:00:08] Upload successful, content_id=12345",
      "[10:00:10] Art 12345 successfully displayed on 192.168.1.50",
      "[10:00:11] Upload complete for 192.168.1.50 (content_id=12345)"
    ].join('\n');
    return res.json({ success: true, logs: mockLogs });
  }

  const logPath = '/config/frame_art_shuffler/upload.log';
  try {
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf8');
      res.json({ success: true, logs });
    } else {
      res.json({ success: true, logs: 'Waiting for logs...' });
    }
  } catch (error) {
    console.error('Error reading upload log:', error);
    res.status(500).json({ error: 'Failed to read upload log' });
  }
});

// GET /api/ha/recently-displayed - Get currently and previously displayed images per TV
router.get('/recently-displayed', requireHA, async (req, res) => {
  try {
    // 1. Get current artwork for each TV from HA sensors
    const currentImages = {};
    
    // Query HA for all current_artwork sensors
    const template = `
      {% set ns = namespace(result=[]) %}
      {% for state in states.sensor %}
        {% if state.entity_id.endswith('_current_artwork') and state.attributes.get('device_class') is none %}
          {% set device_id = device_id(state.entity_id) %}
          {% if device_id %}
            {% set device_name = device_attr(device_id, 'name') %}
            {% set ns.result = ns.result + [{
              'device_id': device_id,
              'tv_name': device_name,
              'filename': state.state
            }] %}
          {% endif %}
        {% endif %}
      {% endfor %}
      {{ ns.result | to_json }}
    `;
    
    let haResult = [];
    if (SUPERVISOR_TOKEN || process.env.NODE_ENV !== 'development') {
      const result = await haRequest('POST', '/template', { template });
      if (typeof result === 'string') {
        try {
          haResult = JSON.parse(result);
        } catch (e) {
          console.error('Failed to parse current artwork template result:', result);
        }
      } else if (Array.isArray(result)) {
        haResult = result;
      }
    } else {
      // Mock data for development
      haResult = [
        { device_id: 'mock_device_1', tv_name: 'Living Room Frame', filename: 'sunset-beach-abc123.jpg' },
        { device_id: 'mock_device_2', tv_name: 'Office Frame', filename: 'mountain-view-def456.jpg' }
      ];
    }
    
    // Build current images map: filename -> [{ tv_id, tv_name, time: 'now' }]
    for (const item of haResult) {
      if (item.filename && item.filename !== 'Unknown' && item.filename !== 'unknown') {
        if (!currentImages[item.filename]) {
          currentImages[item.filename] = [];
        }
        currentImages[item.filename].push({
          tv_id: item.device_id,
          tv_name: item.tv_name,
          time: 'now',
          timestamp: Date.now()
        });
      }
    }
    
    // 2. Get previous images from pending.json and events.json
    const logsPath = process.env.NODE_ENV === 'production' 
      ? '/config/frame_art/logs' 
      : path.join(__dirname, '..', 'test-data', 'mock-logs');
    
    const previousImages = {};
    
    // Read pending.json (unflushed recent events)
    let pendingEvents = [];
    try {
      const pendingPath = path.join(logsPath, 'pending.json');
      const pendingData = await fs.promises.readFile(pendingPath, 'utf8');
      pendingEvents = JSON.parse(pendingData) || [];
    } catch (e) {
      // pending.json may not exist - that's fine
    }
    
    // Read events.json
    let events = [];
    try {
      const eventsPath = path.join(logsPath, 'events.json');
      const eventsData = await fs.promises.readFile(eventsPath, 'utf8');
      events = JSON.parse(eventsData) || [];
    } catch (e) {
      // events.json may not exist - that's fine
    }
    
    // Combine and sort by completed_at desc
    const allEvents = [...pendingEvents, ...events];
    allEvents.sort((a, b) => {
      const timeA = new Date(a.completed_at || 0).getTime();
      const timeB = new Date(b.completed_at || 0).getTime();
      return timeB - timeA;
    });
    
    // Get most recent completed event per TV (excluding current images)
    const seenTVs = new Set();
    for (const event of allEvents) {
      const tvId = event.tv_id;
      if (!tvId || seenTVs.has(tvId)) continue;
      
      const filename = event.filename;
      if (!filename) continue;
      
      // Skip if this is the current image for this TV
      const currentForTV = currentImages[filename]?.some(c => c.tv_id === tvId);
      if (currentForTV) continue;
      
      seenTVs.add(tvId);
      
      if (!previousImages[filename]) {
        previousImages[filename] = [];
      }
      previousImages[filename].push({
        tv_id: tvId,
        tv_name: event.tv_name || tvId,
        time: event.completed_at,
        timestamp: new Date(event.completed_at).getTime()
      });
    }
    
    // 3. Merge current and previous into single result
    const result = {};
    
    for (const [filename, entries] of Object.entries(currentImages)) {
      result[filename] = entries;
    }
    
    for (const [filename, entries] of Object.entries(previousImages)) {
      if (!result[filename]) {
        result[filename] = entries;
      } else {
        result[filename] = [...result[filename], ...entries];
      }
    }
    
    // Sort entries within each filename by timestamp desc
    for (const filename of Object.keys(result)) {
      result[filename].sort((a, b) => b.timestamp - a.timestamp);
    }
    
    res.json({ success: true, images: result });
  } catch (error) {
    console.error('Error in /recently-displayed route:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch recently displayed images', 
      details: error.message 
    });
  }
});

// ============================================================================
// TAGSET ENDPOINTS
// Tagsets are GLOBAL (not per-TV). upsert and delete don't need device_id.
// select, override, and clear-override still need device_id (per-TV assignment).
// ============================================================================

// POST /api/ha/tagsets/upsert - Create or update a GLOBAL tagset
router.post('/tagsets/upsert', requireHA, async (req, res) => {
  const { name, original_name, tags, exclude_tags, tag_weights, weighting_type } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Tagset name is required' });
  }
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'At least one tag is required' });
  }

  try {
    const payload = {
      name: name.trim(),
      tags,
      exclude_tags: exclude_tags || [],
      weighting_type: weighting_type || 'image'
    };
    
    // Include original_name for rename support
    if (original_name && original_name.trim() && original_name.trim() !== name.trim()) {
      payload.original_name = original_name.trim();
    }
    
    // Include tag_weights if provided (only relevant for tag-weighted mode)
    if (tag_weights && typeof tag_weights === 'object') {
      // Validate and filter weights
      const validatedWeights = {};
      for (const [tag, weight] of Object.entries(tag_weights)) {
        const w = parseFloat(weight);
        if (!isNaN(w) && w >= 0.1 && w <= 10) {
          validatedWeights[tag] = w;
        }
      }
      if (Object.keys(validatedWeights).length > 0) {
        payload.tag_weights = validatedWeights;
      }
    }

    await haRequest('POST', '/services/frame_art_shuffler/upsert_tagset', payload);
    res.json({ success: true, message: `Tagset '${name}' saved` });
  } catch (error) {
    console.error('Error upserting tagset:', error.message);
    res.status(500).json({ 
      error: 'Failed to save tagset', 
      details: error.response?.data?.message || error.message 
    });
  }
});

// POST /api/ha/tagsets/delete - Delete a GLOBAL tagset
// Pre-validates in add-on since HA Supervisor API strips error messages
router.post('/tagsets/delete', requireHA, async (req, res) => {
  const { name, tagsets, tvs } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Tagset name is required' });
  }

  const tagsetName = name.trim();

  // Pre-validation using client-provided data (since HA strips error messages)
  if (tagsets && tvs) {
    // Check if tagset exists
    if (!tagsets[tagsetName]) {
      return res.status(400).json({ 
        error: 'Failed to delete tagset',
        details: `Tagset '${tagsetName}' not found`
      });
    }

    // Check if it's the only tagset
    if (Object.keys(tagsets).length <= 1) {
      return res.status(400).json({ 
        error: 'Failed to delete tagset',
        details: 'Cannot delete the only tagset'
      });
    }

    // Check if any TV is using this tagset
    for (const tv of tvs) {
      if (tv.selected_tagset === tagsetName) {
        return res.status(400).json({ 
          error: 'Failed to delete tagset',
          details: `Cannot delete tagset '${tagsetName}': selected by ${tv.name}. Select a different tagset for that TV first.`
        });
      }
      if (tv.override_tagset === tagsetName) {
        return res.status(400).json({ 
          error: 'Failed to delete tagset',
          details: `Cannot delete tagset '${tagsetName}': active override on ${tv.name}. Clear the override first.`
        });
      }
    }
  }

  try {
    await haRequest('POST', '/services/frame_art_shuffler/delete_tagset', { name: tagsetName });
    res.json({ success: true, message: `Tagset '${tagsetName}' deleted` });
  } catch (error) {
    console.error('Error deleting tagset:', error.message);
    res.status(500).json({ 
      error: 'Failed to delete tagset', 
      details: error.message || 'Unknown error'
    });
  }
});

// POST /api/ha/tagsets/select - Select a tagset for a specific TV
router.post('/tagsets/select', requireHA, async (req, res) => {
  const { device_id, name } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Tagset name is required' });
  }

  try {
    const payload = {
      device_id,
      name: name.trim()
    };

    await haRequest('POST', '/services/frame_art_shuffler/select_tagset', payload);
    res.json({ success: true, message: `Tagset '${name}' selected` });
  } catch (error) {
    console.error('Error selecting tagset:', error.message);
    res.status(500).json({ 
      error: 'Failed to select tagset', 
      details: error.response?.data?.message || error.message 
    });
  }
});

// POST /api/ha/tagsets/override - Apply a temporary tagset override
router.post('/tagsets/override', requireHA, async (req, res) => {
  const { device_id, name, duration_minutes } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Tagset name is required' });
  }
  if (!duration_minutes || typeof duration_minutes !== 'number' || duration_minutes <= 0) {
    return res.status(400).json({ error: 'Duration (in minutes) must be a positive number' });
  }

  try {
    const payload = {
      device_id,
      name: name.trim(),
      duration_minutes
    };

    await haRequest('POST', '/services/frame_art_shuffler/override_tagset', payload);
    res.json({ success: true, message: `Override '${name}' applied for ${duration_minutes} minutes` });
  } catch (error) {
    console.error('Error applying tagset override:', error.message);
    res.status(500).json({ 
      error: 'Failed to apply tagset override', 
      details: error.response?.data?.message || error.message 
    });
  }
});

// POST /api/ha/tagsets/clear-override - Clear an active tagset override
router.post('/tagsets/clear-override', requireHA, async (req, res) => {
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }

  try {
    const payload = { device_id };

    await haRequest('POST', '/services/frame_art_shuffler/clear_tagset_override', payload);
    res.json({ success: true, message: 'Override cleared' });
  } catch (error) {
    console.error('Error clearing tagset override:', error.message);
    res.status(500).json({
      error: 'Failed to clear tagset override',
      details: error.response?.data?.message || error.message
    });
  }
});

// GET /api/ha/pool-health - Get pool health data for all TVs
router.get('/pool-health', requireHA, async (req, res) => {
  // Mock data for development
  if (!SUPERVISOR_TOKEN && process.env.NODE_ENV === 'development') {
    // Configured values (what's "saved")
    const configuredSameTv = 120;
    const configuredCrossTv = 72;

    // Use query params for preview, or fall back to configured
    const sameTvHours = parseInt(req.query.same_tv_hours, 10) || configuredSameTv;
    const crossTvHours = parseInt(req.query.cross_tv_hours, 10) || configuredCrossTv;

    // Generate mock history data (7 days of shuffles at 15-min intervals = ~672 points)
    const now = new Date();
    const generateMockHistory = (poolSize, startAvailable) => {
      const history = [];
      // Generate data points every 15 minutes for 7 days (672 points)
      for (let i = 672; i >= 0; i--) {
        const timestamp = new Date(now.getTime() - i * 15 * 60 * 1000);
        // Simulate gradual decrease with some variation
        const available = Math.max(10, startAvailable - Math.floor(i * 0.2) + Math.floor(Math.random() * 20) - 10);
        history.push({
          timestamp: timestamp.toISOString(),
          pool_size: poolSize,
          pool_available: available,
        });
      }
      return history;
    };

    // Simulate how recency affects available count
    // Larger windows = more images marked as recent = fewer available
    const windowFactor = (sameTvHours + crossTvHours) / (configuredSameTv + configuredCrossTv);
    const adjustRecent = (baseRecent) => Math.round(baseRecent * windowFactor);

    const tv1SameTvRecent = adjustRecent(300);
    const tv1CrossTvRecent = adjustRecent(50);
    const tv1TotalRecent = tv1SameTvRecent + tv1CrossTvRecent;
    const tv1Available = Math.max(0, 500 - tv1TotalRecent);

    const tv2SameTvRecent = adjustRecent(320);
    const tv2CrossTvRecent = adjustRecent(24);
    const tv2TotalRecent = tv2SameTvRecent + tv2CrossTvRecent;
    const tv2Available = Math.max(0, 533 - tv2TotalRecent);

    return res.json({
      success: true,
      data: {
        tvs: {
          'mock_device_1': {
            name: 'Living Room Frame',
            pool_size: 500,
            same_tv_recent: tv1SameTvRecent,
            cross_tv_recent: tv1CrossTvRecent,
            total_recent: tv1TotalRecent,
            available: tv1Available,
            shuffle_frequency_minutes: 15,
            same_tv_hours: sameTvHours,
            cross_tv_hours: crossTvHours,
            history: generateMockHistory(500, 200),
          },
          'mock_device_2': {
            name: 'Bedroom Frame',
            pool_size: 533,
            same_tv_recent: tv2SameTvRecent,
            cross_tv_recent: tv2CrossTvRecent,
            total_recent: tv2TotalRecent,
            available: tv2Available,
            shuffle_frequency_minutes: 15,
            same_tv_hours: sameTvHours,
            cross_tv_hours: crossTvHours,
            history: generateMockHistory(533, 250),
          },
        },
        windows: {
          same_tv_hours: sameTvHours,
          cross_tv_hours: crossTvHours,
          configured_same_tv_hours: configuredSameTv,
          configured_cross_tv_hours: configuredCrossTv,
        },
      },
    });
  }

  try {
    // Pass through query params for preview
    const params = new URLSearchParams();
    if (req.query.same_tv_hours) params.append('same_tv_hours', req.query.same_tv_hours);
    if (req.query.cross_tv_hours) params.append('cross_tv_hours', req.query.cross_tv_hours);
    const queryString = params.toString();
    const url = '/frame_art_shuffler/pool_health' + (queryString ? `?${queryString}` : '');

    const result = await haRequest('GET', url);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching pool health:', error.message);
    res.status(500).json({
      error: 'Failed to fetch pool health',
      details: error.response?.data?.message || error.message
    });
  }
});

// POST /api/ha/set-recency-windows - Set recency window configuration
router.post('/set-recency-windows', requireHA, async (req, res) => {
  const { same_tv_hours, cross_tv_hours } = req.body;

  // Mock for development
  if (!SUPERVISOR_TOKEN && process.env.NODE_ENV === 'development') {
    console.log('Mock: set_recency_windows called with', { same_tv_hours, cross_tv_hours });
    return res.json({ success: true });
  }

  try {
    const serviceData = {};
    if (same_tv_hours !== undefined) serviceData.same_tv_hours = parseInt(same_tv_hours, 10);
    if (cross_tv_hours !== undefined) serviceData.cross_tv_hours = parseInt(cross_tv_hours, 10);

    await haRequest('POST', '/services/frame_art_shuffler/set_recency_windows', serviceData);
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting recency windows:', error.message);
    res.status(500).json({
      error: 'Failed to set recency windows',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
