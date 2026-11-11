// reglages.js — repères personnels (FC max, allure), thème, sauvegarde et import des données.
import { etat, regler, exporter, importer, toutEffacer } from '../store.js';
import { ZONES, rapprocher } from '../calc.js';
import { esc, aujourdhui, versSecondes, dateLongue } from '../util.js';
import { feuille, fermerFeuille, toast, rafraichir } from '../ui.js';

const allure = s => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Tableau des zones : fréquence cardiaque d'après la FC max, allures d'après le chrono de référence sur 10 km. */
function tableauZones() {
  const { fcMax, ref10k } = etat.reglages, ref = versSecondes(ref10k), parKm = ref ? ref / 10 : null;
  return `<div class="defile"><table><tr><th>Zone</th><th>FC (bpm)</th><th>Allure course</th></tr>
    ${ZONES.map((z, i) => `<tr><td>Z${i + 1} ${z.nom}</td><td>${Math.round(fcMax * z.fc[0] / 100)}–${Math.round(fcMax * z.fc[1] / 100)}</td>
      <td>${!parKm ? '—' : z.allure[0] && z.allure[1] ? `${allure(parKm * z.allure[0])} à ${allure(parKm * z.allure[1])}` : z.allure[0] ? `plus lent que ${allure(parKm * z.allure[0])}` : `plus vite que ${allure(parKm * z.allure[1])}`}</td></tr>`).join('')}
  </table></div><p class="aide">Repères indicatifs, à ajuster à tes sensations.</p>`;
}

export function rendre() {
  const r = etat.reglages;
  return `<h1>Réglages et données</h1>
    <section class="carte"><h2>Mes repères</h2>
      <div class="deux"><label class="champ"><span>FC max (bpm)</span><input value="${esc(r.fcMax)}" inputmode="numeric" data-c="regler" data-cle="fcMax"></label>
      <label class="champ"><span>Chrono 10 km de référence</span><input value="${esc(r.ref10k)}" placeholder="39:30" data-c="regler" data-cle="ref10k"></label></div>
      ${tableauZones()}</section>
    <section class="carte"><h2>Apparence</h2>
      <div class="segments">${[['sombre', 'Sombre'], ['clair', 'Clair'], ['auto', 'Comme le téléphone']].map(([v, t]) =>
        `<button data-a="theme" data-v="${v}" class="${r.theme === v ? 'actif' : ''}">${t}</button>`).join('')}</div></section>
    <section class="carte"><h2>Mes données</h2>
      <p>Tout est stocké dans ce téléphone, rien n'est envoyé ailleurs. ${etat.activites.length} séances réalisées, ${etat.seances.length} séances prévues, ${etat.preparations.length} préparations.</p>
      <p class="aide">${r.derniereSauvegarde ? 'Dernière sauvegarde : ' + esc(dateLongue(r.derniereSauvegarde.slice(0, 10))) + '.' : 'Aucune sauvegarde pour l\'instant.'}</p>
      <div class="rangee">
        <button class="bouton principal" data-a="exporter">Sauvegarder (exporter en JSON)</button>
        <button class="bouton" data-a="importer">Importer un fichier</button>
        <button class="bouton danger" data-a="tout-effacer">Tout effacer</button>
      </div>
      <p class="aide">« Importer » sert à la fois à restaurer une sauvegarde et à charger un historique Strava.</p></section>
    <p class="aide centre">Dossard · version 1.0</p>`;
}

/** Applique le thème choisi (attribut data-theme sur <html>, lu par le CSS). */
export function appliquerTheme() { document.documentElement.dataset.theme = etat.reglages.theme || 'sombre'; }

/** Lit le fichier choisi puis demande : ajouter à mes données, ou tout remplacer ? */
export async function fichierChoisi(input) {
  const fichier = input.files[0];
  if (!fichier) return;
  let donnees;
  try { donnees = JSON.parse(await fichier.text()); if (donnees.app !== 'dossard') throw 0; }
  catch { toast("Ce fichier n'est pas un fichier Dossard valide."); input.value = ''; return; }
  input.value = '';
  const nb = c => (donnees[c] || []).length;
  feuille('Importer', `<p><b>${esc(fichier.name)}</b></p>
    <p>${nb('activites')} séances réalisées, ${nb('seances')} séances prévues, ${nb('preparations')} préparations, ${nb('modeles')} modèles.</p>
    <div class="rangee colonne">
      <button type="button" class="bouton principal" data-a="import-valider" data-mode="ajouter">Ajouter à mes données</button>
      <p class="aide">Ajoute ce qui manque et met à jour les activités Strava. Ce que tu as saisi (effort, fatigue, ressenti, plan) est conservé.</p>
      <button type="button" class="bouton danger" data-a="import-valider" data-mode="remplacer">Remplacer toutes mes données</button>
      <p class="aide">Efface tout puis recharge ce fichier : pour restaurer une sauvegarde sur un téléphone vide.</p>
    </div>`);
  enAttente = donnees;
}
let enAttente = null;

export const actions = {
  'theme'(d) { regler({ theme: d.v }); appliquerTheme(); return true; },
  'regler'(d, el) {
    const v = d.cle === 'fcMax' ? (parseInt(el.value, 10) || 190) : el.value.trim();
    regler({ [d.cle]: v }); return true;
  },
  'importer': () => document.getElementById('fichier-import').click(),
  async 'import-valider'(d) {
    const remplacer = d.mode === 'remplacer';
    if (remplacer && !confirm('Effacer toutes les données actuelles et les remplacer par ce fichier ?')) return;
    try {
      const b = await importer(enAttente, remplacer), liens = await rapprocher();
      toast(`${b.ajoutes} éléments ajoutés, ${b.misAJour} mis à jour${liens ? `, ${liens} séances rapprochées du plan` : ''}.`);
    } catch (e) { toast(e.message); }
    enAttente = null; fermerFeuille(); appliquerTheme(); location.hash = '#accueil'; rafraichir();
  },
  /** Sauvegarde : sur iPhone, ouvre la feuille de partage (« Enregistrer dans Fichiers ») ; ailleurs, télécharge le fichier. */
  async 'exporter'() {
    const nom = `dossard-sauvegarde-${aujourdhui()}.json`;
    const contenu = JSON.stringify(exporter());
    const fichier = new File([contenu], nom, { type: 'application/json' });
    const fichierTexte = new File([contenu], nom, { type: 'text/plain' });   // certains iPhone refusent de partager du JSON
    try {
      if (navigator.canShare?.({ files: [fichier] })) await navigator.share({ files: [fichier] });
      else if (navigator.canShare?.({ files: [fichierTexte] })) await navigator.share({ files: [fichierTexte] });
      else { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(fichier), download: nom }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    } catch (e) { if (e.name === 'AbortError') return; toast('La sauvegarde a échoué : ' + e.message); return; }
    await regler({ derniereSauvegarde: new Date().toISOString() });
    toast('Sauvegarde créée.'); return true;
  },
  async 'tout-effacer'() {
    if (!confirm('Effacer toutes les données de ce téléphone ? Pense à sauvegarder avant.')) return;
    await toutEffacer(); toast('Données effacées.'); location.hash = '#accueil'; return true;
  },
};
