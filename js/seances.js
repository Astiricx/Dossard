// seances.js — ce qui est partagé par plusieurs vues : l'affichage d'une journée (prévu / réalisé)
// et les deux feuilles de saisie : séance PRÉVUE (le plan) et activité RÉALISÉE (avec ressenti).
import { etat, enregistrer, supprimer } from './store.js';
import { SPORTS, ZONES, rpeEstime, prepPour, rapprocher } from './calc.js';
import { esc, duree, km, allure, dateLongue, ajouterJours, aujourdhui, nombre, JOURS, indexJour, versDate } from './util.js';
import { feuille, fermerFeuille, toast, rafraichir, champ, zoneTexte, liste, pastilles } from './ui.js';

const trouver = (collection, id) => etat[collection].find(x => x.id === id);
const OPTIONS_SPORT = sports => sports.map(s => [s, `${SPORTS[s].emoji} ${SPORTS[s].nom}`]);

// ---------- Affichage ----------
export const resumeSeance = s => [s.dureeMin && duree(s.dureeMin), s.distanceKm && km(s.distanceKm), s.zone && `Z${s.zone}`].filter(Boolean).join(' · ');
export const resumeActivite = a => [a.distanceKm && km(a.distanceKm), a.dureeMin && duree(a.dureeMin),
  a.sport === 'course' && allure(a.dureeMin, a.distanceKm)].filter(Boolean).join(' · ');

/** Séance prévue : contour pointillé. Devient "faite" (✓) quand une activité lui est reliée. */
export function puceSeance(s) {
  const a = s.activiteId && trouver('activites', s.activiteId);
  const etatSeance = a ? 'fait' : (s.date < aujourdhui() && s.sport !== 'repos' ? 'manque' : '');
  return `<button class="puce prevu ${etatSeance}" style="--c:var(--c-${s.sport})" data-a="seance" data-id="${s.id}">
    <span class="puce-titre">${SPORTS[s.sport].emoji} ${esc(s.titre || SPORTS[s.sport].nom)}</span>
    <span class="puce-detail">${esc(resumeSeance(s))}${a ? `<b>✓ fait : ${esc(resumeActivite(a))}</b>` : etatSeance === 'manque' ? '<i>non faite</i>' : ''}</span>
  </button>`;
}
/** Activité réalisée non reliée à une séance prévue : fond plein. */
export function puceActivite(a) {
  return `<button class="puce realise" style="--c:var(--c-${a.sport})" data-a="activite" data-id="${a.id}">
    <span class="puce-titre">${a.course ? '🏁' : SPORTS[a.sport].emoji} ${esc(a.titre || SPORTS[a.sport].nom)}</span>
    <span class="puce-detail">${esc(resumeActivite(a))}${a.rpe ? ` · effort ${a.rpe}/10` : ''}</span>
  </button>`;
}
/** Ce qu'il y a un jour donné : séances prévues + activités qui ne sont reliées à aucune séance. */
export function elementsDuJour(date) {
  const seances = etat.seances.filter(s => s.date === date);
  const reliees = new Set(etat.seances.map(s => s.activiteId).filter(Boolean));
  return { seances, activites: etat.activites.filter(a => a.date === date && !reliees.has(a.id)), course: etat.preparations.find(p => p.date === date) };
}
export function contenuJour(date) {
  const { seances, activites, course } = elementsDuJour(date);
  return (course ? `<span class="puce cible">🏁 ${esc(course.nom)}</span>` : '') + seances.map(puceSeance).join('') + activites.map(puceActivite).join('');
}
/** Une ligne "jour" : la date à gauche, les séances à droite, un bouton + pour ajouter. */
export function ligneJour(date) {
  return `<div class="jour ${date === aujourdhui() ? 'auj' : ''}">
    <div class="jour-date"><span>${JOURS[indexJour(date)]}</span><b>${versDate(date).getDate()}</b></div>
    <div class="jour-items">${contenuJour(date) || '<span class="rien">—</span>'}</div>
    <button class="plus" data-a="jour" data-date="${date}" aria-label="Ajouter le ${esc(dateLongue(date))}">+</button>
  </div>`;
}

// ---------- Feuille : séance prévue (ou modèle) ----------
const lireSeance = v => ({ sport: v.sport, titre: v.titre.trim(), dureeMin: nombre(v.dureeMin), distanceKm: nombre(v.distanceKm), zone: Number(v.zone) || null, notes: v.notes.trim() });

export function feuilleSeance(s, estModele = false) {
  const neuve = !s.id, a = s.activiteId && trouver('activites', s.activiteId);
  const html = `
    ${neuve && !estModele && etat.modeles.length ? `<div class="champ"><span>Partir d'un modèle</span><div class="pastilles">${etat.modeles.map(m =>
      `<button type="button" class="pastille-bouton" data-a="appliquer-modele" data-id="${m.id}">${SPORTS[m.sport].emoji} ${esc(m.titre)}</button>`).join('')}</div></div>` : ''}
    ${pastilles('Sport', 'sport', OPTIONS_SPORT(['course', 'velo', 'natation', 'renfo', 'repos']), s.sport || 'course')}
    ${champ('Titre', 'titre', s.titre, 'placeholder="Ex. 5 × 1000 m récup 1 min 30" autocomplete="off"')}
    <div class="deux">${champ('Durée (min)', 'dureeMin', s.dureeMin, 'inputmode="decimal"')}${champ('Distance (km)', 'distanceKm', s.distanceKm, 'inputmode="decimal"')}</div>
    ${pastilles('Intensité', 'zone', [['', '—'], ...ZONES.map((z, i) => [i + 1, `Z${i + 1}`])], s.zone || '')}
    <p class="aide">${ZONES.map((z, i) => `Z${i + 1} ${z.nom.toLowerCase()}`).join(' · ')}</p>
    ${estModele ? '' : champ('Date (change-la pour déplacer la séance)', 'date', s.date, 'type="date" required')}
    ${zoneTexte('Notes', 'notes', s.notes)}
    ${neuve ? '' : `<div class="rangee">
      ${estModele ? '' : a ? `<button type="button" class="bouton" data-a="activite" data-id="${a.id}">Voir la séance réalisée</button>
          <button type="button" class="bouton" data-a="seance-delier" data-id="${s.id}">Délier</button>`
        : s.sport !== 'repos' ? `<button type="button" class="bouton" data-a="seance-faite" data-id="${s.id}">✓ C'est fait</button>` : ''}
      ${estModele ? '' : `<button type="button" class="bouton" data-a="seance-dupliquer" data-id="${s.id}">Dupliquer (+7 jours)</button>
      <button type="button" class="bouton" data-a="seance-modele">Enregistrer comme modèle</button>`}
      <button type="button" class="bouton danger" data-a="${estModele ? 'modele-supprimer' : 'seance-supprimer'}" data-id="${s.id}">Supprimer</button>
    </div>`}`;
  feuille(estModele ? (neuve ? 'Nouveau modèle' : 'Modèle de séance') : (neuve ? 'Nouvelle séance prévue' : 'Séance prévue'), html, async v => {
    if (estModele) { await enregistrer('modeles', { ...s, ...lireSeance(v), titre: v.titre.trim() || SPORTS[v.sport].nom }); return; }
    if (!v.date) { toast('Indique une date.'); return false; }
    await enregistrer('seances', { ...s, ...lireSeance(v), date: v.date });
    await rapprocher();
  });
}

// ---------- Feuille : activité réalisée + ressenti ----------
const FATIGUE = [[1, 'Frais'], [2, 'Bien'], [3, 'Moyen'], [4, 'Fatigué'], [5, 'Épuisé']];

export function feuilleActivite(a) {
  const neuve = !a.id;
  const liee = a.id && etat.seances.find(s => s.activiteId === a.id);
  const candidates = etat.seances.filter(s => s.sport !== 'repos' && (!s.activiteId || s.activiteId === a.id)
    && s.date >= ajouterJours(a.date, -2) && s.date <= ajouterJours(a.date, 2));
  const html = `
    ${a.source === 'strava' ? `<p class="aide">Importée de Strava. <a href="https://www.strava.com/activities/${esc(a.stravaId)}" target="_blank" rel="noopener">Ouvrir dans Strava</a></p>` : ''}
    ${pastilles('Sport', 'sport', OPTIONS_SPORT(['course', 'velo', 'natation', 'renfo', 'autre']), a.sport || 'course')}
    ${champ('Titre', 'titre', a.titre, 'autocomplete="off"')}
    ${champ('Date', 'date', a.date, 'type="date" required')}
    <div class="trois">${champ('Durée (min)', 'dureeMin', a.dureeMin, 'inputmode="decimal"')}${champ('Distance (km)', 'distanceKm', a.distanceKm, 'inputmode="decimal"')}${champ('D+ (m)', 'deniveleM', a.deniveleM, 'inputmode="numeric"')}</div>
    ${pastilles('Effort ressenti (1 facile, 10 maximal)', 'rpe', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, n]), a.rpe || '')}
    ${a.rpe || neuve ? '' : `<p class="aide">Sans note de ta part, l'app estime l'effort à ${rpeEstime(a)}/10.</p>`}
    ${pastilles('Fatigue après la séance', 'fatigue', FATIGUE, a.fatigue || '')}
    ${zoneTexte('Ressenti', 'ressenti', a.ressenti, 2, 'placeholder="Jambes, sommeil, météo, douleurs…"')}
    ${a.notes ? `<div class="champ"><span>Description Strava</span><p class="citation">${esc(a.notes)}</p></div>` : ''}
    ${candidates.length ? liste('Séance prévue correspondante', 'seanceId', [['', 'Aucune'], ...candidates.map(s => [s.id, `${dateLongue(s.date)} · ${s.titre || SPORTS[s.sport].nom}`])], liee?.id) : ''}
    <label class="case"><input type="checkbox" name="course" ${a.course ? 'checked' : ''}> C'est une course officielle</label>
    ${neuve ? '' : `<div class="rangee"><button type="button" class="bouton danger" data-a="activite-supprimer" data-id="${a.id}">Supprimer</button></div>`}`;
  feuille(neuve ? 'Séance réalisée' : 'Séance réalisée', html, async v => {
    if (!v.date) { toast('Indique une date.'); return false; }
    const b = await enregistrer('activites', {
      ...a, source: a.source || 'manuel', sport: v.sport, titre: v.titre.trim(), date: v.date,
      dureeMin: nombre(v.dureeMin), distanceKm: nombre(v.distanceKm), deniveleM: nombre(v.deniveleM),
      rpe: Number(v.rpe) || null, fatigue: Number(v.fatigue) || null, ressenti: v.ressenti.trim(), course: !!v.course,
    });
    if ('seanceId' in v) {                                  // met à jour le lien prévu <-> réalisé
      for (const s of etat.seances.filter(s => s.activiteId === b.id && s.id !== v.seanceId)) { s.activiteId = null; await enregistrer('seances', s); }
      const cible = v.seanceId && trouver('seances', v.seanceId);
      if (cible) { cible.activiteId = b.id; await enregistrer('seances', cible); }
    } else if (neuve) await rapprocher();
  });
}

/** Feuille d'une journée : ce qui est prévu, ce qui est fait, et les deux façons d'ajouter. */
export function feuilleJour(date) {
  feuille(dateLongue(date), `<div class="jour-items">${contenuJour(date) || '<p class="vide">Rien ce jour-là.</p>'}</div>
    <div class="rangee">
      <button type="button" class="bouton principal" data-a="nouvelle-seance" data-date="${date}">Prévoir une séance</button>
      <button type="button" class="bouton" data-a="nouvelle-activite" data-date="${date}">Noter une séance réalisée</button>
    </div>`);
}

// ---------- Actions (déclenchées par les attributs data-a) ----------
export const actions = {
  'jour': d => feuilleJour(d.date),
  'seance': d => feuilleSeance(trouver('seances', d.id)),
  'activite': d => feuilleActivite(trouver('activites', d.id)),
  'nouvelle-seance'(d) {
    const p = prepPour(d.date);
    if (!p) { fermerFeuille(); toast("Crée d'abord une préparation (onglet Prépas)."); return; }
    feuilleSeance({ prepId: p.id, date: d.date, sport: 'course' });
  },
  'nouvelle-activite': d => feuilleActivite({ date: d.date || aujourdhui(), sport: 'course' }),
  'appliquer-modele'(d, el) {                               // recopie le modèle dans le formulaire ouvert
    const m = trouver('modeles', d.id), f = el.closest('form');
    f.querySelector(`[name=sport][value="${m.sport}"]`).checked = true;
    f.titre.value = m.titre || ''; f.dureeMin.value = m.dureeMin ?? ''; f.distanceKm.value = m.distanceKm ?? ''; f.notes.value = m.notes || '';
    f.querySelector(`[name=zone][value="${m.zone || ''}"]`).checked = true;
  },
  async 'seance-faite'(d) {                                 // crée l'activité réalisée à partir du prévu, puis demande le ressenti
    const s = trouver('seances', d.id);
    const a = await enregistrer('activites', { date: s.date, sport: s.sport, titre: s.titre, dureeMin: s.dureeMin, distanceKm: s.distanceKm, source: 'manuel' });
    s.activiteId = a.id; await enregistrer('seances', s);
    rafraichir(); feuilleActivite(a);
  },
  async 'seance-delier'(d) {
    const s = trouver('seances', d.id); s.activiteId = null; await enregistrer('seances', s);
    fermerFeuille(); rafraichir(); toast('Séance déliée.');
  },
  async 'seance-dupliquer'(d) {
    const s = trouver('seances', d.id), date = ajouterJours(s.date, 7);
    await enregistrer('seances', { ...s, id: null, activiteId: null, date });
    fermerFeuille(); rafraichir(); toast(`Copie ajoutée le ${dateLongue(date)}.`);
  },
  async 'seance-modele'(d, el) {
    const v = Object.fromEntries(new FormData(el.closest('form'))), m = lireSeance(v);
    await enregistrer('modeles', { ...m, titre: m.titre || SPORTS[m.sport].nom });
    toast('Modèle enregistré.');
  },
  async 'seance-supprimer'(d) { await supprimer('seances', d.id); fermerFeuille(); rafraichir(); toast('Séance supprimée.'); },
  async 'modele-supprimer'(d) { await supprimer('modeles', d.id); fermerFeuille(); rafraichir(); toast('Modèle supprimé.'); },
  async 'activite-supprimer'(d) {
    if (!confirm('Supprimer cette séance réalisée ?')) return;
    for (const s of etat.seances.filter(s => s.activiteId === d.id)) { s.activiteId = null; await enregistrer('seances', s); }
    await supprimer('activites', d.id); fermerFeuille(); rafraichir(); toast('Séance supprimée.');
  },
};
