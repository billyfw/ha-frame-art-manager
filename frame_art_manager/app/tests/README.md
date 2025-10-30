# Test Suite

This folder contains automated tests for the Frame Art Manager application.

## Test Files

### semantic-sync.test.js
Tests semantic sync status parsing that filters thumbnails and metadata for user-friendly counts.

**Coverage:**
- **Unit tests:** `parseImageChanges()` parsing logic with mock data
- **Integration tests:** Real Git operations in temporary repo
- Image change parsing (filters thumbnails, metadata.json)
- Distinguishing new vs updated images
- Upload/download count calculation (local + remote)
- Remote commit detection (goes back commits, verifies download counts)
- Local file operations (create, modify images)
- Full upload flow: image + thumbnail + metadata → 1 semantic count
- Multiple images counted separately
- Semantic status structure validation

**Test breakdown:**
- 5 unit tests for parsing logic
- 7 integration tests with real Git repo
- 4 structure/validation tests
- 6 remote change scenario tests

**Run individually:**
```bash
npm run test:semantic
```

**Example output:**
```
✓ Thumbnails are filtered out correctly
✓ INTEGRATION: Local uncommitted new image detected
  Upload: 1 new, 0 updated
✓ INTEGRATION: Full upload flow correctly parsed: 3 raw files → 1 semantic image
📊 Passed: 22, Total: 22
```

### git-sync.test.js
Tests Git/LFS sync functionality using an isolated test repository.

**Coverage:**
- Git configuration verification
- Repository status checking
- Pull operations (behind by 1 commit, 2 commits, etc.)
- Uncommitted changes detection
- Working tree updates
- Idempotency (integration test only)

**Test breakdown:**
- 6 structural/validation tests (instantiation, configuration, status)
- 6 integration tests with real Git operations in temporary repo

**Run individually:**
```bash
npm run test:git
```

### metadata-helper.test.js
Tests core metadata operations that handle file I/O and JSON parsing.

**Coverage:**
- Metadata CRUD operations (create, read, update, delete)
- Image metadata management
- TV management (add, update, delete, tag filtering)
- Tag operations
- Data persistence across instances
- Error handling (corrupt JSON)

**Run individually:**
```bash
npm run test:metadata
```

### file-coordination.test.js
Tests coordination logic for operations that affect multiple resources (file + thumbnail + metadata).

**Coverage:**
- Rename coordination (file, thumbnail, metadata all renamed together)
- Delete coordination (file, thumbnail, metadata all deleted together)
- Upload coordination (file, thumbnail, metadata all created together)
- Missing thumbnail handling (graceful degradation)
- Rollback scenarios (when operations fail partway)
- Filename sanitization (special characters, spaces, etc.)

**Run individually:**
```bash
npm run test:coordination
```

### validation.test.js
Tests client-side validation functions for IP addresses and MAC addresses.

**Coverage:**
- IP address validation (IPv4 format, octet ranges)
- MAC address validation (12 hex characters, various separators)
- Edge cases (empty strings, null, undefined, wrong types)
- Invalid formats detection

**Test breakdown:**
- 15 IP address validation tests
- 19 MAC address validation tests

**Run individually:**
```bash
npm run test:validation
```

**Example output:**
```
✓ Valid IP: 192.168.1.1
✓ Invalid IP: 256.1.1.1
✓ Valid MAC: AA:BB:CC:DD:EE:FF
✓ Valid MAC: AABBCCDDEEFF
✓ Invalid MAC: AA:BB:CC (too short)
```

## Running Tests

**Run all tests:**
```bash
npm test
```

**Run individual test suites:**
```bash
npm run test:semantic     # Semantic sync tests only
npm run test:git          # Git sync tests only
npm run test:metadata     # Metadata helper tests only
npm run test:coordination # File coordination tests only
npm run test:validation   # Validation tests only
```

**Verbose output:**
```bash
npm run test:verbose
```

## Test Framework

We use a **minimal, zero-dependency test framework** built on Node.js's built-in `assert` module:
- ✅ No external test runners (Jest, Mocha, etc.)
- ✅ Fast execution (~5-10 seconds for full suite)
- ✅ CI/CD friendly (exit code 0 on success, 1 on failure)
- ✅ Color-coded output for readability

## Test Types

### Unit Tests
- Test individual functions and methods in isolation
- Fast execution (< 1 second)
- Validate structure, types, and return values

### Integration Tests
- Test complete workflows with real operations
- Use isolated test environments in `/tmp`
- Validate actual behavior (file operations, Git pulls, metadata persistence)
- Automatic cleanup after tests

## Test Isolation

**Git Sync Tests:**
- Clone test repository to `/tmp/frame-art-test-{timestamp}`
- Shallow clone (`--depth 5`) for speed
- Never touches production data
- Automatic cleanup

**Metadata Helper Tests:**
- Create isolated test directory in `/tmp/frame-art-metadata-test-{timestamp}`
- Creates fresh `metadata.json` for each test run
- Never touches production data
- Automatic cleanup

**File Coordination Tests:**
- Create isolated test directory in `/tmp/frame-art-coord-test-{timestamp}`
- Creates dummy image files (1x1 PNG) for testing
- Tests file system operations without real images
- Never touches production data
- Automatic cleanup

## CI/CD Integration

Tests are designed to run in GitHub Actions:

```yaml
- name: Run tests
  run: |
    cd frame_art_manager/app
    npm install
    npm test
```

**Requirements:**
- Node.js 18+
- Git and Git LFS installed
- SSH keys configured for test repository access (Git tests)

## Writing New Tests

### Pattern

```javascript
const assert = require('assert');

test('descriptive test name', async () => {
  // Arrange
  const input = 'test data';
  
  // Act
  const result = await functionUnderTest(input);
  
  // Assert
  assert.strictEqual(result, expectedValue);
});
```

### Guidelines

1. **Unit tests** should be fast and non-destructive
2. **Integration tests** should use isolated test environments
3. **Test names** should clearly describe what is being tested
4. **Assertions** should match exact expected values
5. **Cleanup** should be guaranteed with try-finally blocks
6. **Prefix integration tests** with "INTEGRATION:" for clarity

## Test Coverage

### ✅ Tested
- **Semantic sync status parsing (23 tests)**
  - Unit tests: Parsing logic, filtering, categorization
  - Integration tests: Real Git operations, file creation, remote detection
- **Git sync functionality (27 tests)**
  - Structural tests: Configuration, status, return types
  - Integration tests: Pull operations, idempotency, working tree updates
- **Metadata CRUD operations (21 tests)**
  - Includes MAC address normalization and TV management
- **File coordination (rename, delete, upload) (12 tests)**
- **Image editing operations (7 tests)**
- **Upload validation (2 tests)**
- **Commit message generation (37 tests)**
- **Input validation functions (34 tests)**
  - IP address validation (15 tests)
  - MAC address validation (19 tests)
- Image management workflows
- TV management workflows
- Tag operations
- Data persistence
- Error handling
- Rollback scenarios
- Filename sanitization

**Total: 129 automated tests**

### ⏳ Future Testing
- API endpoint responses (supertest)
- Image upload/processing (multer, sharp)
- File operations (rename, delete with actual files)
- E2E UI workflows (Playwright)
- Performance benchmarks

## Troubleshooting

**Git tests failing?**
- Check SSH keys are configured (`ssh -T git@github.com`)
- Verify access to test repository
- Check Git and Git LFS are installed

**Metadata tests failing?**
- Check `/tmp` directory is writable
- Verify Node.js has file system permissions
- Check for disk space

**All tests timing out?**
- Check network connectivity (Git tests clone repo)
- Verify firewall settings
- Check for slow disk I/O

