# Dossard

Application web installable (PWA) de préparation et de suivi d'entraînement, course à pied et triathlon.
Aucune dépendance, aucun outil de build : ce dossier est le site, tel quel.
Les données restent dans le navigateur du téléphone (IndexedDB) ; rien n'est envoyé à un serveur.

## Où se trouve quoi

| Fichier | Rôle |
|---|---|
| `index.html` | La page : en-tête, zone de contenu, barre d'onglets |
| `css/style.css` | Toute l'apparence (couleurs en variables en haut du fichier) |
| `js/app.js` | Démarrage, navigation entre les vues, distribution des clics |
| `js/store.js` | Les données : lecture/écriture IndexedDB, export, import |
| `js/calc.js` | Les règles : sports, zones, charge, alerte de surcharge, semaines d'une prépa |
| `js/seances.js` | Affichage d'une journée, feuilles « séance prévue » et « séance réalisée » |
| `js/charts.js` | Les graphiques (barres empilées, courbes) en SVG |
| `js/ui.js` | Feuille de formulaire, message bref, champs |
| `js/util.js` | Dates et formats |
| `js/vues/*.js` | Un fichier par écran : accueil, plan, calendrier, suivi, prepas, reglages |
| `sw.js` | Service worker : fonctionnement hors ligne |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |

## Principe

1. L'adresse se termine par `#accueil`, `#plan`, `#prepa/<id>`… : chaque nom correspond à une vue.
2. Une vue est une fonction qui renvoie du HTML à partir des données ; après chaque modification on la redessine.
3. Un élément cliquable porte `data-a="nom-de-l-action"` ; la fonction du même nom est dans l'objet `actions` d'un module.

## Tester sur un ordinateur

Dans ce dossier : `python3 -m http.server 8000`, puis ouvrir http://localhost:8000.
(Ouvrir `index.html` par double-clic ne fonctionne pas : les modules JavaScript exigent un serveur.)

## Ajouter un fichier

L'ajouter aussi à la liste `FICHIERS` de `sw.js`, sinon il manquera hors ligne.
