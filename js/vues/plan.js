// plan.js — le constructeur de plan : phases, semaines, séances prévues, modèles réutilisables.
import { etat, enregistrer, supprimer } from '../store.js';
import { prepActive, semainesDe, totauxPrevus, SPORTS, nbSemaines } from '../calc.js';
import { esc, aujourdhui, ajouterJours, ecartJours, plageSemaine, duree, km, lundiDe } from '../util.js';
import { feuille, toast, liste, pastilles } from '../ui.js';
import { ligneJour, resumeSeance, feuilleSeance } from '../seances.js';

let ouvertes = { prep: null, lundis: new Set() };     // semaines dépliées à l'écran

/** Bandeau des phases : chaque phase occupe une largeur proportionnelle à sa durée. */
function bandeauPhases(p, total) {
  const prevues = (p.phases || []).reduce((t, ph) => t + ph.semaines, 0);
  const faitesSemaines = Math.max(0, Math.min(total, Math.floor(ecartJours(lundiDe(p.debut), aujourdhui()) / 7) + 1));
  return `<section class="carte">
    <div class="titre-carte"><h2>Phases</h2><button class="bouton petit" data-a="phases">Modifier</button></div>
    ${p.phases?.length ? `<div class="phases">${p.phases.map((ph, i) => `<div style="flex:${ph.semaines}" class="ph${i % 4}"><b>${esc(ph.nom)}</b><small>${ph.semaines} sem.</small></div>`).join('')}
      ${prevues < total ? `<div style="flex:${total - prevues}" class="hors"><small>${total - prevues} sem. sans phase</small></div>` : ''}</div>
      <div class="jauge fine"><i style="width:${Math.round(faitesSemaines / total * 100)}%"></i></div>
      <p class="aide">Semaine ${Math.max(1, faitesSemaines)} sur ${total}.</p>` : '<p class="vide">Aucune phase définie.</p>'}
  </section>`;
}

function carteSemaine(sem) {
  const t = totauxPrevus(sem.seances), ouverte = ouvertes.lundis.has(sem.lundi), auj = aujourdhui();
  const faites = sem.activites.length;
  const resume = (t.n ? `${t.n} prévue${t.n > 1 ? 's' : ''} · ${duree(t.min)}${t.kmCourse ? ' · ' + km(t.kmCourse) : ''}` : 'rien de prévu')
    + (faites ? ` · ${faites} faite${faites > 1 ? 's' : ''}` : '');
  return `<section class="carte semaine ${sem.lundi <= auj && auj <= sem.fin ? 'courante' : ''}">
    <button class="semaine-tete" data-a="plier" data-lundi="${sem.lundi}" aria-expanded="${ouverte}">
      <span class="semaine-num">S${sem.num}</span>
      <span class="semaine-info"><b>${plageSemaine(sem.lundi)}</b><small>${sem.phase ? esc(sem.phase) + ' · ' : ''}${resume}</small></span>
      <span class="chevron">${ouverte ? '▴' : '▾'}</span>
    </button>
    ${ouverte ? Array.from({ length: 7 }, (_, i) => ligneJour(ajouterJours(sem.lundi, i))).join('')
      + `<div class="rangee"><button class="bouton petit" data-a="semaine-actions" data-lundi="${sem.lundi}">Dupliquer, déplacer ou vider la semaine</button></div>` : ''}
  </section>`;
}

export function rendre() {
  const p = prepActive();
  if (!p) return `<h1>Plan</h1><p class="vide">Crée une préparation pour construire ton plan.</p><button class="bouton principal" data-a="nouvelle-prep">Créer une préparation</button>`;
  const semaines = semainesDe(p), auj = aujourdhui();
  if (ouvertes.prep !== p.id) {                        // à l'ouverture : seule la semaine en cours est dépliée
    const courante = semaines.find(s => s.fin >= auj) || semaines[semaines.length - 1];
    ouvertes = { prep: p.id, lundis: new Set([courante.lundi]) };
  }
  return `<h1>Plan</h1>
    ${bandeauPhases(p, semaines.length)}
    ${semaines.map(carteSemaine).join('')}
    <section class="carte">
      <div class="titre-carte"><h2>Modèles de séances</h2><button class="bouton petit" data-a="nouveau-modele">Nouveau</button></div>
      ${etat.modeles.length ? etat.modeles.map(m => `<button class="ligne-modele" data-a="modele" data-id="${m.id}">
        <span>${SPORTS[m.sport].emoji} ${esc(m.titre)}</span><small>${esc(resumeSeance(m))}</small></button>`).join('')
      : '<p class="vide">Aucun modèle. Depuis une séance, touche « Enregistrer comme modèle ».</p>'}
    </section>`;
}

export const actions = {
  'plier'(d) { ouvertes.lundis.has(d.lundi) ? ouvertes.lundis.delete(d.lundi) : ouvertes.lundis.add(d.lundi); return true; },
  'nouveau-modele': () => feuilleSeance({ sport: 'course' }, true),
  'modele': d => feuilleSeance(etat.modeles.find(m => m.id === d.id), true),

  /** Feuille des phases : un nom et un nombre de semaines par ligne. */
  'phases'() {
    const p = prepActive(), total = nbSemaines(p), lignes = [...(p.phases || []), { nom: '', semaines: '' }, { nom: '', semaines: '' }];
    feuille('Phases de la préparation', `<p class="aide">La préparation dure ${total} semaines. Laisse une ligne vide pour la supprimer.</p>
      ${lignes.map((ph, i) => `<div class="deux large-etroit">
        <label class="champ"><span>Phase ${i + 1}</span><input name="nom${i}" value="${esc(ph.nom)}" placeholder="Ex. Base" autocomplete="off"></label>
        <label class="champ"><span>Semaines</span><input name="sem${i}" value="${ph.semaines}" inputmode="numeric"></label></div>`).join('')}`,
    async v => {
      const phases = lignes.map((_, i) => ({ nom: v[`nom${i}`].trim(), semaines: parseInt(v[`sem${i}`], 10) || 0 })).filter(ph => ph.nom && ph.semaines > 0);
      const somme = phases.reduce((t, ph) => t + ph.semaines, 0);
      if (somme > total) { toast(`Total ${somme} semaines : la préparation n'en compte que ${total}.`); return false; }
      await enregistrer('preparations', { ...p, phases });
    });
  },

  /** Feuille "semaine" : copier ou déplacer toutes ses séances vers une autre semaine, ou la vider. */
  'semaine-actions'(d) {
    const p = prepActive(), semaines = semainesDe(p), source = semaines.find(s => s.lundi === d.lundi);
    if (!source.seances.length) { toast('Cette semaine ne contient aucune séance prévue.'); return; }
    const autres = semaines.filter(s => s.lundi !== d.lundi);
    feuille(`Semaine ${source.num} · ${plageSemaine(source.lundi)}`, `
      ${pastilles('Que faire des séances prévues ?', 'quoi', [['dupliquer', 'Dupliquer'], ['deplacer', 'Déplacer'], ['vider', 'Vider la semaine']], 'dupliquer')}
      ${liste('Vers la semaine', 'cible', autres.map(s => [s.lundi, `S${s.num} · ${plageSemaine(s.lundi)}${s.seances.length ? ` (${s.seances.length} séance(s) déjà prévue(s))` : ''}`]),
        ajouterJours(d.lundi, 7))}
      <p class="aide">Les séances gardent leur jour de la semaine. Celles déjà présentes dans la semaine d'arrivée sont conservées.</p>`,
    async v => {
      if (v.quoi === 'vider') {
        if (!confirm(`Supprimer les ${source.seances.length} séances prévues de cette semaine ?`)) return false;
        for (const s of source.seances) await supprimer('seances', s.id);
        toast('Semaine vidée.'); return;
      }
      const decalage = ecartJours(d.lundi, v.cible);
      for (const s of source.seances) {
        if (v.quoi === 'deplacer') await enregistrer('seances', { ...s, date: ajouterJours(s.date, decalage) });
        else await enregistrer('seances', { ...s, id: null, activiteId: null, date: ajouterJours(s.date, decalage) });
      }
      ouvertes.lundis.add(v.cible);
      toast(v.quoi === 'deplacer' ? 'Semaine déplacée.' : 'Semaine dupliquée.');
    }, 'Valider');
  },
};
