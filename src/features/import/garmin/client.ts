// client.ts — lecture des activités récentes par l'API « Personal » de Garmin Connect.
//
// CE QUI EST DOCUMENTÉ PAR GARMIN :
//   - l'hôte et l'échange « clé d'API → jeton d'accès » (POST, en-tête « Authorization: ApiKey … »),
//     dans la page « Personal API » ; le jeton vaut 24 h, sans jeton de rafraîchissement (FAQ) ;
//   - les chemins de recherche d'activités (paramètres start et limit) et de téléchargement du
//     fichier d'origine, qui est une archive ZIP : dans le client Python officiel
//     (github.com/garmin/connect-personal-api-python), qui envoie le jeton en « bearer ».
// CE QUI NE L'EST PAS dans les pages que j'ai pu lire : la forme exacte des réponses JSON (champ du
//   jeton, champ « activityId »). Les lectures ci-dessous acceptent donc plusieurs formes et
//   signalent « réponse non reconnue » plutôt que de deviner.
// LE RELAIS : Garmin n'envoie pas d'en-têtes CORS, donc un navigateur bloque l'appel direct (constaté
//   au Sprint 4). Les appels passent par le micro-relais Cloudflare de l'athlète (relay/worker.js),
//   qui refait la requête côté serveur et ajoute ces en-têtes. Il ne relaie que les trois appels
//   ci-dessous, et marque ses propres réponses avec l'en-tête X-Dossard-Relay.
// CE QUE PERSONNE NE DOCUMENTE : l'accès depuis un navigateur (CORS). Cette application n'a pas de
// serveur : si Garmin n'autorise pas les pages web, l'appel est bloqué AVANT de partir, et la seule
// voie est le dépôt de fichiers. Ce cas est traité comme un résultat normal, pas comme une panne.
import type { SourceFile } from '../pipeline.ts';

export const GARMIN_API = {
  host: 'https://personal.connectapi.garmin.com',
  tokenPath: '/personalapitoken-service/personal-api/personal-api-key/token',
  searchPath: '/activitylist-service/activities/search/activities',
  downloadPath: (activityId: string): string => `/download-service/files/activity/${encodeURIComponent(activityId)}`,
} as const;

/** Nombre d'activités demandées par synchronisation (paramètre `limit` de la recherche). */
const SEARCH_PAGE = 20;

export type GarminStep = 'token' | 'search' | 'download';
export type GarminFailure =
  | { kind: 'offline' }
  | { kind: 'unauthorized'; step: GarminStep; status: number }   // clé expirée, supprimée ou mal collée
  | { kind: 'rate_limited'; step: GarminStep }
  | { kind: 'http'; step: GarminStep; status: number }
  | { kind: 'unexpected'; step: GarminStep }       // réponse reçue, mais pas dans la forme attendue
  | { kind: 'no_relay' }                           // aucun relais configuré : l'appel direct serait bloqué
  | { kind: 'relay_unreachable'; step: GarminStep }   // relais introuvable (adresse fausse, relais pas déployé)
  | { kind: 'relay_refused'; step: GarminStep; reason: RelayRefusal }
  | { kind: 'upstream_unreachable'; step: GarminStep };   // le relais répond, mais n'a pas pu joindre Garmin

/** Motifs de refus émis par le relais lui-même (champ « error » de sa réponse JSON). */
export type RelayRefusal = 'origin_not_allowed' | 'route_not_allowed' | 'method_not_allowed' | 'missing_authorization' | 'unknown';
export const RELAY_HEADER = 'X-Dossard-Relay';

export type GarminResult =
  | { ok: true; files: SourceFile[]; listed: number; alreadyKnown: number; failedDownloads: number }
  | { ok: false; failure: GarminFailure };

export interface GarminDeps {
  fetch: typeof fetch;
  /** Adresse du relais Cloudflare (https://….workers.dev). Sans relais, la synchronisation n'est pas tentée. */
  relayUrl: string | undefined;
  /** false quand l'appareil se sait hors ligne (navigator.onLine). */
  online: () => boolean;
  /** Identifiants Garmin des activités déjà importées : elles ne sont pas retéléchargées. */
  knownIds: ReadonlySet<string>;
  /** Nombre maximal de fichiers téléchargés par synchronisation. */
  limit?: number;
}

class Failure extends Error {
  readonly failure: GarminFailure;
  constructor(failure: GarminFailure) { super(failure.kind); this.failure = failure; }
}

const RELAY_REFUSALS: readonly RelayRefusal[] = ['origin_not_allowed', 'route_not_allowed', 'method_not_allowed', 'missing_authorization'];
async function relayRefusal(response: Response): Promise<RelayRefusal> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return RELAY_REFUSALS.find((reason) => reason === body.error) ?? 'unknown';
  } catch { return 'unknown'; }
}

async function call(deps: GarminDeps, relay: string, step: GarminStep, path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await deps.fetch(`${relay}${path}`, init); }
  // fetch ne lève une TypeError que si la requête n'a pas abouti du tout. Hors ligne : rien à faire.
  // En ligne : l'adresse du relais ne répond pas (faute de frappe, relais pas encore déployé).
  catch { throw new Failure(deps.online() ? { kind: 'relay_unreachable', step } : { kind: 'offline' }); }
  if (response.ok) return response;
  // Erreur émise par le relais lui-même, et non transmise depuis Garmin.
  if (response.headers.get(RELAY_HEADER) === 'error') {
    if (response.status === 502) throw new Failure({ kind: 'upstream_unreachable', step });
    throw new Failure({ kind: 'relay_refused', step, reason: await relayRefusal(response) });
  }
  if (response.status === 401 || response.status === 403) throw new Failure({ kind: 'unauthorized', step, status: response.status });
  if (response.status === 429) throw new Failure({ kind: 'rate_limited', step });
  throw new Failure({ kind: 'http', step, status: response.status });
}

/**
 * Adresse de relais saisie par l'athlète, ramenée à sa forme utile (« https://hote/chemin », sans
 * barre finale). null si ce n'est pas une adresse https (ou http sur la machine locale, pour les essais).
 */
export function cleanRelayUrl(text: string): string | null {
  let url: URL;
  try { url = new URL(text.trim()); } catch { return null; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export type RelayCheck =
  | { ok: true }
  | { ok: false; problem: 'unreachable' | 'not_dossard' | 'origin_not_allowed' };
/** Interroge la racine du relais : en ligne ? c'est bien le relais Dossard ? accepte-t-il cette page ? */
export async function checkRelay(relayUrl: string, fetcher: typeof fetch): Promise<RelayCheck> {
  let response: Response;
  try { response = await fetcher(`${relayUrl}/`, { method: 'GET' }); } catch { return { ok: false, problem: 'unreachable' }; }
  let body: unknown;
  try { body = await response.json(); } catch { return { ok: false, problem: 'not_dossard' }; }
  if (body === null || typeof body !== 'object' || (body as Record<string, unknown>)['relay'] !== 'dossard') return { ok: false, problem: 'not_dossard' };
  return (body as Record<string, unknown>)['originAllowed'] === true ? { ok: true } : { ok: false, problem: 'origin_not_allowed' };
}
export const RELAY_CHECK_TEXT: Record<Exclude<RelayCheck, { ok: true }>['problem'], string> = {
  unreachable: 'Le relais ne répond pas. Vérifie l’adresse (elle se termine par .workers.dev) et que le Worker est bien déployé.',
  not_dossard: 'Cette adresse répond, mais ce n’est pas le relais Dossard. As-tu bien collé le code de worker.js puis cliqué « Deploy » ?',
  origin_not_allowed: 'Le relais fonctionne, mais refuse cette page. Ajoute son adresse dans ALLOWED_ORIGINS, en haut de worker.js, puis redéploie.',
};

/** Le jeton arrive en texte brut selon les clients existants ; on accepte aussi une enveloppe JSON. */
export function readAccessToken(body: string): string | null {
  const text = body.trim();
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const token = json['access_token'] ?? json['accessToken'] ?? json['token'];
      return typeof token === 'string' && token !== '' ? token : null;
    } catch { return null; }
  }
  return text !== '' && !/\s/.test(text) ? text.replace(/^"|"$/g, '') : null;
}
/** Identifiants des activités d'une réponse de recherche : un tableau, ou un objet qui en contient un. */
export function readActivityIds(json: unknown): string[] | null {
  const list = Array.isArray(json) ? json
    : json !== null && typeof json === 'object' ? Object.values(json).find((value) => Array.isArray(value)) : undefined;
  if (!Array.isArray(list)) return null;
  const ids = list
    .map((item: unknown) => (item !== null && typeof item === 'object' ? (item as Record<string, unknown>)['activityId'] : undefined))
    .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
    .map(String);
  return list.length > 0 && ids.length === 0 ? null : ids;
}

/**
 * Récupère les fichiers d'origine des activités récentes pas encore importées. Ne touche pas au
 * store : les fichiers obtenus passent par le même import que ceux déposés à la main.
 */
export async function fetchRecentGarminFiles(apiKey: string, deps: GarminDeps): Promise<GarminResult> {
  const relay = deps.relayUrl === undefined ? null : cleanRelayUrl(deps.relayUrl);
  if (relay === null) return { ok: false, failure: { kind: 'no_relay' } };
  const call_ = (step: GarminStep, path: string, init: RequestInit): Promise<Response> => call(deps, relay, step, path, init);
  try {
    const tokenResponse = await call_('token', GARMIN_API.tokenPath, { method: 'POST', headers: { Authorization: `ApiKey ${apiKey}` } });
    const token = readAccessToken(await tokenResponse.text());
    if (token === null) return { ok: false, failure: { kind: 'unexpected', step: 'token' } };
    const headers = { Authorization: `Bearer ${token}` };

    // Première page de la recherche : les activités les plus récentes.
    const searchResponse = await call_('search', `${GARMIN_API.searchPath}?start=0&limit=${SEARCH_PAGE}`, { headers });
    let ids: string[] | null = null;
    try { ids = readActivityIds(await searchResponse.json()); } catch { ids = null; }
    if (ids === null) return { ok: false, failure: { kind: 'unexpected', step: 'search' } };

    const wanted = ids.filter((id) => !deps.knownIds.has(id)).slice(0, deps.limit ?? 20);
    const files: SourceFile[] = [];
    let failedDownloads = 0;
    for (const id of wanted) {
      try {
        const response = await call_('download', GARMIN_API.downloadPath(id), { headers });
        files.push({ name: `Garmin ${id}`, buffer: await response.arrayBuffer(), externalId: id });
      } catch (error) {
        // Un fichier manquant (activité saisie à la main, sans enregistrement) n'arrête pas les autres.
        if (error instanceof Failure && error.failure.kind === 'http') { failedDownloads++; continue; }
        throw error;
      }
    }
    return { ok: true, files, listed: ids.length, alreadyKnown: ids.length - ids.filter((id) => !deps.knownIds.has(id)).length, failedDownloads };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, failure: error.failure };
    return { ok: false, failure: { kind: 'unexpected', step: 'search' } };
  }
}

const STEP_TEXT: Record<GarminStep, string> = { token: 'l’échange de la clé', search: 'la liste des activités', download: 'le téléchargement d’un fichier' };
const FIT_FALLBACK = 'En attendant : dans Garmin Connect, ouvre l’activité, puis la roue dentée, puis « Exporter le fichier d’origine », et dépose les fichiers ici.';
const REFUSAL_TEXT: Record<RelayRefusal, string> = {
  origin_not_allowed: 'Le relais refuse cette page. Ajoute son adresse dans ALLOWED_ORIGINS, en haut de worker.js, puis redéploie le Worker.',
  route_not_allowed: 'Le relais ne connaît pas cet appel : la version de worker.js déployée est probablement plus ancienne que l’application. Recolle le fichier fourni et redéploie.',
  method_not_allowed: 'Le relais ne connaît pas cet appel : la version de worker.js déployée est probablement plus ancienne que l’application. Recolle le fichier fourni et redéploie.',
  missing_authorization: 'La clé n’a pas été transmise au relais. Vérifie qu’elle est bien enregistrée dans le Profil.',
  unknown: 'Le relais a refusé la demande sans en donner la raison.',
};
/** Message affiché à l'athlète : ce qui s'est passé, et quoi faire. */
export function garminFailureText(failure: GarminFailure): { title: string; body: string } {
  switch (failure.kind) {
    case 'no_relay': return {
      title: 'Relais Garmin non configuré',
      body: `Garmin n’autorise pas une page web à l’interroger directement : la synchronisation passe par ton relais Cloudflare. Colle son adresse dans l’onglet Profil, sous la clé Garmin. ${FIT_FALLBACK}`,
    };
    case 'relay_unreachable': return {
      title: 'Le relais ne répond pas',
      body: `L’adresse du relais (Profil) ne répond pas pendant ${STEP_TEXT[failure.step]}. Vérifie qu’elle est exacte et que le Worker est déployé : le bouton « Tester le relais » du Profil le confirme. Un bloqueur de publicité peut aussi bloquer l’appel. ${FIT_FALLBACK}`,
    };
    case 'relay_refused': return { title: 'Le relais a refusé la demande', body: `${REFUSAL_TEXT[failure.reason]} ${FIT_FALLBACK}` };
    case 'upstream_unreachable': return {
      title: 'Le relais n’a pas pu joindre Garmin',
      body: `Ton relais fonctionne, mais Garmin n’a pas répondu pendant ${STEP_TEXT[failure.step]}. Le service est peut-être momentanément indisponible : réessaie plus tard. ${FIT_FALLBACK}`,
    };
    case 'offline': return { title: 'Pas de connexion', body: 'L’appareil est hors ligne. Réessaie une fois connecté, ou dépose des fichiers déjà exportés.' };
    case 'unauthorized': return {
      title: 'Garmin a refusé la clé',
      body: `Réponse ${failure.status} pendant ${STEP_TEXT[failure.step]}, transmise par ton relais (qui, lui, fonctionne). La clé est expirée, supprimée ou mal collée : crée-en une nouvelle dans Garmin Connect (Paramètres, Clé d’API personnelle) et remplace-la dans le Profil. ${FIT_FALLBACK}`,
    };
    case 'rate_limited': return { title: 'Trop de demandes', body: 'Garmin (ou le quota gratuit de Cloudflare) limite le nombre d’appels. Réessaie dans quelques minutes.' };
    case 'http': return { title: 'Garmin a répondu par une erreur', body: `Réponse ${failure.status} pendant ${STEP_TEXT[failure.step]}. ${FIT_FALLBACK}` };
    case 'unexpected': return {
      title: 'Réponse de Garmin non reconnue',
      body: `La réponse reçue pendant ${STEP_TEXT[failure.step]} n’a pas la forme attendue : l’API a peut-être changé. ${FIT_FALLBACK}`,
    };
  }
}
