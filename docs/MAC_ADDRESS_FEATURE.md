# MAC Address Feature Implementation

## Overview
Added support for storing and managing MAC addresses for TV devices in the Frame Art Manager system. **MAC addresses are now required** for all TV configurations.

## Changes Made

### Backend (MetadataHelper)
**File:** `frame_art_manager/app/metadata_helper.js`

1. **New Method: `normalizeMacAddress(mac)`**
   - Accepts MAC addresses in various formats:
     - Colons: `AA:BB:CC:DD:EE:FF`
     - Dashes: `AA-BB-CC-DD-EE-FF`
     - Dots: `AA.BB.CC.DD.EE.FF`
     - Spaces: `AA BB CC DD EE FF`
     - No separators: `AABBCCDDEEFF`
     - Mixed formats: `AA:BB-CC.DD EE:FF`
   - Returns normalized format: `aa:bb:cc:dd:ee:ff` (lowercase with colons)
   - Returns `null` for invalid inputs (wrong length, invalid hex characters, etc.)

2. **Updated Method: `normalizeTV(tv)`**
   - Now calls `normalizeMacAddress()` if MAC field is present
   - Normalizes MAC on every TV load/save operation

3. **Updated Method: `addTV(name, ip, home, mac)` - MAC NOW REQUIRED**
   - **MAC parameter is required** (no default)
   - Throws error if MAC is null, undefined, or empty string
   - Improved ID generation to use timestamp + random suffix (prevents collision in rapid adds)

4. **Updated Method: `updateTV(tvId, name, ip, home, mac)` - MAC NOW REQUIRED**
   - **MAC parameter is required** (no default)
   - Throws error if MAC is null, undefined, or empty string
   - Allows updating TV's MAC address

5. **Updated Method: `getAllTVs()` - Auto-migration**
   - Automatically detects TVs without MAC addresses
   - Assigns dummy MAC `aa:bb:cc:dd:ee:ff` to legacy TVs
   - Persists the migration automatically

### API Routes
**File:** `frame_art_manager/app/routes/tvs.js`

1. **POST `/tvs`** - Create new TV
   - **Validates MAC is present** - returns 400 error if missing
   - Passes MAC to `MetadataHelper.addTV()`

2. **PUT `/tvs/:tvId`** - Update TV
   - **Validates MAC is present** - returns 400 error if missing
   - Passes MAC to `MetadataHelper.updateTV()`

### Frontend UI
**File:** `frame_art_manager/app/public/index.html`

1. **Settings Form** (line ~183)
   - Added MAC input field: `<input type="text" id="tv-mac" required />`
   - Placeholder: "MAC Address (e.g., AA:BB:CC:DD:EE:FF)"
   - **Field is required** - form won't submit without it
   - Positioned after IP field

2. **TV Modal** (line ~573)
   - Added MAC input field: `<input type="text" id="tv-modal-mac" required />`
   - Placeholder: "AA:BB:CC:DD:EE:FF"
   - **Field is required** - form won't submit without it
   - Positioned after IP field

### Frontend JavaScript
**File:** `frame_art_manager/app/public/js/app.js`

1. **New Helper: `isValidIPAddress(ip)`**
   - Validates IPv4 addresses
   - Checks format (4 octets separated by dots)
   - Validates each octet is 0-255
   - Returns `true` if valid, `false` otherwise

2. **New Helper: `isValidMacAddress(mac)`**
   - Validates MAC address format
   - Accepts any separator (colons, dashes, dots, spaces, none)
   - Checks for exactly 12 valid hex characters
   - Returns `true` if valid, `false` otherwise

3. **Updated: `renderTVList()`**
   - Displays MAC address next to IP: `${tv.ip} • ${macText}`
   - Defaults to `aa:bb:cc:dd:ee:ff` if somehow missing (should never happen)

4. **Updated: `initTVForm()`**
   - **Validates name is non-blank** before submission
   - **Validates IP address format** before submission
   - **Validates MAC address format** before submission
   - Shows specific error messages for each validation failure
   - Trims whitespace from all fields
   - Shows API error messages to user

5. **Updated: `openTVModal(tvId)`**
   - Populates `tv-modal-mac` input with existing MAC value
   - Defaults to `aa:bb:cc:dd:ee:ff` if missing (for legacy TVs)

6. **Updated: `saveTVModal()`**
   - **Validates name is non-blank** before saving
   - **Validates IP address format** before saving
   - **Validates MAC address format** before saving
   - Shows specific error messages for each validation failure
   - Shows API error messages to user

### Tests
**File:** `frame_art_manager/app/tests/metadata-helper.test.js`

Updated and added comprehensive test coverage:

1. **UNIT: normalizeMacAddress handles various formats**
   - Tests standard formats (colons, dashes, no separators)
   - Tests mixed separators
   - Tests invalid inputs (empty, null, wrong length, invalid hex)

2. **INTEGRATION: addTV stores MAC address correctly**
   - Verifies MAC is normalized and persisted
   - Always provides MAC in test

3. **INTEGRATION: updateTV updates MAC address**
   - Verifies MAC can be changed and is normalized
   - Always provides MAC in test

4. **INTEGRATION: addTV handles null or empty MAC**
   - Verifies error is thrown when MAC is null
   - Verifies error is thrown when MAC is empty string

5. **INTEGRATION: getAllTVs migrates TVs without MAC addresses**
   - Creates a TV without MAC directly in metadata file
   - Verifies `getAllTVs()` adds dummy MAC `aa:bb:cc:dd:ee:ff`
   - Verifies migration is persisted to disk

All 21 tests pass successfully.

## Migration for Existing TVs

Any existing TVs in `metadata.json` without MAC addresses will be **automatically migrated** when:
- `getAllTVs()` is called (happens on app startup and when viewing TV list)
- A dummy MAC address `aa:bb:cc:dd:ee:ff` is assigned
- The change is automatically persisted to `metadata.json`

**Users should update these dummy MACs to real values through the UI.**

## Usage Examples

### Adding a TV with MAC (Required)
```javascript
// Via API
POST /api/tvs
{
  "name": "Living Room TV",
  "ip": "192.168.1.100",
  "mac": "AA:BB:CC:DD:EE:FF",  // REQUIRED
  "home": "Madrone"
}

// Via MetadataHelper
await helper.addTV('Living Room TV', '192.168.1.100', 'Madrone', 'AA:BB:CC:DD:EE:FF');

// Missing MAC returns 400 error
POST /api/tvs
{
  "name": "Living Room TV",
  "ip": "192.168.1.100"
  // Error: MAC address is required
}
```

### Updating a TV's MAC (Required)
```javascript
// Via API
PUT /api/tvs/12345
{
  "name": "Living Room TV",
  "ip": "192.168.1.100",
  "mac": "FF:EE:DD:CC:BB:AA",  // REQUIRED
  "home": "Madrone"
}

// Via MetadataHelper
await helper.updateTV('12345', 'Living Room TV', '192.168.1.100', 'Madrone', 'FF:EE:DD:CC:BB:AA');
```

## Validation Rules

- **MAC is required** - cannot be null, undefined, or empty string
- Must contain exactly 12 valid hexadecimal characters (after stripping separators)
- Invalid MAC addresses are rejected with error message
- Format is automatically normalized to lowercase with colons

## Error Messages

- Backend: "MAC address is required" (thrown by MetadataHelper)
- API: Returns 400 status with error JSON
- Frontend: 
  - "Please enter a TV name" (blank name)
  - "Please enter a valid IP address" (invalid IP format)
  - "Invalid MAC address format. Please enter a valid MAC address (12 hex characters)" (invalid MAC)

## Testing

### Backend Tests
**File:** `frame_art_manager/app/tests/metadata-helper.test.js`

Tests MAC address normalization and storage:
- Various MAC formats (colons, dashes, dots, spaces, no separator)
- MAC storage and retrieval
- Required MAC validation
- Migration of legacy TVs without MACs

**Run:**
```bash
npm run test:metadata
```

### Validation Tests  
**File:** `frame_art_manager/app/tests/validation.test.js`

Tests client-side validation functions:
- **IP address validation** (15 tests)
  - Valid IPv4 formats
  - Invalid formats (octets > 255, wrong number of octets, non-numeric)
  - Edge cases (empty, null, undefined, wrong type)
- **MAC address validation** (19 tests)
  - Valid MAC formats (colons, dashes, dots, spaces, no separator)
  - Invalid formats (too short, too long, non-hex characters)
  - Edge cases (empty, null, undefined, wrong type)

**Run:**
```bash
npm run test:validation
```

**Example output:**
```
✅ All IP address validation tests passed!
✅ All MAC address validation tests passed!
✅ All validation tests passed!
```
