const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');

// Supervisor API configuration
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const HA_API_BASE = 'http://supervisor/core/api';

// Middleware to check if we're running in HA environment
const requireHA = (req, res, next) => {
  if (!SUPERVISOR_TOKEN) {
    // For development/testing outside HA, you might want to mock this or error
    if (process.env.NODE_ENV === 'development') {
      console.warn('Mocking HA request in development');
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
          tags: ['Landscape', 'Nature'],
          exclude_tags: ['Portrait']
        },
        { 
          device_id: 'mock_device_2', 
          name: 'Bedroom Frame', 
          tags: ['Family', 'Portrait'],
          exclude_tags: []
        }
      ];
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
  const { device_id, entity_id, filename } = req.body;

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

module.exports = router;
