// sw.js — service worker : garde une copie de l'app dans le téléphone pour qu'elle s'ouvre sans réseau.
// Stratégie : on sert tout de suite la copie en cache, et on télécharge la nouvelle version en arrière-plan.
// Conséquence : après une mise à jour du site, la nouveauté apparaît à la DEUXIÈME ouverture de l'app.
// Si tu ajoutes un fichier à l'app, ajoute-le à la liste FICHIERS.
const CACHE = 'dossard-v1';
const FICHIERS = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/calc.js', 'js/ui.js', 'js/charts.js', 'js/seances.js',
  'js/vues/accueil.js', 'js/vues/plan.js', 'js/vues/calendrier.js', 'js/vues/suivi.js', 'js/vues/prepas.js', 'js/vues/reglages.js',
  'icons/icone-192.png', 'icons/icone-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(noms => Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const enCache = await cache.match(e.request, { ignoreSearch: true });
    const reseau = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => enCache);
    return enCache || reseau;
  }));
});
