// worker.js — micro-relais Dossard ↔ Garmin Connect (API « Personal »), pour Cloudflare Workers.
//
// Pourquoi : un navigateur refuse qu'une page web lise une réponse de Garmin, car Garmin n'envoie
// pas d'en-têtes CORS. Ce relais reçoit l'appel de Dossard, le refait côté serveur vers Garmin, et
// renvoie la réponse avec les en-têtes CORS qui manquaient.
//
// Ce qu'il fait, et seulement ça :
//   - il ne relaie que vers https://personal.connectapi.garmin.com, et seulement les trois appels
//     dont Dossard a besoin (échange de la clé, liste des activités, fichier d'une activité) ;
//   - il ne répond qu'aux pages listées dans ALLOWED_ORIGINS ;
//   - il transmet l'en-tête Authorization tel quel, sans jamais l'enregistrer ni l'afficher ;
//   - il ne stocke rien : aucune base, aucun journal applicatif.
//
// Seul réglage : la liste ALLOWED_ORIGINS ci-dessous.

/** Adresses autorisées à utiliser le relais : le site publié, et le serveur de développement Vite. */
const ALLOWED_ORIGINS = [
  'https://astiricx.github.io',
  'http://localhost:5173',
];

const GARMIN = 'https://personal.connectapi.garmin.com';

/** Les seuls appels relayés. Tout le reste reçoit une erreur 404 du relais, sans contacter Garmin. */
const ROUTES = [
  { method: 'POST', path: /^\/personalapitoken-service\/personal-api\/personal-api-key\/token$/ },
  { method: 'GET', path: /^\/activitylist-service\/activities\/search\/activities$/ },
  { method: 'GET', path: /^\/download-service\/files\/activity\/\d{1,20}$/ },
];

/** En-têtes de la réponse de Garmin recopiés vers Dossard. Les autres (cookies…) sont écartés. */
const PASSED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length', 'retry-after'];

/** Marque les réponses produites par le relais lui-même, pour que Dossard les distingue de celles de Garmin. */
const RELAY_HEADER = 'X-Dossard-Relay';

function corsHeaders(origin) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Access-Control-Expose-Headers': `${RELAY_HEADER}, Retry-After, Content-Disposition`,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

/** Réponse émise par le relais (pas par Garmin) : du JSON, marqué par l'en-tête RELAY_HEADER. */
function relayResponse(status, body, origin) {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set(RELAY_HEADER, status < 400 ? 'ok' : 'error');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = origin !== null && ALLOWED_ORIGINS.includes(origin);

    // Pré-vérification CORS (« preflight ») : le navigateur demande s'il peut envoyer l'en-tête
    // Authorization. On répond oui à toute page : la vraie requête, elle, est filtrée ci-dessous,
    // et répondre permet à Dossard de lire le motif d'un refus au lieu d'un échec muet.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    // Racine : permet de vérifier depuis un navigateur que le relais est en ligne.
    if (url.pathname === '/' && request.method === 'GET') {
      return relayResponse(200, { relay: 'dossard', ok: true, originAllowed: allowed }, origin);
    }

    if (!allowed) return relayResponse(403, { relay: 'dossard', error: 'origin_not_allowed', origin }, origin);

    const route = ROUTES.find((r) => r.path.test(url.pathname));
    if (route === undefined) return relayResponse(404, { relay: 'dossard', error: 'route_not_allowed' }, origin);
    if (route.method !== request.method) return relayResponse(405, { relay: 'dossard', error: 'method_not_allowed' }, origin);

    const authorization = request.headers.get('Authorization');
    if (authorization === null) return relayResponse(400, { relay: 'dossard', error: 'missing_authorization' }, origin);

    // Seuls Authorization et Accept partent vers Garmin : ni cookie, ni Origin, ni rien d'autre du navigateur.
    const upstreamHeaders = new Headers({ Authorization: authorization, Accept: request.headers.get('Accept') ?? '*/*' });
    let upstream;
    try {
      upstream = await fetch(`${GARMIN}${url.pathname}${url.search}`, {
        method: route.method,
        headers: upstreamHeaders,
        body: route.method === 'POST' ? await request.arrayBuffer() : undefined,
        redirect: 'follow',
      });
    } catch {
      return relayResponse(502, { relay: 'dossard', error: 'upstream_unreachable' }, origin);
    }

    // Réponse de Garmin transmise telle quelle (statut et contenu, y compris ses erreurs 401 ou 429),
    // avec les en-têtes CORS en plus. Le corps est relayé en flux : un gros fichier ne passe pas en mémoire.
    const headers = corsHeaders(origin);
    for (const name of PASSED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  },
};
