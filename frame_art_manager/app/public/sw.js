// Minimal service worker: required for installability, deliberately NOT a cache
// layer. The gallery is inherently network-first (library changes centrally and
// images are large), and a stale-serving SW would show art that no longer
// exists. Mirrors the finbox pattern: present, minimal, no offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
