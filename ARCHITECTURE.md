# Dossard v2 — Sprint 1 : le cerveau

Aucune interface dans ce sprint. Trois couches, à sens unique : `domain` ne dépend de rien,
`engine` dépend de `domain`, `store` dépend de `domain`. Le moteur ne connaît ni React, ni la base,
ni l'horloge : mêmes entrées, mêmes sorties.

```
src/
  domain/      les types : ce que l'application manipule
    primitives.ts   identifiants nominaux, dates, sports
    athlete.ts      Athlete, seuils datés, zones
    plan.ts         TrainingPlan, RaceEvent, Cycle (macro / méso / micro)
    workout.ts      Workout, WorkoutBlock (étape ou répétition), cibles d'intensité
    activity.ts     CompletedActivity, résumé, tours, séries
    load.ts         ActivityLoad : la charge telle qu'elle est stockée
  engine/      les calculs : fonctions pures
    series.ts       nettoyage d'une série de capteur (1 Hz, pauses, trous, aberrations)
    power.ts        puissance normalisée, IF, TSS
    pace.ts         TSS à l'allure (course, natation), seuil estimé depuis un chrono
    hr.ts           TRIMP de Banister et d'Edwards, hrTSS
    foster.ts       RPE de séance, monotonie, contrainte
    load.ts         choix de LA charge d'une activité parmi les méthodes disponibles
    planned.ts      durée, distance et charge prévues d'une séance, depuis ses blocs
    config.ts       toutes les bornes et tables, dont les heuristiques, nommées comme telles
  store/       l'état : transitions pures + liaison Zustand
    calendar.ts     état normalisé du calendrier et ses transitions
    selectors.ts    lectures à référence stable, totaux de semaine mémorisés
    app-store.ts    store global, écriture optimiste, port de persistance
tests/         25 tests sur des valeurs calculées à la main
```

## 1. Modèle de données : les six décisions qui comptent

1. **Entité ou valeur.** Ce qui a une identité et se modifie seul (plan, cycle, séance, activité) est
   une entité à plat, reliée par identifiant. Ce qui n'existe que dans son parent (blocs d'une séance,
   courses d'un plan, tours d'une activité) est imbriqué. Un cycle porte `parentId` plutôt que de
   contenir ses enfants : redimensionner un mésocycle dans la grille ne réécrit pas tout le plan.
2. **Seuils datés.** `Athlete.thresholds` est un historique. Une séance de mars est évaluée avec la
   FTP de mars. Sans cela, chaque progrès de l'athlète réécrirait sa courbe de forme passée.
3. **Cibles relatives.** Une étape vise « 88 à 94 % de la FTP », pas « 230 W ». La séance et le
   modèle restent justes quand les seuils changent, et le graphique de la séance (Sprint 3) se
   colore directement par zone.
4. **Le lien prévu → réalisé est porté par la séance.** Une synchronisation réécrit les activités ;
   elle ne peut donc pas défaire un rapprochement fait par l'athlète.
5. **Les séries sont hors du store.** `ActivityStreams` vit dans sa propre table et n'est chargé que
   pour l'activité ouverte. Le calendrier ne manipule que des résumés.
6. **Rien de déductible n'est stocké**, sauf ce qui est coûteux : le statut d'un plan se calcule ;
   la charge d'une activité est mise en cache avec la version du moteur et la date des seuils
   utilisés, ce qui dit exactement quand la recalculer.

## 2. Store : comment le calendrier reste fluide

- **Index par jour.** Une case s'abonne à `workoutIdsByDate[date]`, pas à la liste des séances.
- **Partage structurel strict.** Déplacer une séance remplace deux tableaux ; toutes les autres
  références sont conservées (vérifié par test). Sur une vue annuelle, deux cases se redessinent.
- **Le survol du glisser-déposer ne traverse pas le store.** Il reste dans dnd-kit. Seul le lâcher
  déclenche une action. Lâcher une séance à sa place ne produit ni rendu ni écriture (vérifié).
- **Écriture optimiste, file ordonnée.** L'écran change immédiatement ; chaque transition renvoie la
  liste des lignes à écrire, envoyées à la base dans l'ordre. En cas d'échec, le store relit la base
  au lieu de tenter d'annuler action par action (vérifié).
- **Charge incrémentale.** `loadDirtyFrom` retient le premier jour modifié. CTL et ATL étant des
  moyennes exponentielles, seul ce qui suit ce jour est à recalculer.
- **Trois stores.** Données (persistées), interface (période affichée, sélection), glisser-déposer.
  Ils changent à des rythmes différents et ne doivent pas se réveiller les uns les autres.

## 3. Moteur : une seule échelle

TSS, TRIMP et charge de Foster ne s'additionnent pas : une heure au seuil vaut 100 TSS, environ
140 TRIMP et 420 à 480 unités Foster. Le moteur calcule tout ce qui est calculable, ramène chaque
méthode à l'échelle TSS, puis retient la première méthode fiable dans l'ordre de préférence du sport.
Les autres valeurs restent dans `load.metrics`.

| Méthode | Formule | Passage à l'échelle TSS | Statut |
|---|---|---|---|
| Puissance | NP (moyenne glissante 30 s, puissance 4), IF = NP / FTP | heures × IF² × 100 | Formule publiée |
| Allure course | IF = vitesse / vitesse seuil | heures × IF² × 100 | Formule publiée, sans correction de pente pour l'instant |
| Allure natation | idem | heures × IF³ × 100 | Formule publiée |
| FC (Banister) | Σ min × FCr × a × e^(b × FCr) | TRIMP / TRIMP d'une heure à la FC seuil × 100 | Formule publiée |
| FC (Edwards) | Σ min × zone | affiché, non utilisé pour la charge | Formule publiée |
| Ressenti (Foster) | RPE × minutes | table RPE → charge horaire | **Heuristique**, à calibrer par athlète |
| Durée seule | — | charge horaire par sport | **Heuristique**, dernier recours |

Ordre par défaut : course `puissance > allure > FC > RPE > durée` ; vélo `puissance > FC > RPE > durée` ;
natation `allure > FC > RPE` ; renforcement `RPE > FC`. Une méthode de qualité « basse » cède la place
à la suivante si celle-ci est meilleure : sur un trail, la FC passe devant l'allure.

Cas limites traités (chacun a un test) :

| Situation | Comportement |
|---|---|
| Seuil absent ou hors bornes | échec explicite (`missing_threshold`, `invalid_threshold`), la cascade passe à la méthode suivante |
| Pics de puissance, FC > 110 % de la FC max | écartés, avertissement `outliers_removed` |
| Capteur décroché quelques secondes | comblé par la dernière valeur |
| Plus de 50 % de données manquantes | calcul refusé plutôt que faussé |
| Enregistrement à pas irrégulier | ramené à 1 Hz avant tout calcul |
| Pause | temps exclu du chrono |
| Horodatages dupliqués ou désordonnés | ignorés |
| Intensité > 105 % du seuil pendant plus d'une heure | calcul maintenu, avertissement « seuil à retester » |
| FC de repos ou sexe inconnus | valeur par défaut, avertissement |
| Semaine à écart-type nul | monotonie `null`, pas de division par zéro |
| Vitesse impossible (GPS en voiture) | `implausible_value` |

## 4. Ce qui est vérifié, et ce qui ne l'est pas

- Typage strict (`strict`, `noUncheckedIndexedAccess`) : aucune erreur.
- 25 tests passent. NP et TRIMP ont été recalculés une seconde fois par un script indépendant.
- Passage sur les 245 activités réelles de l'historique Strava : 183 par l'allure (qualité moyenne),
  7 par l'allure en terrain vallonné (basse), 55 à la durée seule (randonnées, vélo, natation).
  Le 10 km de Châlons en 40:03 sort à 70,8.
- **Non vérifié contre la vraie bibliothèque Zustand** : pas d'accès à npm ici. `app-store.ts` est
  typé contre une déclaration minimale (`types/zustand-shim.d.ts`, à supprimer après installation) et
  testé avec une doublure de 12 lignes. La logique (optimisme, file, retour à la base) est testée ;
  la compatibilité exacte de l'API sera confirmée au premier `npm install`.
- Les valeurs obtenues n'ont pas été comparées à celles de TrainingPeaks sur un même fichier.
- Aucune version de dépendance n'est figée dans ce sprint, pour la même raison.

## 5. Garmin : l'état réel, au 12 novembre 2026

- Garmin a rouvert son programme développeur le 21 octobre 2026 avec trois niveaux.
- **Personal** : libre-service, clé d'API personnelle, accès à ses propres activités (JSON et FIT),
  en lecture à la demande. C'est le niveau adapté à une application pour un seul athlète. La page
  officielle ne mentionne pas OAuth pour ce niveau.
- **Business Starter** : sur demande par formulaire, livraison en « push » uniquement, historique non
  inclus. Le push impose un serveur qui reçoit les données : impossible depuis un site statique.
- Ce que je ne sais pas encore : si l'API Personal accepte les appels depuis un navigateur (CORS),
  ses limites de débit, la durée de vie des jetons. À tester avec une vraie clé.
- Conséquence pour l'architecture : la synchronisation passe par un port `ActivitySource` avec trois
  adaptateurs — import de fichier FIT (fonctionne sans aucun accès), Garmin Personal, import de
  l'ancien JSON Strava. Le parseur FIT est commun aux deux premiers.

## 6. Pile technique imposée pour la suite

Vite + React + TypeScript, Tailwind CSS, Zustand (état), Dexie (IndexedDB), dnd-kit (glisser-déposer),
Recharts (courbes de charge), SDK FIT officiel de Garmin pour le parseur (nom du paquet à confirmer
à l'installation).

Ce que cela change : il y a désormais une étape de compilation. Le dépôt GitHub contiendra les
sources et un workflow GitHub Actions publiera le site ; le glisser-déposer de fichiers dans GitHub
ne suffit plus. La v1 reste en ligne tant que la v2 ne fait pas au moins aussi bien, et tes données
passent de l'une à l'autre par l'export JSON existant.

## 7. Sprints suivants

- **Sprint 2** — projet Vite, persistance Dexie, migration des données v1, courbes CTL / ATL / TSB
  (recalcul incrémental depuis `loadDirtyFrom`), grille macro / micro avec glisser-déposer.
- **Sprint 3** — constructeur de séances par blocs et son graphique, import FIT, superposition
  prévu / réalisé, test de l'API Garmin Personal.

Note : « TSS », « NP » et « IF » sont des marques de TrainingPeaks. Les formules sont publiques, les
noms ne le sont pas : dans l'interface, la charge s'appellera autrement.
