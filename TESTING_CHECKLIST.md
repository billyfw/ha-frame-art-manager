# Add-on Installation Testing Checklist

Use this checklist to verify the add-on works correctly in Home Assistant.

## Pre-Installation

- [ ] All required files are present in `frame_art_manager/` directory
  - [ ] `config.yaml`
  - [ ] `Dockerfile`
  - [ ] `build.yaml`
  - [ ] `run.sh`
  - [ ] `README.md`
  - [ ] `DOCS.md`
  - [ ] `CHANGELOG.md`
  - [ ] `app/` directory with all source files

## Installation

- [ ] Add-on appears in Local Add-ons section
- [ ] Installation completes without errors
- [ ] Build log shows successful compilation
- [ ] All npm packages install correctly
- [ ] Git and Git LFS are available in container

## Configuration

- [ ] Configuration tab loads
- [ ] `frame_art_path` option is editable
- [ ] `port` option is editable
- [ ] Configuration saves successfully
- [ ] Invalid configuration shows errors

## Startup

- [ ] Add-on starts without errors
- [ ] Log shows "Starting Frame Art Manager..."
- [ ] Log shows successful server startup on port 8099
- [ ] Directories are created in `/config/www/frame_art/`
  - [ ] `/config/www/frame_art/library/`
  - [ ] `/config/www/frame_art/thumbs/`
- [ ] Git repository is initialized (if not already)

## Web Interface Access

- [ ] **Open Web UI** button works
- [ ] Ingress URL loads correctly
- [ ] Direct port access works: `http://[ha-ip]:8099`
- [ ] Page loads without JavaScript errors
- [ ] All tabs are visible and clickable

## Functionality Testing

### Upload Tab
- [ ] File input works
- [ ] Drag and drop works
- [ ] Image uploads successfully
- [ ] Thumbnail is generated
- [ ] Metadata is saved
- [ ] Redirect to Gallery works

### Gallery Tab
- [ ] Uploaded images appear
- [ ] Thumbnails load
- [ ] Search works
- [ ] Tag filter works
- [ ] Sort works
- [ ] Image detail modal opens
- [ ] Full-size image loads
- [ ] Rename works
- [ ] Tag editing works
- [ ] Delete works
- [ ] Bulk tagging works

### TVs Tab
- [ ] Add TV works
- [ ] TV list displays
- [ ] TV detail modal opens
- [ ] Edit TV works
- [ ] Tag assignment works
- [ ] Delete TV works

### Tags Tab
- [ ] All tags display
- [ ] Tag count is correct
- [ ] Add tag works
- [ ] Delete tag works
- [ ] Tag removal from images works

### Advanced Tab
- [ ] Library path displays correctly
- [ ] Metadata viewer shows JSON
- [ ] System info is accurate

### Git Sync
- [ ] Sync status displays
- [ ] Manual sync works
- [ ] Pull updates work
- [ ] Conflict detection works
- [ ] Error messages are clear

## Performance

- [ ] Page load is under 1 second
- [ ] Image upload completes quickly
- [ ] Thumbnail generation is fast
- [ ] Search/filter is instant
- [ ] No memory leaks after extended use

## Mobile/Responsive

- [ ] UI works on mobile browser
- [ ] Touch interactions work
- [ ] Modals display correctly
- [ ] File input works on mobile
- [ ] Camera input works (if available)

## Error Handling

- [ ] Invalid file upload shows error
- [ ] Network errors are handled gracefully
- [ ] Missing directories are created
- [ ] Permission errors are reported
- [ ] Git errors are user-friendly

## Integration

- [ ] Sidebar panel appears
- [ ] Panel icon is correct
- [ ] Panel title is correct
- [ ] Ingress works within HA UI
- [ ] No conflicts with other add-ons
- [ ] Port doesn't conflict

## Persistence

- [ ] Metadata persists after restart
- [ ] Images remain after restart
- [ ] TV configurations persist
- [ ] Tags persist
- [ ] Settings persist

## Cleanup

- [ ] Uninstall removes add-on
- [ ] Data directory remains (expected)
- [ ] No leftover processes
- [ ] No port conflicts after removal

## Documentation

- [ ] README.md is clear and complete
- [ ] DOCS.md is helpful
- [ ] CHANGELOG.md is up to date
- [ ] Installation instructions work
- [ ] Configuration examples are accurate

## Known Issues

Document any issues found during testing:

1. 
2. 
3. 

## Notes

Additional observations:


---

## Testing Completed By

- Name:
- Date:
- HA Version:
- Add-on Version:
- Architecture:

## Overall Result

- [ ] **PASS** - Ready for production
- [ ] **PASS with minor issues** - Usable but needs improvements
- [ ] **FAIL** - Critical issues prevent use
