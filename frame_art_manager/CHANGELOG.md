# Changelog

All notable changes to this project will be documented in this file.

## [1.7.2] - 2025-12-23

### Added
- **Recently Displayed Filter**: New filter in the tag dropdown showing images currently on TVs and previously displayed
  - Shows "Now" for current images, "Xm ago", "Xh ago", "Xd ago" for previous
  - Queries Home Assistant sensors for current artwork
  - Reads shuffler logs for previous display history
  - Overlay shows TV name and time (e.g., "officeframe (11m ago)")
  - Sorts gallery by most recent first when active
  - Hides redundant last-display info in card footer when filter is active

### Changed
- **Tag Dropdown Reorganization**: Filters section now at top, followed by TVs, then Tags
- **Similar Images Count Format**: Now shows "(Xdup/Ysim)" format with accurate counts
- **Similar Images Filter**: Fixed count calculation to use <= threshold comparison instead of exact match

### Fixed
- Fixed NaN time display bug in Recently Displayed filter (function name collision)
- Fixed Similar Images showing 0dup/0sim when there were actually similar images

## [1.7.1] - 2025-12-23

### Fixed
- Debugging release for Recently Displayed NaN issue

## [1.7.0] - 2025-12-23

### Added
- Recently Displayed filter (initial implementation)
- Image counts shown in tag filter dropdown for all options

## [1.6.2] - 2025-12-22

### Changed
- Similar Images filter now shows duplicate/similar counts in dropdown

## [1.6.1] - 2025-12-22

### Changed
- Reorganized tag dropdown layout

## [1.6.0] - 2025-12-22

### Added
- Similar Images filter with adjustable threshold slider
- Non 16:9 aspect ratio filter

## [0.2.0] - 2025-10-18

### Added
- Complete Home Assistant add-on packaging
- Dockerfile for multi-architecture support
- Ingress support for seamless HA integration
- Comprehensive user documentation (README.md, DOCS.md)
- Git LFS sync button with status indicators
- Automated testing suite (40 tests, 100% passing)

### Changed
- Improved sync UI with visual status feedback
- Enhanced error handling for Git operations
- Optimized file coordination between operations

### Fixed
- Auto-sync behavior on page load
- Uncommitted changes detection
- Thumbnail generation edge cases

## [0.1.0] - 2025-10-15

### Added
- Complete web interface (Gallery, Upload, TVs, Tags, Advanced tabs)
- REST API with 18 endpoints
- Image management (upload, rename, delete, bulk tagging)
- TV management with tag-based filtering
- Tag library management
- Git LFS integration with auto-pull on startup
- Metadata persistence (JSON)
- Automatic thumbnail generation
- Professional responsive UI
- Image detail modal with full editing
- TV detail modal with tag filtering
- Bulk tagging interface

### Technical
- Node.js + Express backend
- Sharp for image processing
- Multer for file uploads
- Simple-git for Git operations
- Vanilla JavaScript frontend
- No database dependency (JSON storage)

## [0.0.1] - 2025-10-01

### Added
- Initial project structure
- Basic image upload functionality
- Metadata helper module
- Development environment setup
