// sw.js — désinstalle le service worker de la v1 de Dossard.
//
// La v1 installait un service worker qui sert le site depuis un cache. Sans ce fichier, un appareil
// qui a ouvert la v1 (ton iPhone, notamment) continuerait à afficher l'ancienne version, puisque son
// navigateur ne trouverait plus de nouveau sw.js à installer. Ce fichier remplace l'ancien : il vide
// les caches, se désinstalle, puis recharge les pages ouvertes, qui chargent alors la v2 depuis le
// réseau. La v2 n'enregistre aucun service worker.
//
// À garder en ligne quelques mois, le temps que chaque appareil passé par la v1 l'ait reçu.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    for (const page of pages) page.navigate(page.url);
  })());
});
