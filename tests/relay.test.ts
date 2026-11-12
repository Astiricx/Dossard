// Le micro-relais Cloudflare (relay/worker.js) et le client Garmin, essayés ensemble : le client
// appelle le relais, qui appelle un faux Garmin. Aucun réseau réel.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../relay/worker.js';
import { checkRelay, cleanRelayUrl, fetchRecentGarminFiles, GARMIN_API, garminFailureText, RELAY_HEADER } from '../src/features/import/garmin/client.ts';

const RELAY = 'https://dossard-relais.exemple.workers.dev';
const SITE = 'https://astiricx.github.io';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Ce que Garmin a reçu, appel par appel. */
let received: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
/** Faux Garmin, installé là où le relais l'appelle : le fetch global du Worker. */
function fakeGarmin(respond: (url: URL, init: RequestInit) => Response | Promise<Response>): void {
  received = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    received.push({ url: url.href, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), body: init.body ? new TextDecoder().decode(init.body as ArrayBuffer) : '' });
    return respond(url, init);
  }) as typeof fetch;
}
/** Requête telle qu'un navigateur l'envoie depuis `origin` : il ajoute l'en-tête Origin, et un cookie s'il en a. */
const browserRequest = (path: string, init: RequestInit = {}, origin = SITE): Request =>
  new Request(`${RELAY}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: origin, Cookie: 'session=secret' } });
/** fetch côté application : chaque appel passe par le Worker, comme dans le navigateur. */
const viaRelay = (origin = SITE): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  return worker.fetch(browserRequest(`${url.pathname}${url.search}`, init ?? {}, origin));
}) as typeof fetch;

test('relais : pré-vérification CORS, racine de contrôle, et en-têtes CORS sur chaque réponse', async () => {
  const preflight = await worker.fetch(browserRequest(GARMIN_API.tokenPath, { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') ?? '', /Authorization/);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods') ?? '', /POST/);

  const root = await worker.fetch(browserRequest('/'));
  assert.deepEqual(await root.json(), { relay: 'dossard', ok: true, originAllowed: true });
  assert.equal(root.headers.get(RELAY_HEADER), 'ok');
  const foreign = await worker.fetch(browserRequest('/', {}, 'https://site-inconnu.example'));
  assert.deepEqual(await foreign.json(), { relay: 'dossard', ok: true, originAllowed: false });
});

test('relais : ne transmet que l’en-tête Authorization, et rend la réponse de Garmin telle quelle', async () => {
  fakeGarmin((url) => (url.pathname === GARMIN_API.tokenPath
    ? new Response('jeton.24h', { status: 200, headers: { 'Content-Type': 'text/plain', 'Set-Cookie': 'garmin=1' } })
    : new Response('{"error":"expired"}', { status: 401, headers: { 'Content-Type': 'application/json' } })));
  const token = await worker.fetch(browserRequest(GARMIN_API.tokenPath, { method: 'POST', headers: { Authorization: 'ApiKey GCDC_cle' } }));
  assert.equal(token.status, 200);
  assert.equal(await token.text(), 'jeton.24h');
  assert.equal(token.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(token.headers.get('Set-Cookie'), null);                       // les cookies de Garmin ne passent pas
  assert.equal(token.headers.get(RELAY_HEADER), null);                       // réponse de Garmin, pas du relais
  assert.equal(received.length, 1);
  assert.equal(received[0]!.url, `${GARMIN_API.host}${GARMIN_API.tokenPath}`);
  assert.equal(received[0]!.method, 'POST');
  assert.equal(received[0]!.headers['authorization'], 'ApiKey GCDC_cle');
  assert.equal(received[0]!.headers['cookie'], undefined);                   // ni cookie, ni Origin du navigateur
  assert.equal(received[0]!.headers['origin'], undefined);

  // Une erreur de Garmin (clé expirée) est transmise avec son statut, lisible par l'application.
  const search = await worker.fetch(browserRequest(`${GARMIN_API.searchPath}?start=0&limit=20`, { headers: { Authorization: 'Bearer x' } }));
  assert.equal(search.status, 401);
  assert.equal(received[1]!.url, `${GARMIN_API.host}${GARMIN_API.searchPath}?start=0&limit=20`);
});

test('relais : refuse les pages inconnues, les autres adresses et les autres méthodes, sans contacter Garmin', async () => {
  fakeGarmin(() => new Response('ne devrait pas être appelé'));
  const cases: [Request, number, string][] = [
    [browserRequest(GARMIN_API.tokenPath, { method: 'POST', headers: { Authorization: 'ApiKey k' } }, 'https://site-inconnu.example'), 403, 'origin_not_allowed'],
    [browserRequest('/userprofile-service/userprofile/settings', { headers: { Authorization: 'Bearer x' } }), 404, 'route_not_allowed'],
    [browserRequest('/download-service/files/activity/../../autre', { headers: { Authorization: 'Bearer x' } }), 404, 'route_not_allowed'],
    [browserRequest(GARMIN_API.tokenPath, { headers: { Authorization: 'ApiKey k' } }), 405, 'method_not_allowed'],
    [browserRequest(GARMIN_API.tokenPath, { method: 'POST' }), 400, 'missing_authorization'],
  ];
  for (const [request, status, error] of cases) {
    const response = await worker.fetch(request);
    assert.equal(response.status, status, error);
    assert.equal(response.headers.get(RELAY_HEADER), 'error');
    assert.equal(((await response.json()) as { error: string }).error, error);
    // Même un refus porte l'en-tête CORS : l'application peut lire le motif au lieu d'un échec muet.
    assert.ok(response.headers.get('Access-Control-Allow-Origin'));
  }
  assert.equal(received.length, 0);
});

test('client + relais : synchronisation complète, et chaque panne a son message', async () => {
  fakeGarmin((url, init) => {
    const auth = new Headers(init.headers).get('Authorization');
    if (url.pathname === GARMIN_API.tokenPath) return auth === 'ApiKey GCDC_bonne' ? new Response('jeton.24h') : new Response('', { status: 401 });
    if (auth !== 'Bearer jeton.24h') return new Response('', { status: 401 });
    if (url.pathname === GARMIN_API.searchPath) return Response.json([{ activityId: 12 }, { activityId: 11 }]);
    return new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { headers: { 'Content-Type': 'application/zip' } });
  });
  const deps = { fetch: viaRelay(), relayUrl: RELAY, online: () => true, knownIds: new Set(['11']) };
  const result = await fetchRecentGarminFiles('GCDC_bonne', deps);
  assert.ok(result.ok);
  assert.deepEqual([result.listed, result.alreadyKnown, result.files.map((f) => f.externalId)], [2, 1, ['12']]);
  assert.deepEqual(received.map((r) => `${r.method} ${r.url.replace(GARMIN_API.host, '')}`), [
    `POST ${GARMIN_API.tokenPath}`, `GET ${GARMIN_API.searchPath}?start=0&limit=20`, 'GET /download-service/files/activity/12',
  ]);

  // Clé refusée par Garmin : l'erreur vient de Garmin, relayée, et non du relais.
  assert.deepEqual(await fetchRecentGarminFiles('GCDC_perimee', deps), { ok: false, failure: { kind: 'unauthorized', step: 'token', status: 401 } });
  // Page non autorisée dans ALLOWED_ORIGINS.
  const refused = await fetchRecentGarminFiles('GCDC_bonne', { ...deps, fetch: viaRelay('https://autre.example') });
  assert.deepEqual(refused, { ok: false, failure: { kind: 'relay_refused', step: 'token', reason: 'origin_not_allowed' } });
  assert.match(garminFailureText(refused.ok ? { kind: 'offline' } : refused.failure).body, /ALLOWED_ORIGINS/);
  // Garmin injoignable depuis le relais.
  globalThis.fetch = (async () => { throw new TypeError('network'); }) as typeof fetch;
  assert.deepEqual(await fetchRecentGarminFiles('GCDC_bonne', deps), { ok: false, failure: { kind: 'upstream_unreachable', step: 'token' } });
});

test('adresse du relais : nettoyage et test depuis le Profil', async () => {
  assert.equal(cleanRelayUrl('  https://dossard-relais.moi.workers.dev/ '), 'https://dossard-relais.moi.workers.dev');
  assert.equal(cleanRelayUrl('https://exemple.com/relais//'), 'https://exemple.com/relais');
  assert.equal(cleanRelayUrl('http://dossard-relais.moi.workers.dev'), null);       // https obligatoire…
  assert.equal(cleanRelayUrl('http://localhost:8787'), 'http://localhost:8787');     // …sauf en local
  assert.equal(cleanRelayUrl('https://exemple.com/?cle=1'), null);
  assert.equal(cleanRelayUrl('dossard-relais.workers.dev'), null);

  assert.deepEqual(await checkRelay(RELAY, viaRelay()), { ok: true });
  assert.deepEqual(await checkRelay(RELAY, viaRelay('https://autre.example')), { ok: false, problem: 'origin_not_allowed' });
  assert.deepEqual(await checkRelay(RELAY, async () => new Response('<h1>Hello World!</h1>')), { ok: false, problem: 'not_dossard' });
  assert.deepEqual(await checkRelay(RELAY, async () => { throw new TypeError('Failed to fetch'); }), { ok: false, problem: 'unreachable' });
});
