# Valider le parcours et les contrats IPC

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Claude
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 01, 02, 03, 04

## Question

Quel parcours utilisateur et quels contrats IPC typés permettent d’exposer les décisions précédentes dans une interface Electron anglaise, testable sur Windows et Linux ?

À résoudre après les quatre autres tickets : écrans et transitions, navigation distante, progression et erreurs, comparaison et édition, confirmation d’arrêt, récapitulatif avant application, rapport final et reprise d’une session.

Définir les types partagés pour profils SSH, source d’archive, chemins, opération, différence de fichier, choix de fusion, progression et résultat. Préciser les requêtes, événements, validations et responsabilités respectives du renderer, du preload et du processus principal sans exposer d’accès privilégié arbitraire au renderer.

Évaluer les éléments réutilisables d’Elytools, établir les formats de distribution Windows/Linux et relier chaque critère du [périmètre](../spec.md) à un scénario de test. Vérifier que tous les choix nécessaires à la réalisation sont documentés avant de déclarer la spécification prête.

## Comments

Aucune décision technique résolue lors de la création du ticket.

- 2026-09-19 — Ticket réclamé pour la session de décision avec l’utilisateur.
- 2026-09-19 — Faits relevés : page unique à 5 sections ; canaux IPC écrits en dur dans preload et main, sans validation à l’exécution ni contrôle d’expéditeur ; electron-builder NSIS + AppImage + deb, sans signature ni mise à jour. Elytools (`P:\own\desktop\cross-platform\media-tools\desktop`) apporte une carte typée des canaux implémentée par main, un preload générique, les fuses Electron, electron-updater publié sur GitHub par scripts locaux.
- 2026-09-19 — Implémentation : dès qu’une étape au-delà du serveur est entamée, la connexion et les chemins sont verrouillés ; « Start over » (confirmé) réinitialise les étapes suivantes. Vérifications : `smoke:ipc` sur l’hôte de test (appels légitimes acceptés, chemin relatif, canal inconnu et empreinte forgée refusés), installateur NSIS construit et application packagée démarrée ; la vérification de mise à jour échoue proprement (dépôt GitHub absent) et le journal ne garde plus que la première ligne des erreurs d’electron-updater, qui y ajoutait les en-têtes HTTP et cookies.

- 2026-09-20 — Retour d’usage : la revue maison était jugée impraticable. Elle est remplacée par Monaco, l’éditeur de VS Code, embarqué hors ligne et chargé à la première ouverture d’un fichier : archive d’origine, version de l’utilisateur et nouvelle version côte à côte en lecture seule, puis le résultat éditable comparé à l’une des trois. Les conflits portent des marqueurs de style Git et l’écriture est refusée tant qu’il en reste.
- 2026-09-20 — Retours d’usage : l’étape de fusion affiche le contexte des étapes précédentes (serveur, clé, chemins, arrêt confirmé, archive déployée) dans un bloc repliable, et le navigateur de dossiers distants ouvre un dossier au simple clic au lieu du double-clic.

## Answer

Parcours en stepper : Connexion → Arrêt confirmé → Déploiement → Fusion → Migration → Rapport. Une étape se débloque quand la précédente est terminée ; les étapes faites restent consultables. Fusion et migration peuvent être sautées après confirmation, le saut figure dans le rapport ; le déploiement est obligatoire. Modifier la connexion ou les chemins réinitialise les étapes suivantes. Le navigateur distant garde son fonctionnement (dossiers, parent, saisie) et ajoute « New folder ».

Contrats IPC : une carte partagée canal → signature (pattern Elytools) que main implémente intégralement et que le preload expose génériquement ; chaque payload est validé par un schéma zod partagé dans main ; seule la fenêtre principale est acceptée comme expéditeur. Le renderer n’obtient aucun accès générique aux fichiers, au shell ou au SSH : uniquement les opérations métier (profils, connexion, navigation distante, déploiement, fusion, migration, annulation, rapport, journal, mise à jour). Les secrets restent dans main. Les événements de progression passent par des canaux dédiés.

Rapport : écran récapitulatif (chemins, étapes faites ou sautées, fichiers repris et fusionnés, monde copié, fichiers partiels, durées) et export Markdown local via une boîte d’enregistrement.

Distribution : NSIS (Windows), AppImage et deb (Linux), fuses Electron (intégrité ASAR, chargement depuis l’ASAR uniquement), electron-updater publié sur GitHub `Elyspio/gtnh-server-updater` par scripts locaux de build et de publication (`GITHUB_TOKEN`). Le dépôt est créé et la publication lancée par l’utilisateur. L’application recherche une mise à jour au démarrage, la télécharge en arrière-plan, propose « Restart to update » hors opération distante et l’installe sinon à la fermeture.

Validation : une matrice relie chaque critère du [périmètre](../spec.md) à un test unitaire, d’intégration, de bout en bout ou manuel, et signale les manques.
