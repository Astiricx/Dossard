// suivi.js — volume et charge par semaine et par sport, alerte de surcharge, fatigue, progression.
import { etat } from '../store.js';
import { prepActive, semainesDe, totaux, totauxPrevus, activitesEntre, alerteCharge, LIB_ALERTE, SPORTS, ORDRE_SPORTS, serieSemaines } from '../calc.js';
import { esc, aujourdhui, ajouterJours, lundiDe, plageSemaine, dateCourte, duree, virgule, somme } from '../util.js';
import { barres, courbes } from '../charts.js';

let plage = 'prepa', unite = 'h';
const SERIES = ORDRE_SPORTS.map(s => ({ cle: s, nom: SPORTS[s].nom, couleur: `var(--c-${s})` }));
const allureTexte = minParKm => { const s = Math.round(minParKm * 60); return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}`; };

/** Les semaines affichées : celles de la prépa suivie, ou les N dernières semaines. */
function semainesAffichees(p) {
  if (plage === 'prepa' && p) return semainesDe(p).map(s => ({ lundi: s.lundi, nom: `S${s.num}` }));
  const n = plage === '26' ? 26 : 12, lundi = lundiDe(aujourdhui());
  return Array.from({ length: n }, (_, i) => { const l = ajouterJours(lundi, -7 * (n - 1 - i)); return { lundi: l, nom: dateCourte(l) }; });
}

export function rendre() {
  const p = prepActive();
  if (!etat.activites.length && !etat.seances.length) return `<h1>Suivi</h1><p class="vide">Le suivi se remplit dès que tu notes une séance réalisée ou que tu importes ton historique.</p>`;
  if (plage === 'prepa' && !p) plage = '12';
  const auj = aujourdhui(), lundiCourant = lundiDe(auj);
  const lignes = semainesAffichees(p).map(s => {
    const fin = ajouterJours(s.lundi, 6), acts = activitesEntre(s.lundi, fin);
    const notees = acts.filter(a => a.fatigue);
    const courses = acts.filter(a => a.sport === 'course' && a.distanceKm && a.dureeMin), kmC = somme(courses, a => a.distanceKm);
    return { ...s, t: totaux(acts), prevu: totauxPrevus(etat.seances.filter(x => x.date >= s.lundi && x.date <= fin)),
      alerte: s.lundi <= lundiCourant ? alerteCharge(s.lundi) : { niveau: null, moyenne: null },
      fatigue: notees.length ? somme(notees, a => a.fatigue) / notees.length : null,
      allure: kmC >= 3 ? somme(courses, a => a.dureeMin) / kmC : null, titre: `${s.nom} · ${plageSemaine(s.lundi)}` };
  });
  const courante = totaux(activitesEntre(lundiCourant, ajouterJours(lundiCourant, 6))), alerte = alerteCharge(lundiCourant);
  const alertes = lignes.filter(l => l.alerte.niveau);
  const recentes = alertes.filter(l => l.lundi >= ajouterJours(lundiCourant, -7));   // seules les alertes récentes appellent une action

  const volume = barres({
    colonnes: lignes.map(l => ({ etiquette: l.nom, titre: l.titre,
      valeurs: unite === 'h' ? Object.fromEntries(ORDRE_SPORTS.map(s => [s, (l.t.sport[s]?.min || 0) / 60])) : { course: l.t.kmCourse },
      repere: unite === 'h' ? l.prevu.min / 60 : l.prevu.kmCourse })),
    series: unite === 'h' ? SERIES : SERIES.slice(0, 1),
    fmt: v => unite === 'h' ? (v % 1 ? duree(v * 60) : `${v} h`) : `${virgule(v)} km`,
  });
  const chargeG = barres({
    colonnes: lignes.map(l => ({ etiquette: l.nom, titre: l.titre, valeurs: { charge: l.t.charge }, repere: l.prevu.charge,
      alerte: l.alerte.niveau, texteAlerte: l.alerte.niveau ? '⚠ ' + LIB_ALERTE[l.alerte.niveau].toLowerCase() : '' })),
    series: [{ cle: 'charge', nom: 'Charge réalisée', couleur: 'var(--c-charge)' }],
    ligne: lignes.map(l => l.alerte.moyenne), nomLigne: 'moyenne des 4 sem. précédentes', fmt: v => Math.round(v),
  });
  const fatigueG = courbes({ colonnes: lignes.map(l => ({ etiquette: l.nom, titre: l.titre })),
    series: [{ nom: 'Fatigue', couleur: 'var(--c-renfo)', valeurs: lignes.map(l => l.fatigue) }], fmt: v => virgule(v) + '/5' });
  const allureG = courbes({ colonnes: lignes.map(l => ({ etiquette: l.nom, titre: l.titre })), inverse: true,
    series: [{ nom: 'Allure', couleur: 'var(--c-course)', valeurs: lignes.map(l => l.allure) }], fmt: v => allureTexte(v) + '/km', fmtAxe: allureTexte });

  const pastille = (v, texte, groupe, actuel) => `<button data-a="suivi-${groupe}" data-v="${v}" class="${actuel === v ? 'actif' : ''}">${texte}</button>`;
  return `<h1>Suivi</h1>
    <div class="tuiles">
      <div><small>Cette semaine</small><b>${duree(courante.min)}</b><span>${courante.n} séance${courante.n > 1 ? 's' : ''}</span></div>
      <div><small>Course</small><b>${virgule(courante.kmCourse)} km</b><span>cette semaine</span></div>
      <div><small>Charge</small><b>${courante.charge}</b><span>${alerte.ratio ? '× ' + virgule(alerte.ratio, 2) + ' vs 4 sem.' : 'pas de repère'}</span></div>
      <div><small>Régularité</small><b>${serieSemaines()}</b><span>semaines d'affilée</span></div>
    </div>
    <div class="commandes"><div class="segments">${p ? pastille('prepa', 'Cette prépa', 'plage', plage) : ''}${pastille('12', '12 sem.', 'plage', plage)}${pastille('26', '6 mois', 'plage', plage)}</div></div>

    ${recentes.length ? `<section class="carte alerte ${recentes.some(l => l.alerte.niveau === 'forte') ? 'forte' : 'moderee'}">
      <h2>⚠ Ta charge monte trop vite</h2>
      <p>${recentes.map(l => `${esc(l.titre)} : charge ${l.t.charge}, pour ${l.alerte.moyenne} en moyenne sur les 4 semaines précédentes (× ${virgule(l.alerte.ratio ?? 0, 2)}).`).join('<br>')}
      Allège une séance ou ajoute un jour de repos.</p></section>` : ''}

    <section class="carte"><div class="titre-carte"><h2>Volume par semaine</h2>
      <div class="segments mini">${pastille('h', 'Heures', 'unite', unite)}${pastille('km', 'Km course', 'unite', unite)}</div></div>${volume}</section>
    <section class="carte"><h2>Charge par semaine</h2><p class="sous-titre">${alertes.length ? `Le « ! » signale une hausse trop rapide : ${alertes.length} semaine${alertes.length > 1 ? 's' : ''} sur cette période.` : 'Aucune hausse trop rapide sur cette période.'}</p>${chargeG}
      <details><summary>Comment c'est calculé</summary><p class="aide">Charge d'une séance = durée en minutes × effort ressenti sur 10 (estimé d'après Strava si tu ne l'as pas noté).
      La charge de la semaine est comparée à la moyenne des 4 semaines précédentes : au-delà de +30 % l'app te prévient, au-delà de +50 % le risque de blessure augmente nettement.
      Tous les sports comptent, y compris les randonnées et le ski importés de Strava.</p></details></section>
    <section class="carte"><h2>Fatigue moyenne après les séances</h2>${fatigueG}</section>
    <section class="carte"><h2>Allure moyenne en course à pied</h2><p class="sous-titre">Toutes sorties confondues ; plus haut = plus rapide.</p>${allureG}</section>

    <section class="carte"><details><summary>Voir les chiffres</summary><div class="defile"><table>
      <tr><th>Semaine</th><th>Séances</th><th>Durée</th><th>Km course</th><th>Charge</th><th>Charge prévue</th></tr>
      ${lignes.map(l => `<tr><td>${esc(l.titre)}</td><td>${l.t.n}</td><td>${duree(l.t.min)}</td><td>${virgule(l.t.kmCourse)}</td><td>${l.t.charge}${l.alerte.niveau ? ' ⚠' : ''}</td><td>${l.prevu.charge || '—'}</td></tr>`).join('')}
    </table></div></details></section>`;
}

export const actions = {
  'suivi-plage'(d) { plage = d.v; return true; },
  'suivi-unite'(d) { unite = d.v; return true; },
};
