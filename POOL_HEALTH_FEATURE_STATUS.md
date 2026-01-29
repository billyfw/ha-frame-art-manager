# Pool Health Feature - Implementation Status

**Date:** 2026-01-28
**Status:** ✅ COMPLETE

## What Was Implemented

### 1. Pool Health API Endpoint (Frame Art Shuffler)
- **File:** `custom_components/frame_art_shuffler/__init__.py`
- **Endpoint:** `GET /api/frame_art_shuffler/pool_health`
- Returns per-TV pool health data with fields:
  - `pool_size`, `same_tv_recent`, `cross_tv_recent`, `total_recent`, `available`
  - `shuffle_frequency_minutes` (for variety calculation)
  - `history` (7-day trend data for sparkline)
- Supports query params for preview: `?same_tv_hours=X&cross_tv_hours=Y`

### 2. Pool Health Calculation (Frame Art Shuffler)
- **File:** `custom_components/frame_art_shuffler/display_log.py`
- Added `get_pool_health()` method to `DisplayLogManager`
- Added `get_pool_health_history()` method for sparkline data
- Calculates mutually exclusive buckets (same-TV vs cross-TV)

### 3. Pool Health Table UI (Frame Art Manager)
- **Location:** Advanced tab > Recency sub-tab
- **Columns:** TV, Pool, Same-TV Recent, Cross-TV Recent, Total Recent, Available, Trend (7d), Variety
- Variety column shows hours of unique shuffles with color coding
- Trend sparkline shows 7-day history of Available count
- Info icons (ⓘ) with tooltips explaining metrics

### 4. Configurable Recency Windows
- **Service:** `frame_art_shuffler.set_recency_windows`
- Adjustable from 6 to 168 hours (1 week)
- **Defaults:** Same-TV: 120h (5 days), Cross-TV: 72h (3 days)
- **UI:** Sliders with day markers (1d-6d), saved value indicators
- **Live preview:** Shows impact on Available and Variety before saving

### 5. Sparkline Trend
- Records `pool_size` and `pool_available` at each auto-shuffle
- 7-day history shown as inline SVG sparkline
- Visual indicator of pool health trends over time

### 6. Documentation
- Updated `docs/SHUFFLE_FEATURE.md` with:
  - Configurable windows section
  - set_recency_windows service documentation
  - History field documentation
  - Updated API response format

## Files Modified

### Frame Art Shuffler
- `custom_components/frame_art_shuffler/__init__.py` - Pool health API, set_recency_windows service
- `custom_components/frame_art_shuffler/display_log.py` - get_pool_health(), get_pool_health_history()
- `custom_components/frame_art_shuffler/shuffle.py` - Pass pool stats to display log
- `custom_components/frame_art_shuffler/services.yaml` - set_recency_windows service definition
- `docs/SHUFFLE_FEATURE.md` - Documentation updates

### Frame Art Manager
- `frame_art_manager/app/routes/ha.js` - Pool health proxy endpoint with mock data
- `frame_art_manager/app/public/index.html` - Recency tab, sliders, preview table
- `frame_art_manager/app/public/js/app.js` - Pool health rendering, slider logic, preview
- `frame_art_manager/app/public/css/style.css` - Pool health table, slider, sparkline styles

## Testing

```bash
# Development server (uses mock data)
cd /Users/billywaldman/devprojects/ha-frame-art-manager/frame_art_manager/app
NODE_ENV=development node server.js
# Open http://localhost:8099 → Advanced → Recency tab
```

## Verification Checklist for Production

1. **Pool Health Table loads correctly** - Shows real data from HA API
2. **Sparkline trend displays** - Requires shuffle history data (run some shuffles first)
3. **Slider preview works** - Drag sliders, see Available/Variety update in preview table
4. **Apply Changes persists** - New windows are saved and used by shuffle algorithm
5. **Day mark labels visible** - Hash marks show 1d through 6d
