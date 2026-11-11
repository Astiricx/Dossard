// charts.js — deux graphiques en SVG, sans bibliothèque : barres empilées et courbes.
// Chaque graphique a une légende (dès 2 séries) et une ligne de lecture : on touche une colonne
// pour lire ses valeurs exactes (l'équivalent tactile de l'info-bulle).
import { esc } from './util.js';

const L = 340, H = 176, M = { haut: 14, droite: 10, bas: 22, gauche: 34 };
const ZL = L - M.gauche - M.droite, ZH = H - M.haut - M.bas;
const r1 = v => Math.round(v * 10) / 10;

/** Graduation "ronde" : renvoie le maximum de l'axe et le pas entre deux lignes. */
function echelle(max) {
  if (!(max > 0)) return { max: 1, pas: 1 };
  const brut = max / 3, p = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= brut);
  return { max: Math.ceil(max / pas - 1e-9) * pas, pas };
}
/** Rectangle dont seuls les coins du haut sont arrondis. */
const barreArrondie = (x, y, l, h, r) => {
  r = Math.min(r, h, l / 2);
  return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + l - r)}Q${r1(x + l)},${r1(y)} ${r1(x + l)},${r1(y + r)}V${r1(y + h)}Z`;
};
const legende = entrees => entrees.length < 2 ? '' :
  `<div class="legende">${entrees.map(e => `<span><i class="${e.trait ? 'trait' : ''}" style="background:${e.couleur}"></i>${esc(e.nom)}</span>`).join('')}</div>`;
const etiquettesX = (colonnes, x) => {
  const pas = Math.ceil(colonnes.length / 6);
  return colonnes.map((c, i) => i % pas ? '' : `<text class="axe" x="${r1(x(i))}" y="${H - 6}" text-anchor="middle">${esc(c.etiquette)}</text>`).join('');
};
const zonesTactiles = (colonnes, x, largeur, lectures) => colonnes.map((c, i) =>
  `<rect class="touche" x="${r1(x(i) - largeur / 2)}" y="${M.haut}" width="${r1(largeur)}" height="${ZH}" data-a="lire-graphique" data-lecture="${esc(lectures[i])}"/>`).join('');
const cadre = (svg, entreesLegende, aide) =>
  `<div class="graphique">${legende(entreesLegende)}<svg viewBox="0 0 ${L} ${H}" role="img">${svg}</svg><p class="lecture">${esc(aide)}</p></div>`;

/**
 * Barres empilées.
 * colonnes : [{ etiquette, titre, valeurs: {cle: nombre}, repere (valeur prévue), alerte ('moderee'|'forte') }]
 * series   : [{ cle, nom, couleur }]  — l'ordre est fixe, la couleur suit le sport
 * ligne    : valeurs d'une courbe superposée sur le MÊME axe (ex. moyenne), nomLigne son nom
 */
export function barres({ colonnes, series, fmt = v => v, nomRepere = 'prévu', ligne, nomLigne }) {
  const total = c => series.reduce((s, q) => s + (c.valeurs[q.cle] || 0), 0);
  const max = Math.max(0, ...colonnes.map(c => Math.max(total(c), c.repere || 0)), ...(ligne || []).map(v => v || 0));
  if (!max) return '<p class="vide">Pas encore de données sur cette période.</p>';
  const e = echelle(max), n = colonnes.length, pas = ZL / n, lb = Math.max(3, Math.min(22, pas - 3));
  const y = v => M.haut + ZH - v / e.max * ZH, x = i => M.gauche + (i + 0.5) * pas;
  let svg = '';
  for (let v = 0; v <= e.max + 1e-9; v += e.pas)
    svg += `<line class="grille" x1="${M.gauche}" x2="${L - M.droite}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="axe" x="${M.gauche - 5}" y="${r1(y(v) + 3.5)}" text-anchor="end">${esc(fmt(v))}</text>`;
  const lectures = [];
  colonnes.forEach((c, i) => {
    const gauche = x(i) - lb / 2, actives = series.filter(q => c.valeurs[q.cle] > 0);
    let cumul = 0;
    actives.forEach((q, k) => {
      const dernier = k === actives.length - 1, v = c.valeurs[q.cle];
      const haut = y(cumul + v) + (dernier ? 0 : 2), h = Math.max(0.5, y(cumul) - haut);   // 2 px de vide entre deux segments
      svg += dernier ? `<path d="${barreArrondie(gauche, haut, lb, h, 4)}" style="fill:${q.couleur}"/>`
        : `<rect x="${r1(gauche)}" y="${r1(haut)}" width="${r1(lb)}" height="${r1(h)}" style="fill:${q.couleur}"/>`;
      cumul += v;
    });
    if (c.repere) svg += `<line class="repere" x1="${r1(gauche)}" x2="${r1(gauche + lb)}" y1="${r1(y(c.repere))}" y2="${r1(y(c.repere))}"/>`;
    if (c.alerte) svg += `<text class="alerte-${c.alerte}" x="${r1(x(i))}" y="${r1(y(Math.max(cumul, c.repere || 0)) - 4)}" text-anchor="middle">!</text>`;
    lectures.push(`${c.titre} — ` + ([...actives.map(q => `${series.length > 1 ? q.nom + ' ' : ''}${fmt(c.valeurs[q.cle])}`),
      c.repere ? `${nomRepere} ${fmt(c.repere)}` : '', ligne?.[i] ? `${nomLigne} ${fmt(ligne[i])}` : '', c.texteAlerte || ''].filter(Boolean).join(' · ') || 'rien'));
  });
  if (ligne) {
    const pts = ligne.map((v, i) => v == null ? null : `${r1(x(i))},${r1(y(v))}`).filter(Boolean);
    svg += `<polyline class="courbe-moyenne" points="${pts.join(' ')}"/>`;
  }
  svg += etiquettesX(colonnes, x) + zonesTactiles(colonnes, x, pas, lectures);
  const entrees = [...series.filter(q => colonnes.some(c => c.valeurs[q.cle] > 0)).map(q => ({ nom: q.nom, couleur: q.couleur }))];
  if (colonnes.some(c => c.repere)) entrees.push({ nom: nomRepere, couleur: 'var(--texte)', trait: true });
  if (ligne) entrees.push({ nom: nomLigne, couleur: 'var(--discret)', trait: true });
  return cadre(svg, entrees, 'Touche une barre pour lire le détail.');
}

/**
 * Courbes. series : [{ nom, couleur, valeurs: [nombre|null, …] }] ; inverse = true met les petites valeurs en haut (allures).
 */
export function courbes({ colonnes, series, fmt = v => v, fmtAxe = fmt, inverse = false }) {
  const toutes = series.flatMap(s => s.valeurs).filter(v => v != null);
  if (toutes.length < 2) return '<p class="vide">Il faut au moins deux points pour tracer cette courbe.</p>';
  const min = Math.min(...toutes), max = Math.max(...toutes), marge = (max - min) * 0.12 || 1;
  const bas = min - marge, haut = max + marge, n = colonnes.length;
  const y = v => { const t = (v - bas) / (haut - bas); return M.haut + (inverse ? t : 1 - t) * ZH; };
  const x = i => M.gauche + 8 + (n === 1 ? (ZL - 16) / 2 : i * (ZL - 16) / (n - 1));
  let svg = '';
  const fins = [];
  for (const v of [min, (min + max) / 2, max])
    svg += `<line class="grille" x1="${M.gauche}" x2="${L - M.droite}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="axe" x="${M.gauche - 5}" y="${r1(y(v) + 3.5)}" text-anchor="end">${esc(fmtAxe(v))}</text>`;
  series.forEach((s, k) => {
    const pts = s.valeurs.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
    if (!pts.length) return;
    svg += `<polyline class="courbe" style="stroke:${s.couleur}" points="${pts.map(p => `${r1(p[0])},${r1(p[1])}`).join(' ')}"/>`;
    svg += pts.map(p => `<circle class="point" cx="${r1(p[0])}" cy="${r1(p[1])}" r="3.5" style="fill:${s.couleur}"/>`).join('');
    if (series.length > 1) fins.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], nom: s.etiquette || s.nom });
  });
  // nom de chaque série posé à droite de son dernier point, en écartant les noms qui se chevaucheraient
  fins.sort((a, b) => a.y - b.y);
  fins.forEach((f, i) => { if (i && f.y - fins[i - 1].y < 11) f.y = fins[i - 1].y + 11; });
  svg += fins.map(f => `<text class="nom-serie" x="${r1(f.x + 6)}" y="${r1(f.y + 3.5)}">${esc(f.nom)}</text>`).join('');
  const lectures = colonnes.map((c, i) => `${c.titre} — ` + (series.filter(s => s.valeurs[i] != null)
    .map(s => `${series.length > 1 ? s.nom + ' ' : ''}${fmt(s.valeurs[i])}`).join(' · ') || 'pas de donnée'));
  svg += etiquettesX(colonnes, x) + zonesTactiles(colonnes, x, n > 1 ? (ZL - 16) / (n - 1) : ZL, lectures);
  return cadre(svg, series.map(s => ({ nom: s.nom, couleur: s.couleur })), 'Touche un point pour lire le détail.');
}

/** Action "lire-graphique" : affiche la lecture de la colonne touchée sous le graphique. */
export const actions = {
  'lire-graphique'(d, el) {
    const g = el.closest('.graphique');
    g.querySelectorAll('.touche.choisie').forEach(t => t.classList.remove('choisie'));
    el.classList.add('choisie');
    g.querySelector('.lecture').textContent = d.lecture;
  },
};
