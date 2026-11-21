# GTNH Server Updater — cartographie Wayfinder

Status: resolved
Labels: wayfinder:map

## Destination

Définir une application Electron permettant de préparer un nouveau serveur GTNH sur Linux via SSH, de fusionner les configurations et de copier le monde. La cartographie est terminée quand les décisions nécessaires à l’implémentation sont résolues et que la spécification est exploitable sans choix fonctionnel restant.

## Notes

- [Périmètre convenu et validation](spec.md) : exigences du cadrage initial, révision de la fusion et matrice de validation ; avec les réponses des tickets, il forme la spécification d’implémentation.
- [Suivi Markdown local](tracker.md) : conventions de tickets, dépendances, attribution et résolution.
- Consulter les skills `wayfinder`, `grilling` et `domain-modeling` pour les sessions de décision.
- Poser les questions via l’interface GUI ; réponses concises et techniques en français, interface de l’application en anglais.
- Ne pas lancer de sous-agents sans demande explicite de l’utilisateur.
- Chaque ticket existant est une décision HITL à résoudre avec l’utilisateur. Ne pas transformer des propositions techniques en décisions acquises.
- La création de cette carte ne développe pas l’application et ne résout aucun ticket.

## Decisions so far

- [Définir le déploiement distant](issues/01-deploiement-distant.md) — Déploiement sans sudo, ZIP strictement validé avant suppression confirmée, puis extraction directe avec conservation des fichiers partiels en cas d’échec.
- [Définir la fusion des fichiers](issues/02-fusion-fichiers.md) — Comparaison 3-voies avec l’archive d’origine obligatoire ; seules les modifications utilisateur sont reprises ou fusionnées, tout le reste suit la nouvelle version.
- [Définir la migration des données GTNH](issues/03-migration-donnees.md) — Arrêt confirmé dès le début ; monde `level-name` source copié sous son nom avec les données hors monde listées par ServerUtilities, vérification nombre + octets.
- [Définir les connexions et la reprise après erreur](issues/04-connexions-reprise.md) — known_hosts OpenSSH + TOFU, profils avec passphrase chiffrée si possible, opérations attachées annulables sans reprise, instance unique et journal sans secret.
- [Valider le parcours et les contrats IPC](issues/05-parcours-ipc.md) — Stepper guidé avec sauts tracés, carte IPC typée validée par zod, rapport exportable, NSIS/AppImage/deb avec mise à jour GitHub, matrice de validation.
- [Distinguer les modifications utilisateur des réécritures de mods](issues/06-bruit-configuration.md) — Comparaison clé par clé des formats connus : 12 propositions au lieu de 248 sur l’installation réelle ; réécritures de mods masquées, ajouts décochés.
- [Choisir une release GTNH depuis l’application](issues/07-selection-release.md) — Troisième source « GTNH daily build » listant les 50 dernières releases ; archive serveur Java 17 choisie automatiquement, téléchargement par le serveur.

- [Remplacer un mod par sa propre version](issues/08-mode-mods.md) — Mode « Mods » générique et ponctuel : dossier de builds mémorisé par modid, une entrée par version, original trouvé par `mcmod.info`, serveur (stop, remplacement, start, vérification du journal FML, arrêt si échec) puis instances Prism cochées ; sauvegardes hors de `mods/` avec restauration.

## Not yet specified

Aucun. Les sept tickets sont résolus et la spécification ne laisse aucun choix fonctionnel ouvert (2026-09-19). Les manques de test restants sont listés dans la matrice de validation du [périmètre](spec.md).

## Out of scope

- Arrêt et démarrage automatiques du serveur dans le parcours de mise à jour : l’utilisateur les gère manuellement. Seul le mode Mods redémarre le service systemd du profil (ticket 08).
- Modification ou suppression de l’ancien serveur.
- Fusion sans archive d’origine de l’ancienne version (base obligatoire).
- Création du dépôt GitHub `Elyspio/gtnh-server-updater` et publication des releases : faites par l’utilisateur.
