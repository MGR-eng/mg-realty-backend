const CACHE = 'mg-realty-v9';
const STATIC = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/mg-logo.jpg', '/manifest.json'];

// Always fetch these fresh
const HTML_PATTERNS = ['/', '/crm', '/contact', '/privacy', '/terms', '/portal', '/home-value'];

// Never cache API calls
const API_PATTERNS = ['/calendar/', '/gmail/', '/drive/', '/email/', '/sms', '/backup', '/sequences/', '/leads/', '/market-report'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  const path = new URL(url).pathname;

  // Always pass through API calls
  if (API_PATTERNS.some(p => url.includes(p))) return;

  // Always fetch HTML fresh — never serve from cache
  if (e.request.mode === 'navigate' || HTML_PATTERNS.includes(path) || path.endsWith('.html')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      });
    })
  );
});
