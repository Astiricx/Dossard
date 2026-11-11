// store.js — toutes les données de l'app.
// Elles vivent en mémoire dans `etat` et sont recopiées dans IndexedDB (stockage du téléphone).
// Rien ne part sur Internet : la seule sortie possible est l'export JSON que tu déclenches.
//
// Collections :
//   preparations { id, nom, type, date (course), debut, distanceKm, sports[], objectif, resultat, bilan, phases[{nom, semaines}] }
//   seances      { id, prepId, date, sport, titre, dureeMin, distanceKm, zone (1-5), notes, activiteId }   <- le PRÉVU
//   activites    { id, date, heure, sport, titre, dureeMin, distanceKm, deniveleM, rpe, fatigue, ressenti,
//                  source ('strava'|'manuel'), stravaId, effortRelatif, course (bool), notes }             <- le RÉALISÉ
//   modeles      { id, sport, titre, dureeMin, distanceKm, zone, notes }
import { uid } from './util.js';

export const COLLECTIONS = ['preparations', 'seances', 'activites', 'modeles'];
const REGLAGES_DEFAUT = { fcMax: 190, ref10k: '', theme: 'sombre', prepActive: null, derniereSauvegarde: null, modelesCrees: false };
export const etat = { preparations: [], seances: [], activites: [], modeles: [], reglages: { ...REGLAGES_DEFAUT } };

let base; // connexion IndexedDB
const promesse = requete => new Promise((ok, ko) => { requete.onsuccess = () => ok(requete.result); requete.onerror = () => ko(requete.error); });
const magasin = (nom, mode = 'readonly') => base.transaction(nom, mode).objectStore(nom);

/** Ouvre la base et charge tout en mémoire (appelé une fois au démarrage). */
export async function charger() {
  const ouverture = indexedDB.open('dossard', 1);
  ouverture.onupgradeneeded = () => { for (const c of [...COLLECTIONS, 'divers']) ouverture.result.createObjectStore(c, { keyPath: 'id' }); };
  base = await promesse(ouverture);
  for (const c of COLLECTIONS) etat[c] = await promesse(magasin(c).getAll());
  const r = await promesse(magasin('divers').get('reglages'));
  etat.reglages = { ...REGLAGES_DEFAUT, ...(r?.valeurs || {}) };
}

/** Crée ou met à jour un objet (un id est attribué s'il n'en a pas). */
export function enregistrer(collection, objet) {
  if (!objet.id) objet.id = uid();
  const i = etat[collection].findIndex(x => x.id === objet.id);
  if (i >= 0) etat[collection][i] = objet; else etat[collection].push(objet);
  return promesse(magasin(collection, 'readwrite').put(objet)).then(() => objet);
}

export function supprimer(collection, id) {
  etat[collection] = etat[collection].filter(x => x.id !== id);
  return promesse(magasin(collection, 'readwrite').delete(id));
}

/** Modifie un ou plusieurs réglages. */
export function regler(modifs) {
  Object.assign(etat.reglages, modifs);
  return promesse(magasin('divers', 'readwrite').put({ id: 'reglages', valeurs: etat.reglages }));
}

/** Tout le contenu de l'app sous forme d'objet (pour la sauvegarde JSON). */
export function exporter() {
  return { app: 'dossard', version: 1, exporteLe: new Date().toISOString(), ...Object.fromEntries(COLLECTIONS.map(c => [c, etat[c]])), reglages: etat.reglages };
}

/**
 * Importe un fichier Dossard (sauvegarde ou historique Strava).
 * - remplacer = true  : efface tout puis recharge le fichier (restauration d'une sauvegarde).
 * - remplacer = false : ajoute ce qui manque. Les activités Strava déjà présentes sont mises à jour
 *   mais ce que tu as saisi toi-même (effort, fatigue, ressenti) est conservé.
 */
export async function importer(donnees, remplacer) {
  if (!donnees || donnees.app !== 'dossard') throw new Error("Ce fichier n'est pas un fichier Dossard.");
  const bilan = { ajoutes: 0, misAJour: 0 };
  if (remplacer) for (const c of COLLECTIONS) { await promesse(magasin(c, 'readwrite').clear()); etat[c] = []; }
  for (const c of COLLECTIONS) {
    for (const objet of donnees[c] || []) {
      if (!objet || !objet.id) continue;
      const existant = etat[c].find(x => x.id === objet.id);
      if (!existant) { await enregistrer(c, objet); bilan.ajoutes++; }
      else if (c === 'activites' && objet.source === 'strava') {
        const saisies = {};
        for (const cle of ['rpe', 'fatigue', 'ressenti']) if (existant[cle] != null) saisies[cle] = existant[cle];
        await enregistrer(c, { ...objet, ...saisies }); bilan.misAJour++;
      }
    }
  }
  if (donnees.reglages) {
    if (remplacer) await regler({ ...REGLAGES_DEFAUT, ...donnees.reglages });
    else {                                   // en fusion : on ne remplit que les réglages restés par défaut
      const neufs = {};
      for (const [cle, v] of Object.entries(donnees.reglages)) if (etat.reglages[cle] === REGLAGES_DEFAUT[cle]) neufs[cle] = v;
      await regler(neufs);
    }
  }
  return bilan;
}

export async function toutEffacer() {
  for (const c of COLLECTIONS) { await promesse(magasin(c, 'readwrite').clear()); etat[c] = []; }
  await regler({ ...REGLAGES_DEFAUT, modelesCrees: true });
}
