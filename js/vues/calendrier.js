// calendrier.js — vue semaine et vue mois, prévu contre réalisé, compte à rebours.
import { prepActive, statut } from '../calc.js';
import { esc, aujourdhui, ajouterJours, lundiDe, ecartJours, plageSemaine, versDate, versISO, MOIS, JOURS } from '../util.js';
import { ligneJour, elementsDuJour } from '../seances.js';

let mode = 'semaine', ancre = null;                   // ancre = une date de la période affichée

function vueSemaine() {
  const lundi = lundiDe(ancre);
  return `<section class="carte">${Array.from({ length: 7 }, (_, i) => ligneJour(ajouterJours(lundi, i))).join('')}</section>`;
}

/** Grille du mois : un point plein par séance réalisée, un anneau par séance prévue pas encore faite. */
function vueMois() {
  const d = versDate(ancre), premier = versISO(new Date(d.getFullYear(), d.getMonth(), 1));
  const debut = lundiDe(premier), mois = d.getMonth(), auj = aujourdhui();
  let cases = '';
  for (let i = 0, jour = debut; i < 42; i++, jour = ajouterJours(jour, 1)) {
    if (i >= 35 && versDate(jour).getMonth() !== mois) break;          // pas de 6e ligne vide
    const { seances, activites, course } = elementsDuJour(jour);
    const points = seances.map(s => `<i class="${s.activiteId ? 'plein' : 'anneau'}" style="--c:var(--c-${s.sport})"></i>`).join('')
      + activites.map(a => `<i class="plein" style="--c:var(--c-${a.sport})"></i>`).join('');
    cases += `<button class="case-jour ${versDate(jour).getMonth() !== mois ? 'hors' : ''} ${jour === auj ? 'auj' : ''}" data-a="jour" data-date="${jour}">
      <b>${versDate(jour).getDate()}</b><span class="points">${course ? '<span class="drapeau">🏁</span>' : ''}${points}</span></button>`;
  }
  return `<section class="carte"><div class="grille-mois">${JOURS.map(j => `<span class="entete-jour">${j[0].toUpperCase()}</span>`).join('')}${cases}</div>
    <p class="legende"><span><i class="rond" style="background:var(--texte2)"></i>réalisé</span><span><i class="anneau-legende"></i>prévu</span><span>🏁 course</span></p></section>`;
}

export function rendre() {
  ancre ??= aujourdhui();
  const p = prepActive(), d = versDate(ancre);
  const j = p && statut(p) !== 'terminee' ? ecartJours(aujourdhui(), p.date) : null;
  const titre = mode === 'semaine' ? plageSemaine(lundiDe(ancre)) : `${MOIS[d.getMonth()]} ${d.getFullYear()}`;
  return `<div class="titre-vue"><h1>Calendrier</h1>${j != null ? `<span class="compte">${j === 0 ? 'Jour J' : 'J-' + j} · ${esc(p.nom)}</span>` : ''}</div>
    <div class="commandes">
      <div class="segments"><button data-a="cal-mode" data-mode="semaine" class="${mode === 'semaine' ? 'actif' : ''}">Semaine</button>
        <button data-a="cal-mode" data-mode="mois" class="${mode === 'mois' ? 'actif' : ''}">Mois</button></div>
      <button class="bouton petit" data-a="cal-auj">Aujourd'hui</button>
    </div>
    <div class="navigation"><button class="icone" data-a="cal-bouger" data-sens="-1" aria-label="Précédent">‹</button><b>${titre}</b>
      <button class="icone" data-a="cal-bouger" data-sens="1" aria-label="Suivant">›</button></div>
    ${mode === 'semaine' ? vueSemaine() : vueMois()}`;
}

export const actions = {
  'cal-mode'(d) { mode = d.mode; return true; },
  'cal-auj'() { ancre = aujourdhui(); return true; },
  'cal-bouger'(d) {
    if (mode === 'semaine') ancre = ajouterJours(ancre, 7 * d.sens);
    else { const x = versDate(ancre); ancre = versISO(new Date(x.getFullYear(), x.getMonth() + Number(d.sens), 1)); }
    return true;
  },
};
