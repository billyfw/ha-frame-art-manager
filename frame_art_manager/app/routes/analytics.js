const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

/**
 * Parse JSONL (one JSON object per line) into an array.
 */
function parseJsonl(data) {
  return data.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

// Path to activity logs - in production this is /config/frame_art/logs/
// In development, use test-data folder
const getLogsPath = () => {
  if (process.env.NODE_ENV === 'production') {
    return '/config/frame_art/logs';
  }
  // Development: use test-data folder relative to app directory
  return path.join(__dirname, '..', 'test-data', 'mock-logs');
};

// Multi-home: the shuffler's display logs live on each house's HA box. As an
// add-on we read them off the shared /config mount; centrally (Fly) we fetch
// them from the integration's logs view. See docs/MULTI_HOME_PLAN.md §4.3.
const axios = require('axios');
const houses = require('../houses');

/**
 * Read one log file ('events' | 'summary' | 'pending') for the request's house.
 * Missing data raises an ENOENT-coded error so existing "no data yet" handling
 * works identically for both the local-file and HTTP paths.
 */
async function readLog(req, type) {
  const house = houses.resolveHouse(req);

  if (!house) {
    const filename = type === 'events' ? 'events.json'
      : type === 'pending' ? 'pending.json' : 'summary.json';
    return fs.readFile(path.join(getLogsPath(), filename), 'utf8');
  }

  const cfg = houses.houseRequestConfig(house);
  try {
    const response = await axios({
      method: 'GET',
      url: `${house.baseUrl}/api/frame_art_shuffler/logs`,
      params: { type },
      headers: cfg.headers,
      timeout: cfg.timeout,
      httpAgent: cfg.httpAgent,
      httpsAgent: cfg.httpsAgent,
      proxy: cfg.proxy,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      const err = new Error(`No ${type} log at ${house.id}`);
      err.code = 'ENOENT';
      throw err;
    }
    throw error;
  }
}

/**
 * Build display_periods from events.json for timeline visualization
 * Groups events by image+TV and returns time ranges
 */
async function buildDisplayPeriods(eventsData) {
  try {
    const data = eventsData;
    const events = parseJsonl(data);

    if (events.length === 0) {
      return {};
    }
    
    // Group by filename -> tv_id -> array of periods
    const periods = {};
    
    for (const event of events) {
      const { filename, tv_id, started_at, completed_at, matte, photo_filter, tagset_name } = event;
      if (!filename || !tv_id || !started_at || !completed_at) continue;
      
      // Parse timestamps
      const start = new Date(started_at).getTime();
      const end = new Date(completed_at).getTime();
      
      if (isNaN(start) || isNaN(end)) continue;
      
      // Initialize nested structure
      if (!periods[filename]) {
        periods[filename] = {};
      }
      if (!periods[filename][tv_id]) {
        periods[filename][tv_id] = [];
      }
      
      // Include matte and photo_filter if present (non-null/non-"none")
      const period = { start, end };
      if (matte && matte !== 'none') {
        period.matte = matte;
      }
      if (photo_filter && photo_filter !== 'none') {
        period.photo_filter = photo_filter;
      }
      // Include tagset_name if present
      if (tagset_name) {
        period.tagset_name = tagset_name;
      }
      periods[filename][tv_id].push(period);
    }
    
    // Sort each TV's periods by start time
    for (const filename of Object.keys(periods)) {
      for (const tvId of Object.keys(periods[filename])) {
        periods[filename][tvId].sort((a, b) => a.start - b.start);
      }
    }
    
    return periods;
  } catch (error) {
    // events.json may not exist or be empty - that's okay
    if (error.code !== 'ENOENT') {
      console.warn('Error reading events.json for display periods:', error.message);
    }
    return {};
  }
}

// GET /api/analytics/summary - Get activity summary data
router.get('/summary', async (req, res) => {
  try {
    const data = await readLog(req, 'summary');
    const summary = JSON.parse(data);

    // Also load display periods from events.json (best effort)
    let displayPeriods = {};
    try {
      displayPeriods = await buildDisplayPeriods(await readLog(req, 'events'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('display periods unavailable:', err.message);
    }
    
    // Merge display_periods into each image's data
    if (summary.images && Object.keys(displayPeriods).length > 0) {
      for (const [filename, tvPeriods] of Object.entries(displayPeriods)) {
        if (summary.images[filename]) {
          summary.images[filename].display_periods = tvPeriods;
        }
      }
    }
    
    res.json({ 
      success: true, 
      data: summary 
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - no data yet
      res.json({ 
        success: false, 
        reason: 'no_data',
        message: 'No activity data found. Activity logging may not be enabled or no sessions have been recorded yet.'
      });
    } else if (error instanceof SyntaxError) {
      // JSON parse error
      console.error('Error parsing summary.json:', error);
      res.status(500).json({ 
        success: false, 
        reason: 'parse_error',
        message: 'Activity data file is corrupted.'
      });
    } else {
      // Other error
      console.error('Error reading summary.json:', error);
      res.status(500).json({ 
        success: false, 
        reason: 'error',
        message: error.message
      });
    }
  }
});

// GET /api/analytics/status - Quick check if logging is available
router.get('/status', async (req, res) => {
  try {
    const data = await readLog(req, 'summary');
    const summary = JSON.parse(data);

    res.json({
      available: true,
      logging_enabled: summary.logging_enabled ?? true,
      generated_at: summary.generated_at,
      event_count: summary.totals?.event_count ?? 0
    });
  } catch (error) {
    res.json({
      available: false,
      logging_enabled: null,
      generated_at: null,
      event_count: 0
    });
  }
});

// GET /api/analytics/last-displayed - Get last displayed timestamp for each image
// Returns { filename: timestamp } for sorting by last displayed
router.get('/last-displayed', async (req, res) => {
  try {
    const data = await readLog(req, 'events');
    const events = parseJsonl(data);
    
    // Find the most recent completed_at for each filename
    const lastDisplayed = {};
    for (const event of events) {
      const { filename, completed_at } = event;
      if (!filename || !completed_at) continue;
      
      const timestamp = new Date(completed_at).getTime();
      if (isNaN(timestamp)) continue;
      
      if (!lastDisplayed[filename] || timestamp > lastDisplayed[filename]) {
        lastDisplayed[filename] = timestamp;
      }
    }
    
    res.json({ success: true, lastDisplayed });
  } catch (error) {
    if (error.code === 'ENOENT') {
      // No events file - return empty (no display history)
      res.json({ success: true, lastDisplayed: {} });
    } else {
      console.error('Error reading events.json for last-displayed:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

module.exports = router;
