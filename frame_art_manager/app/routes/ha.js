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

// Helper for HA requests
const haRequest = async (method, endpoint, data = null) => {
  if (!SUPERVISOR_TOKEN && process.env.NODE_ENV === 'development') {
    // Mock responses for dev
    if (endpoint.includes('template')) {
      return [
        { 
          device_id: 'mock_device_1', 
          name: 'Living Room Frame', 
          tags: ['Landscape', 'Nature', 'Beach', 'Mountains'],
          exclude_tags: ['Portrait', 'Dark']
        },
        { 
          device_id: 'mock_device_2', 
          name: 'Bedroom Frame', 
          tags: ['Family', 'Portrait', 'Kids'],
          exclude_tags: ['Abstract']
        },
        { 
          device_id: 'mock_device_3', 
          name: 'Office Frame', 
          tags: ['Abstract', 'Urban', 'Architecture'],
          exclude_tags: ['Family']
        },
        { 
          device_id: 'mock_device_4', 
          name: 'Kitchen Frame', 
          tags: ['Nature', 'Food', 'Colorful'],
          exclude_tags: []
        }
      ];
    }
    
    // Add delay for display_image to simulate upload time
    if (endpoint.includes('display_image')) {
      await new Promise(resolve => setTimeout(resolve, 3000));
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

// GET /api/ha/tvs - Get list of Frame TVs
router.get('/tvs', requireHA, async (req, res) => {
  try {
    // Template to find devices belonging to the integration and their tags
    const template = `
      {% set ns = namespace(tvs=[]) %}
      {% set devices = integration_entities('frame_art_shuffler') | map('device_id') | unique | list %}
      {% for device_id in devices %}
        {% if device_id and device_id != 'None' %}
          {% set device_name = device_attr(device_id, 'name') %}
          {% set entities = device_entities(device_id) %}
          {% set ns.tags = [] %}
          {% set ns.exclude_tags = [] %}
          
          {% for entity in entities %}
            {% if entity.startswith('text.') %}
              {% set fname = (state_attr(entity, 'friendly_name') or '')|lower %}
              {% if 'tags' in fname and 'include' in fname %}
                 {% set state = states(entity) %}
                 {% if state and state != 'unknown' and state != 'unavailable' and state != '' %}
                   {% set ns.tags = state.split(',') | map('trim') | list %}
                 {% endif %}
              {% elif 'tags' in fname and 'exclude' in fname %}
                 {% set state = states(entity) %}
                 {% if state and state != 'unknown' and state != 'unavailable' and state != '' %}
                   {% set ns.exclude_tags = state.split(',') | map('trim') | list %}
                 {% endif %}
              {% endif %}
            {% endif %}
          {% endfor %}
          
          {% set ns.tvs = ns.tvs + [{
            'device_id': device_id,
            'name': device_name,
            'tags': ns.tags,
            'exclude_tags': ns.exclude_tags
          }] %}
        {% endif %}
      {% endfor %}
      {{ ns.tvs | to_json }}
    `;

    const result = await haRequest('POST', '/template', { template });
    
    // The template API returns the rendered string, we need to parse it
    let tvs = [];
    if (typeof result === 'string') {
      try {
        tvs = JSON.parse(result);
      } catch (e) {
        console.error('Failed to parse TV list template result:', result);
        tvs = [];
      }
    } else if (Array.isArray(result)) {
      // In case our mock or some other mechanism returns an array directly
      tvs = result;
    }

    res.json({ success: true, tvs });
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
    res.status(500).json({ error: 'Failed to send command to TV' });
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

module.exports = router;
