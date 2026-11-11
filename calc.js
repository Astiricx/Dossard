// calc.js — les règles "métier" : sports, zones, charge d'entraînement, semaines d'une prépa, alertes.
import { etat, enregistrer } from './store.js';
import { aujourdhui, ajouterJours, lundiDe, somme } from './util.js';

export const SPORTS = {
  course: { nom: 'Course', emoji: '🏃' },
  velo: { nom: 'Vélo', emoji: '🚴' },
  natation: { nom: 'Natation', emoji: '🏊' },
  renfo: { nom: 'Renfo', emoji: '🏋️' },
  repos: { nom: 'Repos', emoji: '😴' },      // seulement pour le plan prévu
  autre: { nom: 'Autre', emoji: '🥾' },      // rando, ski… (activités importées)
};
export const ORDRE_SPORTS = ['course', 'velo', 'natation', 'renfo', 'autre'];   // ordre fixe des couleurs dans les graphiques

// Zones d'intensité. `rpe` = effort équivalent sur 10 (sert à calculer la charge prévue),
// `fc` = % de la FC max, `allure` = multiplicateur de l'allure 10 km de référence.
export const ZONES = [
  { nom: 'Récupération', rpe: 2, fc: [50, 60], allure: [1.33, null] },
  { nom: 'Endurance', rpe: 3, fc: [60, 70], allure: [1.18, 1.33] },
  { nom: 'Tempo', rpe: 5, fc: [70, 80], allure: [1.07, 1.18] },
  { nom: 'Seuil', rpe: 7, fc: [80, 90], allure: [0.99, 1.07] },
  { nom: 'VMA', rpe: 9, fc: [90, 100], allure: [null, 0.99] },
];

export const TYPES = {
  'course-5k': { nom: 'Course · 5 km', km: 5, sports: ['course', 'renfo'] },
  'course-10k': { nom: 'Course · 10 km', km: 10, sports: ['course', 'renfo'] },
  'course-semi': { nom: 'Course · semi-marathon', km: 21.1, sports: ['course', 'renfo'] },
  'course-marathon': { nom: 'Course · marathon', km: 42.2, sports: ['course', 'renfo'] },
  'trail': { nom: 'Trail', km: null, sports: ['course', 'renfo'] },
  'tri-xs': { nom: 'Triathlon XS (découverte)', km: 12.9, sports: ['natation', 'velo', 'course', 'renfo'] },
  'tri-s': { nom: 'Triathlon S (sprint)', km: 25.75, sports: ['natation', 'velo', 'course', 'renfo'] },
  'tri-m': { nom: 'Triathlon M (olympique)', km: 51.5, sports: ['natation', 'velo', 'course', 'renfo'] },
  'tri-l': { nom: 'Triathlon L (half)', km: 113, sports: ['natation', 'velo', 'course', 'renfo'] },
  'tri-xl': { nom: 'Triathlon XL (Ironman)', km: 226, sports: ['natation', 'velo', 'course', 'renfo'] },
  'autre': { nom: 'Autre objectif', km: null, sports: ['course', 'velo', 'natation', 'renfo'] },
};
export const estTriathlon = p => p.type.startsWith('tri');

// ---------- Charge d'entraînement ----------
// charge = durée (minutes) × effort ressenti (1 à 10). C'est la méthode "RPE de séance" :
// simple, valable pour tous les sports, et comparable d'une semaine à l'autre.

/** Effort /10 d'une activité : ta note si tu l'as saisie, sinon une estimation. */
export function rpeEstime(a) {
  if (a.rpe) return a.rpe;
  // Activité Strava : on convertit l'"effort relatif" (basé sur le cardio) en note sur 10.
  if (a.effortRelatif && a.dureeMin) return Math.max(1, Math.min(10, Math.round(1.5 + 2.4 * a.effortRelatif / a.dureeMin)));
  const s = etat.seances.find(x => x.activiteId === a.id);
  return s?.zone ? ZONES[s.zone - 1].rpe : 3;
}
export const charge = a => Math.round((a.dureeMin || 0) * rpeEstime(a));

/** Durée d'une séance prévue (estimée depuis la distance si la durée manque). */
export const dureePrevue = s => s.dureeMin || (s.distanceKm || 0) * ({ course: 5.5, velo: 2.4, natation: 22 }[s.sport] || 0);
export const chargePrevue = s => s.sport === 'repos' ? 0 : Math.round(dureePrevue(s) * (s.zone ? ZONES[s.zone - 1].rpe : 3));

/** Totaux d'une liste d'activités réalisées. */
export function totaux(activites) {
  const t = { n: activites.length, min: 0, kmCourse: 0, charge: 0, sport: {} };
  for (const a of activites) {
    const s = t.sport[a.sport] ??= { n: 0, min: 0, km: 0 };
    s.n++; s.min += a.dureeMin || 0; s.km += a.distanceKm || 0;
    t.min += a.dureeMin || 0; t.charge += charge(a);
    if (a.sport === 'course') t.kmCourse += a.distanceKm || 0;
  }
  return t;
}
/** Totaux d'une liste de séances prévues (le repos ne compte pas). */
export function totauxPrevus(seances) {
  const l = seances.filter(s => s.sport !== 'repos');
  return {
    n: l.length, faites: l.filter(s => s.activiteId).length,
    min: somme(l, dureePrevue), charge: somme(l, chargePrevue),
    kmCourse: somme(l.filter(s => s.sport === 'course'), s => s.distanceKm),
  };
}

// ---------- Préparations ----------
export const LIB_STATUT = { 'a-venir': 'À venir', 'en-cours': 'En cours', 'terminee': 'Terminée' };
export function statut(p) { const j = aujourdhui(); return j < p.debut ? 'a-venir' : j > p.date ? 'terminee' : 'en-cours'; }

/** La préparation affichée dans Accueil / Plan / Suivi : celle choisie, sinon celle en cours, sinon la plus récente. */
export function prepActive() {
  const l = etat.preparations;
  if (!l.length) return null;
  return l.find(p => p.id === etat.reglages.prepActive) || l.find(p => statut(p) === 'en-cours')
    || [...l].sort((a, b) => b.date.localeCompare(a.date))[0];
}
/** La préparation qui couvre une date donnée (pour ranger une nouvelle séance). */
export const prepPour = date => etat.preparations.find(p => date >= lundiDe(p.debut) && date <= p.date) || prepActive();

export const seancesDe = p => etat.seances.filter(s => s.prepId === p.id);
export const activitesEntre = (d1, d2) => etat.activites.filter(a => a.date >= d1 && a.date <= d2);
export const activitesDe = p => activitesEntre(p.debut, p.date);
export const nbSemaines = p => Math.round((new Date(lundiDe(p.date)) - new Date(lundiDe(p.debut))) / (7 * 864e5)) + 1;

/** Nom de la phase de la semaine n° i (0 = première) d'une prépa. */
export function phaseDe(p, i) {
  let fin = 0;
  for (const ph of p.phases || []) { fin += ph.semaines; if (i < fin) return ph.nom; }
  return '';
}
/** Découpage proposé par défaut : base, développement, spécifique, affûtage. */
export function phasesParDefaut(n) {
  if (n < 4) return [{ nom: 'Spécifique', semaines: n }];
  const affutage = n >= 8 ? 2 : 1, specifique = Math.max(1, Math.round(n * 0.25)), dev = Math.max(1, Math.round(n * 0.3));
  return [{ nom: 'Base', semaines: Math.max(1, n - affutage - specifique - dev) }, { nom: 'Développement', semaines: dev },
    { nom: 'Spécifique', semaines: specifique }, { nom: 'Affûtage', semaines: affutage }];
}

/** Les semaines d'une prépa, du lundi de début à la semaine de course, avec prévu et réalisé. */
export function semainesDe(p) {
  const resultat = [], seances = seancesDe(p), dernier = lundiDe(p.date);
  for (let lundi = lundiDe(p.debut), i = 0; lundi <= dernier; lundi = ajouterJours(lundi, 7), i++) {
    const fin = ajouterJours(lundi, 6);
    resultat.push({
      num: i + 1, lundi, fin, phase: phaseDe(p, i),
      seances: seances.filter(s => s.date >= lundi && s.date <= fin),
      activites: activitesEntre(lundi < p.debut ? p.debut : lundi, fin > p.date ? p.date : fin),
    });
  }
  return resultat;
}

// ---------- Alerte de surcharge ----------
// On compare la charge de la semaine à la moyenne des 4 semaines précédentes.
// Au-delà de +30 % : attention. Au-delà de +50 % : risque de blessure nettement accru.
export const chargeSemaine = lundi => totaux(activitesEntre(lundi, ajouterJours(lundi, 6))).charge;
export function alerteCharge(lundi) {
  const c = chargeSemaine(lundi);
  const moyenne = somme([1, 2, 3, 4], k => chargeSemaine(ajouterJours(lundi, -7 * k))) / 4;
  const ratio = moyenne ? c / moyenne : null;
  let niveau = null;
  if (c >= 300) {                                   // en dessous, la semaine est trop légère pour inquiéter
    if (moyenne === 0) niveau = c >= 600 ? 'forte' : null;
    else if (ratio > 1.5) niveau = 'forte';
    else if (ratio > 1.3) niveau = 'moderee';
  }
  return { charge: c, moyenne: Math.round(moyenne), ratio, niveau };
}
export const LIB_ALERTE = { moderee: 'Charge en hausse de plus de 30 %', forte: 'Charge en hausse de plus de 50 %' };

// ---------- Régularité ----------
/** Nombre de semaines consécutives (jusqu'à aujourd'hui) avec au moins `min` séances. */
export function serieSemaines(min = 2) {
  const nb = l => activitesEntre(l, ajouterJours(l, 6)).length;
  let lundi = lundiDe(aujourdhui()), n = nb(lundi) >= min ? 1 : 0;   // la semaine en cours compte si elle est déjà validée
  for (lundi = ajouterJours(lundi, -7); nb(lundi) >= min; lundi = ajouterJours(lundi, -7)) n++;
  return n;
}

// ---------- Rapprochement prévu / réalisé ----------
/** Relie chaque séance prévue à une activité du même jour et du même sport. Renvoie le nombre de liens créés. */
export async function rapprocher() {
  const prises = new Set(etat.seances.map(s => s.activiteId).filter(Boolean));
  let n = 0;
  for (const s of etat.seances) {
    if (s.activiteId || s.sport === 'repos') continue;
    const a = etat.activites.find(x => x.date === s.date && x.sport === s.sport && !prises.has(x.id));
    if (a) { s.activiteId = a.id; prises.add(a.id); await enregistrer('seances', s); n++; }
  }
  return n;
}
