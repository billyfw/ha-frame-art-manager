const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

// Path to activity logs - in production this is /config/frame_art/logs/
// In development, use test-data folder
const getLogsPath = () => {
  if (process.env.NODE_ENV === 'production') {
    return '/config/frame_art/logs';
  }
  // Development: use test-data folder relative to app directory
  return path.join(__dirname, '..', 'test-data', 'mock-logs');
};

/**
 * Build display_periods from events.json for timeline visualization
 * Groups events by image+TV and returns time ranges
 */
async function buildDisplayPeriods(logsPath) {
  const eventsPath = path.join(logsPath, 'events.json');
  
  try {
    const data = await fs.readFile(eventsPath, 'utf8');
    const events = JSON.parse(data);
    
    if (!Array.isArray(events) || events.length === 0) {
      return {};
    }
    
    // Group by filename -> tv_id -> array of periods
    const periods = {};
    
    for (const event of events) {
      const { filename, tv_id, started_at, completed_at } = event;
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
      
      periods[filename][tv_id].push({ start, end });
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
  const logsPath = getLogsPath();
  const summaryPath = path.join(logsPath, 'summary.json');
  
  try {
    const data = await fs.readFile(summaryPath, 'utf8');
    const summary = JSON.parse(data);
    
    // Also load display periods from events.json
    const displayPeriods = await buildDisplayPeriods(logsPath);
    
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
  const logsPath = getLogsPath();
  const summaryPath = path.join(logsPath, 'summary.json');
  
  try {
    const data = await fs.readFile(summaryPath, 'utf8');
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

module.exports = router;
