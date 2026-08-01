/* 离线缓存：让工作台断网也能打开（数据本来就在本机） */
const CACHE = 'mao-villain-v15'; // v47.2: 「我的」页按钮全卡急救——init 加 try/catch + 错误吐屏、autoSync 延后 3s（不抢 UI）、lostCopyBar 200ms 立即弹（不等 1.5s）+ 加🔄重载按钮、全局 unhandled error 兜底提示
const SHELL = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isStatic = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|css)$/.test(url.pathname) || url.pathname.endsWith('manifest.json');
  if (isStatic) {
    // 静态资源：network-first + 缓存（离线也能用）
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  } else {
    // 应用代码（app.js / index.html 等）：永远拉网络最新版，不缓存，避免旧版本按钮事件丢失
    e.respondWith(fetch(e.request));
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('./');
  }));
});
