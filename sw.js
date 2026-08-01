/* 离线缓存：让工作台断网也能打开（数据本来就在本机） */
const CACHE = 'mao-villain-v14'; // v47.1: 紧急恢复——文案库被清时一键从云端 cloud-data/copies.json 拉回（管理分类弹层+启动红条双入口），启动时申请 navigator.storage.persist 防再被浏览器自动清
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
