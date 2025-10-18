# Changelog

All notable changes to this project will be documented in this file.

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
