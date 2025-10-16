# Image Rename - Historical Implementation

**Date:** October 16, 2025  
**Status:** ⚠️ Superseded by Git MV implementation  
**See:** [DEVELOPMENT.md](DEVELOPMENT.md) for current implementation

## Note

This document describes a copy-delete pattern that was briefly considered but replaced with a simpler `git mv` approach. The copy-delete pattern had unnecessary complexity and didn't properly integrate with Git's rename detection.

## Current Implementation

The current implementation simply uses `git mv`:

```javascript
await git.git.mv('library/oldname.jpg', 'library/newname.jpg');
await git.git.mv('thumbs/thumb_oldname.jpg', 'thumbs/thumb_newname.jpg');
await helper.renameImage('oldname.jpg', 'newname.jpg');
await git.git.add('metadata.json');
```

This is simpler, more reliable, and Git recognizes it as a rename (shows as "R" status), so the sync badge correctly shows 1 change instead of 2.

---

For complete documentation, see [DEVELOPMENT.md](DEVELOPMENT.md).
