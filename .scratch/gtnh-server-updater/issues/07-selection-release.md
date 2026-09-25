# Choisir une release GTNH depuis l’application

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Claude
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 01, 02

## Question

Comment éviter de coller une URL complète pour désigner une version, à partir de la page des builds quotidiens `GTNewHorizons/GTNH-Daily-Builds` ?

## Comments

- 2026-09-20 — Demande de l’utilisateur, avec l’exemple de l’archive `daily-2026-09-19+746`. Les deux modes existants — fichier local et URL HTTPS — restent souhaités.
- 2026-09-20 — Vérification : l’API GitHub renvoie la release `daily-2026-09-19+746` et son archive `GTNH-daily-2026-09-19+746-server-java17-26.zip`, sélectionnée automatiquement. Mise à jour réelle 731 → 746 exécutée de bout en bout avec téléchargement par le serveur : 10 fichiers modifiés par l’utilisateur, 2 conflits (`config/GregTech/GregTech.cfg` et `server.properties`), 82 réécritures de mods, 154 ajouts.

## Answer

Une troisième source, « GTNH daily build », s’ajoute au fichier local et à l’URL HTTPS, à l’étape de déploiement comme à l’étape de fusion : la version d’origine et la nouvelle version se choisissent ainsi dans la même liste.

L’application interroge `https://api.github.com/repos/GTNewHorizons/GTNH-Daily-Builds/releases?per_page=50` depuis le processus principal, sans authentification ; le serveur Linux ne voit que l’URL de l’archive choisie, qu’il télécharge comme n’importe quelle URL HTTPS. La réponse de GitHub est traitée comme une donnée : elle est validée par schéma, et seules les archives `.zip` dont l’URL commence par `https://github.com/GTNewHorizons/GTNH-Daily-Builds/releases/download/` sont retenues.

Les 50 releases les plus récentes sont listées, avec recherche par tag et bouton de rafraîchissement. L’archive serveur Java 17 est choisie automatiquement quand elle est unique ; sinon la liste des archives de la release s’affiche. La taille annoncée par GitHub est vérifiée après téléchargement, comme pour un envoi local.

Si GitHub est injoignable ou limite les appels, l’erreur est affichée dans l’étape et les modes fichier local et URL restent utilisables ; aucune liste n’est mise en cache sur disque.
