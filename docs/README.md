# Frame Art Manager# Documentation Index



> Web interface for managing Samsung Frame TV artwork in Home AssistantThis folder contains comprehensive documentation for the Frame Art Manager project. Everything you need to understand what's built and continue development is documented here.



## Quick Start## 🎯 Quick Start Guide



```bash### New to the Project?

# 1. Clone and setup```

cd frame_art_manager/app1. Read STATUS.md → Understand what's built and what's left

export FRAME_ART_PATH="~/devprojects/ha-config/www/frame_art"2. Read QUICK_REFERENCE.md → Get set up and start coding  

npm install3. Reference API.md → Look up endpoints while working

4. Reference ARCHITECTURE.md → Understand how things fit together

# 2. Run tests```

npm test              # 40 tests, ~15 seconds

### Continuing Development?

# 3. Start server```

npm start            # Runs tests first, then starts server1. Check STATUS.md → See pending features

npm run dev          # Skip tests for faster iteration2. Read relevant feature docs → Understand existing implementations

```3. Use QUICK_REFERENCE.md → Find common patterns to follow

4. Update docs as you go → Keep STATUS.md current

Visit: http://localhost:8099```



---### Understanding a Specific Feature?

```

## What's This?1. Check this README → Find the right document

2. Read the feature doc → Understand implementation

Frame Art Manager helps you organize artwork for Samsung Frame TVs integrated with Home Assistant.3. Look at code examples → See how it's done

```

**Core Features:**

- Upload & organize images with tags---

- Configure TVs with tag-based filtering  

- Bulk operations (tag multiple images)## 📋 Core Documentation

- Search, filter, and sort

- Rename images (preserves UUID)### ⭐ Start Here

- Auto thumbnail generation

- Git LFS sync (auto-pull)**[STATUS.md](STATUS.md)** - Current implementation status

- ✅ Completed features (all core functionality)

---- 📋 Pending work (Git LFS, AppDaemon, containerization)

- 📊 Project statistics and metrics

## Project Status- 🎯 Next milestones and roadmap



✅ **Phase 2 Complete** - Web interface fully functional with automated testing**[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Developer quick reference

- Setup instructions (export FRAME_ART_PATH, npm install)

### Completed- Project structure overview

- Image management (upload, tag, rename, delete)- Common tasks and patterns

- TV configuration with tag filtering- API endpoint cheatsheet

- Bulk operations and multi-select- CSS classes reference

- Search, filter, sort functionality- Debugging tips and workflows

- Git LFS auto-pull (startup + page load)

- 40 automated tests (100% passing)### 📚 Technical Documentation

- Professional UI with modals

**[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture

### In Progress  - Technology stack (Node.js, Express, sharp, vanilla JS)

- Manual Git sync UI (pull/push buttons)- MVC-like pattern (server, routes, helpers, views)

- Sync status indicators- Component descriptions and responsibilities

- Data flow diagrams

### Pending- File system structure

- AppDaemon integration (display images on TVs)- Security and performance considerations

- Docker containerization

- Home Assistant add-on packaging**[API.md](API.md)** - Complete REST API reference

- HACS distribution- All 18 endpoints with examples

- Request/response formats

---- Data models (Image, TV, Tag)

- Error responses (400, 404, 409, 500)

## Documentation- UUID system explanation

- Static file serving

- **README.md** (this file) - Overview and quick start

- **[STATUS.md](STATUS.md)** - Detailed progress checklist and roadmap### 🎨 Feature Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Setup, API, architecture, testing

- **[FEATURES.md](FEATURES.md)** - UI guide and user workflows**[UI_FEATURES.md](UI_FEATURES.md)** - User interface guide

- Tab-by-tab feature descriptions (Gallery, Upload, TVs, Tags, Sync, Advanced)

---- Toolbar and controls (search, filter, sort)

- Modal systems (image detail, TV detail, bulk tag)

## Key Concepts- Interaction patterns (click-outside, hover effects)

- Design principles (clean, compact, responsive)

### UUID System- State management (allImages, allTags, allTVs, selectedImages)

Images get unique 8-char suffixes to prevent conflicts:

```**[RENAME_FEATURE.md](RENAME_FEATURE.md)** - Image rename functionality

photo.jpg → photo-a1b2c3d4.jpg- UI flow (pencil icon → inline form)

```- Backend implementation (UUID preservation)

- Sanitization rules (lowercase, alphanumeric + hyphens)

### Tag Filtering- File operations (library + thumbnails + metadata)

TVs can be assigned tags to control what displays:- Error handling and validation

```javascript

{**[TV_TAG_FILTERING.md](TV_TAG_FILTERING.md)** - TV tag assignment

  "name": "Living Room TV",- Tag selection per TV (multi-select dropdown)

  "tags": ["landscape", "nature"]  // Only shows tagged images- Display logic (empty = all images, tags = filter)

}- Backend data structure

```- AppDaemon integration notes

- Future enhancements (AND logic, exclude tags)

### Git LFS Integration

- Auto-pulls on server startup (if enabled)**[TV_DETAIL_MODAL.md](TV_DETAIL_MODAL.md)** - TV modal implementation

- Auto-pulls on page load (if behind)- Modal pattern (click row → detail view)

- Skips pull if uncommitted changes exist- Editable fields (name, IP, tags)

- Action buttons (Save, Delete, Cancel)

---- Benefits (cleaner UI, better UX)



## Testing### 📖 Legacy Documentation



```bash**[START.md](START.md)** - Original getting started guide

npm test                # All 40 tests (~15 seconds)- Basic setup instructions

npm run test:git        # Git sync (15 tests)- Environment variables

npm run test:metadata   # Metadata CRUD (16 tests)  - Development vs production

npm run test:coordination # File operations (9 tests)

```**[THUMBNAILS.md](THUMBNAILS.md)** - Thumbnail system

- Auto-generation on upload (400x300px)

All tests run in isolated `/tmp` directories - never touches production data.- sharp library usage

- Naming convention (matches original)

---

**[UPLOAD_NAMING.md](UPLOAD_NAMING.md)** - UUID naming system

## Technology- Filename format (basename-uuid.ext)

- 8-character hex UUID

- **Backend**: Node.js + Express- Sanitization process

- **Frontend**: Vanilla HTML/CSS/JS

- **Storage**: JSON file + filesystem**[MULTI_SELECT.md](MULTI_SELECT.md)** - Bulk selection

- **Image Processing**: Sharp- Selection methods (click checkbox)

- **Git**: simple-git for LFS- Visual feedback (selected state)

- Bulk operations interface

---

### 🔧 Project Management

## Stats

**[../DEVELOPMENT.md](../DEVELOPMENT.md)** - Overall development plan

- **Code**: ~4,000 lines (backend + frontend + tests)- Phase 2 implementation (current)

- **Tests**: 40 tests, 100% passing- Repository structure

- **API**: 20 REST endpoints- Implementation steps (Step 3: ✅ Complete)

- **Docs**: 4 files, comprehensive coverage- Next steps (containerization, HACS)



------



**For detailed information, see:**## 📊 What's Documented

- Setup & API → [DEVELOPMENT.md](DEVELOPMENT.md)

- Features & UI → [FEATURES.md](FEATURES.md)  ### ✅ Complete Feature Coverage

- Progress & roadmap → [STATUS.md](STATUS.md)

**Image Management**
- Upload with drag & drop → API.md, UI_FEATURES.md
- Rename with UUID preservation → RENAME_FEATURE.md
- Metadata editing (matte, filter, tags) → API.md, UI_FEATURES.md
- Bulk tagging → UI_FEATURES.md, MULTI_SELECT.md
- Search and filter → UI_FEATURES.md
- Delete with confirmation → API.md, UI_FEATURES.md

**TV Management**
- Detail modal → TV_DETAIL_MODAL.md
- Tag filtering → TV_TAG_FILTERING.md
- Read-only list view → UI_FEATURES.md
- Add/edit/delete → API.md

**Tag System**
- Tag library management → API.md, UI_FEATURES.md
- Multi-select filtering → UI_FEATURES.md
- Tag cloud display → UI_FEATURES.md

**Technical Implementation**
- UUID suffix system → UPLOAD_NAMING.md, RENAME_FEATURE.md
- Thumbnail generation → THUMBNAILS.md, ARCHITECTURE.md
- Metadata persistence → ARCHITECTURE.md
- State management → ARCHITECTURE.md, UI_FEATURES.md

### 📈 Documentation Statistics

**Coverage**
- API: 100% (18/18 endpoints documented)
- UI Features: 100% (all 6 tabs documented)
- Backend: 100% (20+ helper methods documented)
- Frontend: 100% (all major functions documented)

**Size**
- ~70 pages total documentation
- 60+ code examples and snippets
- 12 documentation files
- 8 comprehensive new docs + 4 legacy docs

**Organization**
- Logical structure (STATUS → QUICK_REFERENCE → details)
- Cross-referenced (documents link to each other)
- Indexed (this README provides navigation)
- Searchable (clear headers and sections)

---

## � Key Documentation Features

### Code Examples Throughout
- API request/response examples (fetch calls, JSON bodies)
- JavaScript patterns (modal management, state updates)
- CSS class usage (modals, buttons, layouts)
- Common workflows (upload → thumbnail → metadata)

### Implementation Details
- How UUID system works (crypto.randomBytes)
- How thumbnails are generated (sharp library)
- How modals are implemented (click handlers, close events)
- How state is managed (global variables, updates)

### Future Planning
- Pending features clearly listed
- Enhancement ideas documented
- Integration points described (AppDaemon, Git LFS)
- Architecture improvements outlined

### Maintenance Guidelines
- How to update docs when adding features
- Which docs to update for which changes
- Documentation style guide
- Cross-referencing standards

---

## 🔄 Documentation Maintenance

### When You Build New Features

1. **Update [STATUS.md](STATUS.md)**
   - Mark items complete ✅
   - Update statistics (endpoints, features)
   - Add to "Recent Changes" section

2. **Update [QUICK_REFERENCE.md](QUICK_REFERENCE.md)**
   - Add new API endpoints to cheatsheet
   - Add new functions/patterns
   - Update common tasks section

3. **Create Feature Doc (if substantial)**
   - Follow existing template pattern
   - Include: Overview, Usage, Implementation, Future
   - Add to this README index

4. **Update [API.md](API.md)**
   - Document new endpoints with examples
   - Add request/response formats
   - Update data models if changed

5. **Update [ARCHITECTURE.md](ARCHITECTURE.md)**
   - If design patterns change
   - If new components added
   - If data flow changes significantly

---

## 🎨 Documentation Style

### Consistent Format
- **Markdown** with clear headers (H1, H2, H3)
- **Code blocks** with syntax highlighting (```javascript, ```json)
- **Tables** for structured data
- **Emoji** for visual organization 🎯
- **Examples** for clarity

### Clear Structure
- **Overview** at the top (what is this?)
- **Sections** with clear purposes (how does it work?)
- **Examples** embedded (show me!)
- **Future considerations** at the end (what's next?)
- **Cross-references** between docs (see also...)

### Practical Focus
- "How to" orientation (actionable)
- Real code examples (copy-paste ready)
- Common patterns documented (reusable)
- Debugging tips included (troubleshooting)

---

## 🚀 Current Project Status

### ✅ Completed (100%)
- Web interface (6 tabs, all features)
- REST API (18 endpoints)
- Metadata helper (20+ methods)
- File operations (upload, rename, delete)
- Image management (gallery, detail, bulk)
- TV management (list, modal, tag filtering)
- Tag system (library, filtering, bulk operations)
- Search and sort (multi-tag, direction toggle)
- Professional UI (compact toolbar, modals, responsive)

### � Pending
- Git LFS sync interface
- AppDaemon service integration
- Containerization (Dockerfile, config.yaml)
- HACS distribution

### 📊 Stats
- **Backend**: ~500 lines (helpers + routes)
- **Frontend JS**: ~1,100 lines
- **Frontend CSS**: ~1,200 lines
- **Frontend HTML**: ~320 lines
- **Documentation**: ~70 pages

---

## 📞 Quick Reference

### Questions? Start Here:
- **"What's done?"** → [STATUS.md](STATUS.md)
- **"How do I...?"** → [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
- **"How does X work?"** → [ARCHITECTURE.md](ARCHITECTURE.md) or specific feature doc
- **"What's the API?"** → [API.md](API.md)
- **"Where do I start?"** → You're here! (README.md)

### Working On:
- **UI features** → [UI_FEATURES.md](UI_FEATURES.md)
- **Backend/API** → [API.md](API.md) + [ARCHITECTURE.md](ARCHITECTURE.md)
- **File operations** → [RENAME_FEATURE.md](RENAME_FEATURE.md)
- **TV features** → [TV_TAG_FILTERING.md](TV_TAG_FILTERING.md), [TV_DETAIL_MODAL.md](TV_DETAIL_MODAL.md)

---

## ✅ You're All Set!

**Everything is documented:**
- ✅ Complete project status
- ✅ Developer quick reference
- ✅ System architecture explained
- ✅ Full API documentation
- ✅ UI features documented
- ✅ Feature implementations detailed
- ✅ Code patterns and examples
- ✅ Future planning outlined

**You can pick this up anytime and know exactly where things stand!** 🎉

**The documentation has your back!** 📚

---

**Last Updated**: October 14, 2025  
**Total Documentation**: 12 files, ~70 pages, 60+ examples  
**Coverage**: 100% of implemented features

**Happy coding! 🚀**
