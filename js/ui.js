// ui.js — briques d'interface communes : feuille (formulaire qui monte du bas), message bref, champs.
import { esc } from './util.js';

// --- Rafraîchir l'écran : app.js fournit la fonction, les vues l'appellent après chaque modification ---
let fonctionRafraichir = () => {};
export const definirRafraichir = f => { fonctionRafraichir = f; };
export const rafraichir = () => fonctionRafraichir();

// --- Feuille ---
let surEnvoiCourant = null;
/**
 * Ouvre une feuille. `surEnvoi(valeurs, formulaire)` reçoit les champs du formulaire quand on valide ;
 * si elle renvoie false la feuille reste ouverte. Sans `surEnvoi`, la feuille n'a pas de bouton de validation.
 */
export function feuille(titre, html, surEnvoi, libelle = 'Enregistrer') {
  surEnvoiCourant = surEnvoi || null;
  const zone = document.getElementById('feuille');
  zone.innerHTML = `<div class="voile" data-a="fermer-feuille"></div>
    <form class="panneau" novalidate>
      <div class="panneau-tete"><h2>${esc(titre)}</h2><button type="button" class="icone" data-a="fermer-feuille" aria-label="Fermer">✕</button></div>
      <div class="panneau-corps">${html}</div>
      ${surEnvoi ? `<div class="panneau-pied"><button class="bouton principal" type="submit">${esc(libelle)}</button></div>` : ''}
    </form>`;
  zone.hidden = false;
  document.body.classList.add('feuille-ouverte');
}
export function fermerFeuille() {
  document.getElementById('feuille').hidden = true;
  document.getElementById('feuille').innerHTML = '';
  document.body.classList.remove('feuille-ouverte');
  surEnvoiCourant = null;
}
/** Appelé par app.js quand un formulaire de feuille est validé. */
export async function envoyerFeuille(formulaire) {
  if (!surEnvoiCourant) return;
  const valeurs = Object.fromEntries(new FormData(formulaire));
  const resultat = await surEnvoiCourant(valeurs, formulaire);
  if (resultat !== false) { fermerFeuille(); rafraichir(); }
}

// --- Message bref en bas de l'écran ---
let minuterie;
export function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message; t.hidden = false;
  clearTimeout(minuterie); minuterie = setTimeout(() => { t.hidden = true; }, 3200);
}

// --- Champs de formulaire ---
export const champ = (label, nom, valeur = '', attributs = '') =>
  `<label class="champ"><span>${label}</span><input name="${nom}" value="${esc(valeur ?? '')}" ${attributs}></label>`;
export const zoneTexte = (label, nom, valeur = '', lignes = 3, attributs = '') =>
  `<label class="champ"><span>${label}</span><textarea name="${nom}" rows="${lignes}" ${attributs}>${esc(valeur ?? '')}</textarea></label>`;
export const liste = (label, nom, options, valeur, attributs = '') =>
  `<label class="champ"><span>${label}</span><select name="${nom}" ${attributs}>${options.map(([v, t]) =>
    `<option value="${esc(v)}" ${String(v) === String(valeur ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
/** Groupe de pastilles à choix unique (boutons radio). options = [[valeur, texte], …] */
export const pastilles = (label, nom, options, valeur) =>
  `<fieldset class="champ"><legend>${label}</legend><div class="pastilles">${options.map(([v, t]) =>
    `<label class="pastille"><input type="radio" name="${nom}" value="${esc(v)}" ${String(v) === String(valeur ?? '') ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></fieldset>`;
