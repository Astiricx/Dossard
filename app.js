// app.js — point d'entrée : démarre l'app, affiche la vue demandée, distribue les clics.
//
// Comment ça marche, en trois idées :
// 1. L'adresse se termine par #accueil, #plan, #prepa/<id>… : chaque nom correspond à une vue (dossier js/vues/).
// 2. Une vue est une fonction qui renvoie du HTML à partir des données (js/store.js). Après chaque modification, on la redessine.
// 3. Un élément cliquable porte data-a="nom-de-l-action" ; la fonction du même nom est cherchée dans ACTIONS.
//    (data-c fait la même chose pour un champ qu'on modifie.)
import { charger, etat, enregistrer, regler } from './store.js';
import { prepActive, rapprocher } from './calc.js';
import { definirRafraichir, fermerFeuille, envoyerFeuille } from './ui.js';
import { esc } from './util.js';
import * as seances from './seances.js';
import * as charts from './charts.js';
import * as accueil from './vues/accueil.js';
import * as plan from './vues/plan.js';
import * as calendrier from './vues/calendrier.js';
import * as suivi from './vues/suivi.js';
import * as prepas from './vues/prepas.js';
import * as reglages from './vues/reglages.js';

const VUES = {
  accueil: accueil.rendre, plan: plan.rendre, calendrier: calendrier.rendre, suivi: suivi.rendre,
  prepas: prepas.rendre, prepa: prepas.rendreDetail, comparer: prepas.rendreComparaison, reglages: reglages.rendre,
};
const ACTIONS = {
  'fermer-feuille': fermerFeuille,
  ...seances.actions, ...charts.actions, ...plan.actions, ...calendrier.actions, ...suivi.actions, ...prepas.actions, ...reglages.actions,
};

/** Dessine la vue correspondant à l'adresse. */
function rendre() {
  const [nom, parametre] = (location.hash.slice(1) || 'accueil').split('/');
  const vue = VUES[nom] ? nom : 'accueil';
  document.getElementById('vue').innerHTML = VUES[vue](parametre);
  const onglet = { prepa: 'prepas', comparer: 'prepas' }[vue] || vue;
  document.querySelectorAll('#onglets a').forEach(a => a.classList.toggle('actif', a.dataset.onglet === onglet));
  const p = prepActive();
  document.getElementById('prep-active').innerHTML = p ? `${esc(p.nom)} <span>▾</span>` : 'Dossard';
}

async function executer(nom, element, evenement) {
  const action = ACTIONS[nom];
  if (!action) return;
  try { if (await action(element.dataset, element, evenement) === true) rendre(); }
  catch (e) { console.error(e); alert('Une erreur est survenue : ' + e.message); }
}

/** Modèles proposés à la première ouverture (modifiables et supprimables dans Plan). */
async function creerModelesDeDepart() {
  if (etat.reglages.modelesCrees) return;
  const modeles = [
    { sport: 'course', titre: 'Footing en endurance', dureeMin: 45, zone: 2, notes: '' },
    { sport: 'course', titre: 'Sortie longue', dureeMin: 80, zone: 2, notes: '' },
    { sport: 'course', titre: '5 × 1000 m récup 1 min 30', dureeMin: 55, zone: 4, notes: '20 min d\'échauffement, retour au calme 10 min' },
    { sport: 'velo', titre: 'Vélo endurance', dureeMin: 90, zone: 2, notes: '' },
    { sport: 'natation', titre: 'Natation technique', dureeMin: 45, zone: 2, notes: 'Éducatifs + 6 × 100 m' },
    { sport: 'renfo', titre: 'Renforcement', dureeMin: 30, zone: 3, notes: 'Gainage, fentes, mollets' },
    { sport: 'repos', titre: 'Repos', notes: '' },
  ];
  for (const m of modeles) await enregistrer('modeles', m);
  await regler({ modelesCrees: true });
}

async function demarrer() {
  await charger();
  reglages.appliquerTheme();
  await creerModelesDeDepart();
  await rapprocher();
  definirRafraichir(rendre);

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (el) executer(el.dataset.a, el, e);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'fichier-import') reglages.fichierChoisi(e.target);
    else if (e.target.dataset.c) executer(e.target.dataset.c, e.target, e);
  });
  document.addEventListener('submit', e => { e.preventDefault(); envoyerFeuille(e.target); });
  window.addEventListener('hashchange', () => { fermerFeuille(); rendre(); window.scrollTo(0, 0); });
  rendre();

  // Demande au navigateur de ne pas effacer les données s'il manque de place.
  navigator.storage?.persist?.();
  // Service worker : met l'app en cache pour qu'elle s'ouvre sans réseau.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Mode hors ligne indisponible :', e));
}

demarrer().catch(e => {
  console.error(e);
  document.getElementById('vue').innerHTML = `<p class="vide">L'application n'a pas pu démarrer : ${esc(e.message)}.<br>Vérifie que la navigation privée est désactivée.</p>`;
});
