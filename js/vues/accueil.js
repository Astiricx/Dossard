// accueil.js — l'écran d'accueil : le dossard (compte à rebours), la semaine en cours, la régularité.
import { etat } from '../store.js';
import { prepActive, statut, semainesDe, totaux, totauxPrevus, activitesEntre, alerteCharge, LIB_ALERTE, serieSemaines, TYPES } from '../calc.js';
import { esc, aujourdhui, ajouterJours, lundiDe, ecartJours, dateLongue, duree, km, virgule, plageSemaine } from '../util.js';
import { ligneJour, puceActivite } from '../seances.js';

/** Le dossard : nom de la course, compte à rebours, date et objectif. */
function dossard(p) {
  const s = statut(p), j = ecartJours(aujourdhui(), p.date);
  const numero = s === 'terminee' ? (p.resultat || 'Terminée') : j === 0 ? 'Jour J' : `J-${j}`;
  return `<a class="dossard" href="#prepa/${p.id}">
    <i class="trou hg"></i><i class="trou hd"></i><i class="trou bg"></i><i class="trou bd"></i>
    <span class="dossard-haut">${esc(p.nom)}</span>
    <span class="dossard-num">${esc(numero)}</span>
    <span class="dossard-bas"><span>${esc(dateLongue(p.date))}</span><span>${p.objectif ? 'Objectif ' + esc(p.objectif) : esc(TYPES[p.type]?.nom || '')}</span></span>
  </a>`;
}

/** Douze carrés : une semaine chacun, plus clair = plus de séances. */
function regularite() {
  const lundi = lundiDe(aujourdhui());
  const cases = Array.from({ length: 12 }, (_, i) => {
    const l = ajouterJours(lundi, -7 * (11 - i)), n = activitesEntre(l, ajouterJours(l, 6)).length;
    return `<i class="n${Math.min(n, 4)}" title="${esc(plageSemaine(l))} : ${n} séance(s)"></i>`;
  }).join('');
  const serie = serieSemaines();
  return `<section class="carte">
    <h2>Régularité</h2>
    <p class="grand">${serie} <small>semaine${serie > 1 ? 's' : ''} d'affilée avec au moins 2 séances</small></p>
    <div class="regularite" aria-hidden="true">${cases}</div>
    <p class="aide">Les 12 dernières semaines. Plus le carré est clair, plus tu as fait de séances.</p>
  </section>`;
}

export function rendre() {
  const p = prepActive();
  if (!p) return `<section class="accueil-vide">
      <h1>Dossard</h1>
      <p>Prépare ta prochaine course, suis ta charge semaine après semaine et garde l'historique de chaque préparation.</p>
      <button class="bouton principal" data-a="nouvelle-prep">Créer ma première préparation</button>
      <button class="bouton" data-a="importer">Importer un fichier (sauvegarde ou historique Strava)</button>
    </section>`;

  const auj = aujourdhui(), lundi = lundiDe(auj), dimanche = ajouterJours(lundi, 6);
  const semaine = semainesDe(p).find(s => s.lundi === lundi);
  const prevu = totauxPrevus(etat.seances.filter(s => s.date >= lundi && s.date <= dimanche));
  const fait = totaux(activitesEntre(lundi, dimanche));
  const alerte = alerteCharge(lundi);
  const aNoter = etat.activites.filter(a => !a.rpe && a.date >= ajouterJours(auj, -10)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const sauvegarde = etat.reglages.derniereSauvegarde;
  const retard = etat.activites.length && (!sauvegarde || ecartJours(sauvegarde.slice(0, 10), auj) > 14);
  const avancement = prevu.n ? Math.round(prevu.faites / prevu.n * 100) : 0;

  return `${dossard(p)}
    ${statut(p) === 'terminee' && !p.resultat ? `<section class="carte"><p>La course est passée. Note ton résultat et ton bilan pour clore cette préparation.</p>
      <button class="bouton principal" data-a="modifier-prep" data-id="${p.id}">Ajouter le résultat et le bilan</button></section>` : ''}
    ${alerte.niveau ? `<section class="carte alerte ${alerte.niveau}"><h2>⚠ ${LIB_ALERTE[alerte.niveau]}</h2>
      <p>Cette semaine : charge ${alerte.charge}, pour ${alerte.moyenne} en moyenne sur les 4 semaines précédentes. Allège une séance ou ajoute un jour de repos.</p></section>` : ''}
    <section class="carte">
      <h2>${semaine ? `Semaine ${semaine.num} sur ${semainesDe(p).length}${semaine.phase ? ' · ' + esc(semaine.phase) : ''}` : 'Cette semaine'}</h2>
      <p class="sous-titre">${prevu.n ? `${prevu.faites} séance${prevu.faites > 1 ? 's' : ''} faite${prevu.faites > 1 ? 's' : ''} sur ${prevu.n} prévue${prevu.n > 1 ? 's' : ''}` : `${fait.n} séance${fait.n > 1 ? 's' : ''}`}
        · ${duree(fait.min)}${fait.kmCourse ? ' · ' + km(fait.kmCourse) + ' de course' : ''}</p>
      ${prevu.n ? `<div class="jauge" role="img" aria-label="${avancement} % des séances prévues faites"><i style="width:${avancement}%"></i></div>` : ''}
      ${Array.from({ length: 7 }, (_, i) => ligneJour(ajouterJours(lundi, i))).join('')}
    </section>
    ${aNoter.length ? `<section class="carte"><h2>Comment c'était ?</h2><p class="sous-titre">Note l'effort et la fatigue : la charge sera plus juste.</p>
      <div class="jour-items">${aNoter.map(puceActivite).join('')}</div></section>` : ''}
    ${regularite()}
    ${retard ? `<section class="carte"><p>${sauvegarde ? `Dernière sauvegarde il y a ${ecartJours(sauvegarde.slice(0, 10), auj)} jours.` : "Tes données n'ont jamais été sauvegardées."}</p>
      <button class="bouton" data-a="exporter">Sauvegarder mes données</button></section>` : ''}`;
}
