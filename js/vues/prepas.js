// prepas.js — liste des préparations, fiche détaillée (historique), création / modification, comparaison.
import { etat, enregistrer, supprimer, regler } from '../store.js';
import { TYPES, SPORTS, ORDRE_SPORTS, LIB_STATUT, statut, prepActive, semainesDe, seancesDe, activitesDe, totaux, totauxPrevus, nbSemaines, phasesParDefaut, estTriathlon, rapprocher } from '../calc.js';
import { esc, aujourdhui, ajouterJours, lundiDe, ecartJours, dateLongue, dateCourte, plageSemaine, duree, km, virgule, nombre, somme } from '../util.js';
import { feuille, fermerFeuille, toast, rafraichir, champ, zoneTexte, liste } from '../ui.js';
import { barres, courbes } from '../charts.js';
import { puceActivite, puceSeance } from '../seances.js';

const trouver = id => etat.preparations.find(p => p.id === id);
let choixA = null, choixB = null;                     // préparations comparées

// ---------- Chiffres clés d'une préparation ----------
function bilanChiffre(p) {
  const semaines = semainesDe(p), t = totaux(activitesDe(p)), prevu = totauxPrevus(seancesDe(p));
  const kmSemaines = semaines.map(s => totaux(s.activites).kmCourse);
  return { semaines, t, prevu, n: semaines.length, kmMax: Math.max(0, ...kmSemaines), kmSemaines,
    heuresSemaines: semaines.map(s => totaux(s.activites).min / 60) };
}

// ---------- Liste ----------
function cartePrep(p) {
  const t = totaux(activitesDe(p)), s = statut(p), active = prepActive()?.id === p.id;
  return `<a class="carte prep" href="#prepa/${p.id}">
    <span class="prep-date">${esc(dateCourte(p.date))}<small>${p.date.slice(0, 4)}</small></span>
    <span class="prep-corps"><b>${esc(p.nom)}</b>
      <small>${esc(TYPES[p.type]?.nom || '')}${active ? ' · suivie' : ''}</small>
      <small>${s === 'terminee' ? (p.resultat ? 'Résultat ' + esc(p.resultat) : 'Résultat à saisir') : p.objectif ? 'Objectif ' + esc(p.objectif) : ''}
        · ${t.n} séances · ${virgule(t.kmCourse, 0)} km</small></span>
    <span class="chevron">›</span></a>`;
}
export function rendre() {
  const groupes = { 'en-cours': [], 'a-venir': [], 'terminee': [] };
  for (const p of [...etat.preparations].sort((a, b) => b.date.localeCompare(a.date))) groupes[statut(p)].push(p);
  return `<div class="titre-vue"><h1>Préparations</h1><button class="bouton petit principal" data-a="nouvelle-prep">Nouvelle</button></div>
    ${etat.preparations.length ? '' : '<p class="vide">Aucune préparation pour l\'instant.</p>'}
    ${Object.entries(groupes).filter(([, l]) => l.length).map(([s, l]) => `<h2 class="intertitre">${LIB_STATUT[s]}</h2>${l.map(cartePrep).join('')}`).join('')}
    ${etat.preparations.length > 1 ? '<a class="bouton" href="#comparer">Comparer deux préparations</a>' : ''}`;
}

// ---------- Fiche d'une préparation ----------
export function rendreDetail(id) {
  const p = trouver(id);
  if (!p) return '<p class="vide">Préparation introuvable.</p><a class="bouton" href="#prepas">Retour</a>';
  const b = bilanChiffre(p), s = statut(p), active = prepActive()?.id === p.id;
  const sports = ORDRE_SPORTS.filter(x => b.t.sport[x]);
  const graphique = barres({
    colonnes: b.semaines.map(w => { const t = totaux(w.activites); return { etiquette: `S${w.num}`, titre: `S${w.num} · ${plageSemaine(w.lundi)}`,
      valeurs: Object.fromEntries(ORDRE_SPORTS.map(x => [x, (t.sport[x]?.min || 0) / 60])), repere: totauxPrevus(w.seances).min / 60 }; }),
    series: ORDRE_SPORTS.map(x => ({ cle: x, nom: SPORTS[x].nom, couleur: `var(--c-${x})` })), fmt: v => v % 1 ? duree(v * 60) : `${v} h`,
  });
  return `<a class="retour" href="#prepas">‹ Préparations</a>
    <div class="titre-vue"><h1>${esc(p.nom)}</h1><span class="etiquette ${s}">${LIB_STATUT[s]}</span></div>
    <section class="carte fiche">
      <dl>
        <dt>Type</dt><dd>${esc(TYPES[p.type]?.nom || '')}${p.distanceKm && !TYPES[p.type]?.km ? ' · ' + km(p.distanceKm) : ''}</dd>
        <dt>Course</dt><dd>${esc(dateLongue(p.date))}</dd>
        <dt>Début</dt><dd>${esc(dateLongue(p.debut))} (${b.n} semaines)</dd>
        <dt>Objectif</dt><dd>${esc(p.objectif) || '—'}</dd>
        ${s === 'terminee' || p.resultat ? `<dt>Résultat</dt><dd><b>${esc(p.resultat) || 'à saisir'}</b></dd>` : ''}
      </dl>
      ${p.bilan ? `<h3>Bilan</h3><p class="citation">${esc(p.bilan)}</p>` : s === 'terminee' ? '<p class="vide">Pas encore de bilan écrit.</p>' : ''}
      <div class="rangee">
        <button class="bouton" data-a="modifier-prep" data-id="${p.id}">${s === 'terminee' ? 'Modifier, résultat et bilan' : 'Modifier'}</button>
        ${active ? '' : `<button class="bouton" data-a="suivre-prep" data-id="${p.id}">Afficher dans Accueil et Plan</button>`}
        <button class="bouton" data-a="reutiliser-prep" data-id="${p.id}">Réutiliser ce plan</button>
        <button class="bouton danger" data-a="supprimer-prep" data-id="${p.id}">Supprimer</button>
      </div>
    </section>
    <div class="tuiles">
      <div><small>Séances</small><b>${b.t.n}</b><span>${b.prevu.n ? `${b.prevu.faites} sur ${b.prevu.n} prévues` : 'réalisées'}</span></div>
      <div><small>Temps</small><b>${duree(b.t.min)}</b><span>${duree(b.t.min / b.n)} / sem.</span></div>
      <div><small>Course</small><b>${virgule(b.t.kmCourse, 0)} km</b><span>max ${virgule(b.kmMax, 0)} km / sem.</span></div>
      <div><small>Charge</small><b>${Math.round(b.t.charge / b.n)}</b><span>par semaine</span></div>
    </div>
    <section class="carte"><h2>Volume par semaine</h2>${graphique}
      ${sports.length ? `<p class="aide">${sports.map(x => `${SPORTS[x].nom} : ${b.t.sport[x].n} séance${b.t.sport[x].n > 1 ? 's' : ''}, ${duree(b.t.sport[x].min)}${b.t.sport[x].km ? ', ' + km(b.t.sport[x].km) : ''}`).join(' · ')}</p>` : ''}</section>
    <section class="carte"><h2>Semaine par semaine</h2>
      ${b.semaines.map(w => { const t = totaux(w.activites), pr = w.seances.filter(x => !x.activiteId);
        return `<details class="semaine-detail"><summary><b>S${w.num}</b> ${plageSemaine(w.lundi)}<small>${w.phase ? esc(w.phase) + ' · ' : ''}${t.n} séance${t.n > 1 ? 's' : ''}${t.kmCourse ? ' · ' + km(t.kmCourse) : ''}${w.seances.length ? ` · ${w.seances.length} prévue(s)` : ''}</small></summary>
          <div class="jour-items">${w.activites.map(puceActivite).join('') + pr.map(puceSeance).join('') || '<span class="rien">Aucune séance.</span>'}</div></details>`; }).join('')}
    </section>`;
}

// ---------- Création / modification ----------
function feuillePrep(p) {
  const neuve = !p.id, auj = aujourdhui();
  feuille(neuve ? 'Nouvelle préparation' : 'Modifier la préparation', `
    ${champ('Course cible', 'nom', p.nom, 'placeholder="Ex. 10 km de Córdoba" required autocomplete="off"')}
    ${liste('Type', 'type', Object.entries(TYPES).map(([k, t]) => [k, t.nom]), p.type || 'course-10k')}
    <div class="deux">${champ('Date de la course', 'date', p.date, 'type="date" required')}${champ('Début de la préparation', 'debut', p.debut || lundiDe(auj), 'type="date" required')}</div>
    <div class="deux">${champ('Distance (km)', 'distanceKm', p.distanceKm, 'inputmode="decimal" placeholder="auto"')}${champ('Objectif chiffré', 'objectif', p.objectif, 'placeholder="Ex. 38:40" autocomplete="off"')}</div>
    ${neuve ? '<p class="aide">Les phases (base, développement, spécifique, affûtage) sont proposées automatiquement ; tu pourras les ajuster dans Plan.</p>' : `
      ${champ('Résultat final', 'resultat', p.resultat, 'placeholder="Ex. 39:12" autocomplete="off"')}
      ${zoneTexte('Bilan', 'bilan', p.bilan, 5, 'placeholder="Ce qui a marché, ce que tu changerais la prochaine fois…"')}`}`,
  async v => {
    if (!v.nom.trim() || !v.date || !v.debut) { toast('Indique le nom, la date de la course et le début.'); return false; }
    if (v.debut > v.date) { toast('Le début doit être avant la course.'); return false; }
    const q = { ...p, nom: v.nom.trim(), type: v.type, date: v.date, debut: v.debut, distanceKm: nombre(v.distanceKm) ?? TYPES[v.type].km,
      sports: TYPES[v.type].sports, objectif: v.objectif.trim(), resultat: (v.resultat ?? p.resultat ?? '').trim(), bilan: (v.bilan ?? p.bilan ?? '').trim() };
    if (neuve || !q.phases) q.phases = phasesParDefaut(nbSemaines(q));
    await enregistrer('preparations', q);
    if (neuve) { if (statut(q) !== 'terminee') await regler({ prepActive: q.id }); location.hash = '#plan'; }
  }, neuve ? 'Créer la préparation' : 'Enregistrer');
}

// ---------- Comparaison ----------
export function rendreComparaison() {
  const l = [...etat.preparations].sort((a, b) => b.date.localeCompare(a.date));
  if (l.length < 2) return '<a class="retour" href="#prepas">‹ Préparations</a><h1>Comparer</h1><p class="vide">Il faut au moins deux préparations.</p>';
  let a = trouver(choixA) || l[0], b = trouver(choixB) || l.find(p => p.id !== a.id && p.type === a.type) || l.find(p => p.id !== a.id);
  const ba = bilanChiffre(a), bb = bilanChiffre(b), tri = estTriathlon(a) || estTriathlon(b);
  const options = l.map(p => [p.id, `${p.nom} (${p.date.slice(0, 4)})`]);
  const ligne = (nom, f) => `<tr><th>${nom}</th><td>${f(a, ba)}</td><td>${f(b, bb)}</td></tr>`;
  // Les deux préparations sont alignées sur la course : la dernière colonne est la semaine de course.
  const n = Math.max(ba.n, bb.n), cle = tri ? 'heuresSemaines' : 'kmSemaines';
  const aligner = x => Array.from({ length: n }, (_, i) => x[cle][i - (n - x.n)] ?? null);
  const graphique = courbes({
    colonnes: Array.from({ length: n }, (_, i) => ({ etiquette: i === n - 1 ? 'course' : `S-${n - 1 - i}`, titre: i === n - 1 ? 'Semaine de course' : `${n - 1 - i} sem. avant la course` })),
    series: [{ nom: `A · ${a.nom}`, etiquette: 'A', couleur: 'var(--c-course)', valeurs: aligner(ba) }, { nom: `B · ${b.nom}`, etiquette: 'B', couleur: 'var(--c-velo)', valeurs: aligner(bb) }],
    fmt: v => tri ? duree(v * 60) : `${virgule(v, 0)} km`,
  });
  return `<a class="retour" href="#prepas">‹ Préparations</a><h1>Comparer</h1>
    <div class="deux">${liste('Préparation A', 'a', options, a.id, 'data-c="comparer-choix"')}${liste('Préparation B', 'b', options, b.id, 'data-c="comparer-choix"')}</div>
    <section class="carte"><div class="defile"><table class="comparaison">
      <tr><th></th><th>A · ${esc(a.nom)}</th><th>B · ${esc(b.nom)}</th></tr>
      ${ligne('Course', p => esc(dateCourte(p.date)) + ' ' + p.date.slice(0, 4))}
      ${ligne('Objectif', p => esc(p.objectif) || '—')}
      ${ligne('Résultat', p => `<b>${esc(p.resultat) || '—'}</b>`)}
      ${ligne('Durée', (p, x) => `${x.n} sem.`)}
      ${ligne('Séances', (p, x) => x.t.n)}
      ${ligne('Séances / sem.', (p, x) => virgule(x.t.n / x.n))}
      ${ligne('Temps total', (p, x) => duree(x.t.min))}
      ${ligne('Km course', (p, x) => virgule(x.t.kmCourse, 0))}
      ${ligne('Km course / sem.', (p, x) => virgule(x.t.kmCourse / x.n))}
      ${ligne('Plus grosse semaine', (p, x) => virgule(x.kmMax, 0) + ' km')}
      ${ligne('Charge / sem.', (p, x) => Math.round(x.t.charge / x.n))}
      ${ligne('Plan suivi', (p, x) => x.prevu.n ? Math.round(x.prevu.faites / x.prevu.n * 100) + ' %' : '—')}
    </table></div></section>
    <section class="carte"><h2>${tri ? 'Heures' : 'Km de course'} par semaine, alignés sur la course</h2>${graphique}</section>`;
}

// ---------- Actions ----------
export const actions = {
  'nouvelle-prep': () => feuillePrep({}),
  'modifier-prep': d => feuillePrep(trouver(d.id)),
  async 'suivre-prep'(d) { await regler({ prepActive: d.id }); toast('Préparation affichée dans Accueil, Plan et Suivi.'); return true; },
  async 'supprimer-prep'(d) {
    const p = trouver(d.id), n = seancesDe(p).length;
    if (!confirm(`Supprimer « ${p.nom} » et ses ${n} séances prévues ? Les séances réalisées sont conservées.`)) return;
    for (const s of seancesDe(p)) await supprimer('seances', s.id);
    await supprimer('preparations', p.id);
    if (etat.reglages.prepActive === p.id) await regler({ prepActive: null });
    location.hash = '#prepas'; toast('Préparation supprimée.');
  },
  /** Copie le plan (phases + séances prévues) vers une nouvelle course : tout est décalé pour finir à la nouvelle date. */
  'reutiliser-prep'(d) {
    const p = trouver(d.id);
    feuille('Réutiliser ce plan', `<p class="aide">Les phases et les ${seancesDe(p).length} séances prévues de « ${esc(p.nom)} » sont recopiées et décalées pour arriver à la nouvelle date de course.</p>
      ${champ('Nouvelle course', 'nom', '', 'required autocomplete="off"')}${champ('Date de la course', 'date', '', 'type="date" required')}`,
    async v => {
      if (!v.nom.trim() || !v.date) { toast('Indique le nom et la date.'); return false; }
      const decalage = ecartJours(p.date, v.date);
      const q = await enregistrer('preparations', { ...p, id: null, nom: v.nom.trim(), date: v.date, debut: ajouterJours(p.debut, decalage), resultat: '', bilan: '' });
      for (const s of seancesDe(p)) await enregistrer('seances', { ...s, id: null, prepId: q.id, activiteId: null, date: ajouterJours(s.date, decalage) });
      await rapprocher(); await regler({ prepActive: q.id }); location.hash = '#plan';
    }, 'Créer la préparation');
  },
  /** Feuille de l'en-tête : choisir la préparation affichée. */
  'choisir-prep'() {
    const l = [...etat.preparations].sort((a, b) => b.date.localeCompare(a.date)), active = prepActive();
    feuille('Préparation affichée', `${l.map(p => `<button type="button" class="ligne-modele ${p.id === active?.id ? 'choisie' : ''}" data-a="suivre-prep-fermer" data-id="${p.id}">
        <span>${esc(p.nom)}</span><small>${esc(dateCourte(p.date))} ${p.date.slice(0, 4)} · ${LIB_STATUT[statut(p)]}</small></button>`).join('') || '<p class="vide">Aucune préparation.</p>'}
      <div class="rangee"><button type="button" class="bouton principal" data-a="nouvelle-prep">Nouvelle préparation</button></div>`);
  },
  async 'suivre-prep-fermer'(d) { await regler({ prepActive: d.id }); fermerFeuille(); return true; },
  'comparer-choix'(d, el) { if (el.name === 'a') choixA = el.value; else choixB = el.value; return true; },
};
