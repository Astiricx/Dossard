// Types du relais, pour que les tests TypeScript puissent l'importer. Le relais lui-même reste en
// JavaScript : c'est ce que l'éditeur du tableau de bord Cloudflare attend par défaut.
declare const worker: { fetch(request: Request): Promise<Response> };
export default worker;
