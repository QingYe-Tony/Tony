const CACHE = 'pos-cache-v20';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './sw.js', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './server.py'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDoc(req) {
  if (req.mode === 'navigate') return true;
  try {
    const p = new URL(req.url).pathname;
    return p.endsWith('/') || p.endsWith('index.html');
  } catch (err) { return false; }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // 页面文档：网络优先，保证更新及时；离线时回退缓存
  if (isDoc(e.request)) {
    e.respondWith(
      fetch(e.request).then((resp) => {
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp)).catch(() => {});
        return resp;
      }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp)).catch(() => {});
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
