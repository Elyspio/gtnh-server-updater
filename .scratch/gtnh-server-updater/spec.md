# Périmètre convenu — GTNH Server Updater

Status: spécification prête ; décisions dans les tickets résolus de la carte

## Comportement attendu

- Application Windows et Linux avec interface en anglais.
- Base inspirée de `P:\own\desktop\cross-platform\media-tools\desktop` : Electron, React, TypeScript, MUI et IPC typé. Le modèle comprend déjà un module SSH ; sa réutilisation reste à évaluer.
- Plusieurs profils SSH avec authentification par clé privée.
- Source : archive ZIP locale envoyée par SFTP, ou URL téléchargée directement par le serveur Linux.
- Choix des dossiers distants de l’ancien et du nouveau serveur, puis extraction de l’archive dans le nouveau dossier.
- Comparaison des fichiers différents et des fichiers présents uniquement dans l’ancien serveur ; filtrage des fichiers identiques.
- Fusion manuelle ligne par ligne des fichiers texte sélectionnés. Le traitement des fichiers binaires reste à décider.
- Comparaison générale avec exclusions : anciens mods, bibliothèques, JAR, logs, caches et sauvegardes. Les règles exactes restent à préciser ; les nouveaux mods de l’archive sont bien déployés.
- Copie du monde après confirmation de l’arrêt manuel, sans modifier l’ancien serveur. Pas de pré-copie à chaud.
- L’application présente des différences, pas une détection certaine des personnalisations : l’archive d’origine de l’ancienne version n’est pas fournie.

## Exemple réel inspecté

Source locale, non copiée dans le dépôt : `C:\Users\jonag\Downloads\GTNH-daily-2026-09-12+731-server-java17-26.zip`.

- Archive ZIP sans dossier parent, 9 459 entrées.
- Taille compressée : 551 517 584 octets ; somme des tailles décompressées : 618 893 231 octets.
- Contient notamment `config/`, `mods/`, `libraries/`, `serverutilities/`, `journeymap/`, les listes de joueurs, `server.properties`, `java9args.txt` et `startserver-java9.sh`.
- Le `server.properties` de cette archive indique `level-name=World`. Ce nom ne doit pas être codé en dur : le monde source doit être identifié à partir de l’ancien serveur et rester cohérent avec la configuration finale.
- Cette inspection porte sur l’archive neuve ; aucune structure ni donnée de l’ancien serveur n’a été inspectée.

## Validation attendue de l’application future

- Parcours archive locale et URL distante, sur les deux plateformes desktop.
- Fichiers identiques filtrés ; différences affichées et choix de fusion respectés.
- Ancien dossier `mods` jamais repris ; nouveaux mods issus de l’archive conservés.
- Monde copié correspondant au `level-name` final ; données joueurs et données hors monde traitées selon la décision de migration.
- Destination invalide, espace insuffisant et archive dangereuse refusés sans modification de l’ancien serveur.
- Interruption SSH et annulation traitées selon une politique explicite, avec état final compréhensible et sans faux succès.
- Ancien serveur intact après succès, erreur ou annulation.

Ces scénarios étaient des critères à implémenter ; leur couverture actuelle figure dans la matrice de validation ci-dessous.

## Révision 2026-09-19

La fusion repose désormais sur l’archive d’origine de l’ancienne version, fournie obligatoirement par l’utilisateur. Voir [Définir la fusion des fichiers](issues/02-fusion-fichiers.md) ; cette décision remplace les points « comparaison des fichiers différents » et « l’archive d’origine n’est pas fournie » ci-dessus.

## Matrice de validation

Décidée dans [Valider le parcours et les contrats IPC](issues/05-parcours-ipc.md). Commandes : `pnpm test` (unitaires et intégration SSH locale), `pnpm test:e2e` (hôte Linux réel, `GTNH_E2E_*`), `pnpm smoke:ipc` (main réel et pont IPC contre un hôte réel), `pnpm smoke:ui` (rendu), `pnpm dist:win` / `pnpm dist:linux` (paquets). État au 2026-09-19 : tous verts sur Windows 11 et l’hôte de test Debian 13, avec l’installation réelle daily-731.

| Critère | Couverture | Manque |
| --- | --- | --- |
| Archive locale | e2e : déploiement SFTP synthétique et réel (551 Mo, 9 459 entrées) | — |
| Archive par URL | unitaire : HTTPS seul, sans identifiants ; e2e réel : daily-746 (552 Mo) téléchargée par le serveur depuis GitHub puis déployée | — |
| Sélection d’une release GTNH | unitaire réseau (`GTNH_NETWORK_TESTS=1`) : liste, tag et archive serveur Java 17 de la dernière release ; visuel : page `?fixture=archive-source` | interface cliquée avec GitHub injoignable : manuel |
| Deux plateformes desktop | `dist:docker` : installateur NSIS, AppImage et deb produits dans un seul conteneur ; Windows : installateur extrait et application démarrée ; Linux : deb installé et AppImage lancés sous Xvfb dans Ubuntu 24.04 | parcours cliqué sur un poste Linux avec affichage réel : manuel |
| Fichiers identiques filtrés, différences et choix respectés | unitaire : classification, fusion 3-voies, décisions, comparaison clé par clé des configurations ; e2e synthétique : fusion appliquée, contenu vérifié, réécriture de mod non proposée ; e2e réel 731 → 746 : 10 modifications utilisateur et 2 conflits (`GregTech.cfg`, `server.properties`) sur 8 918 fichiers comparés | résolution des conflits réels appliquée : manuel |
| Anciens `mods` jamais repris, nouveaux conservés | unitaire : exclusions ; e2e synthétique : seul le nouveau jar reste ; e2e réel : aucun fichier `mods/` proposé | — |
| Monde conforme au `level-name`, données joueurs et hors monde | unitaire : `level-name`, liste ServerUtilities ; e2e synthétique : copie, SHA-256 identique, `level-name` réécrit, données hors monde copiées ; e2e réel : plan de migration | copie du monde réel (1,3 Go) non exécutée en e2e |
| Destination invalide, espace insuffisant, archive dangereuse refusés | unitaire : chemins, arbres imbriqués, entrées dangereuses, marge d’espace, liens ; e2e : outils manquants signalés, confirmation exacte exigée | espace insuffisant réel : manuel sur un volume plein |
| Interruption SSH et annulation explicites | e2e : commande suivie tuée à la coupure, orphelins listés et arrêtés, annulation pendant l’envoi avec nettoyage ; unitaire : registre d’opérations | coupure réseau réelle (câble, VPN) : manuel |
| Ancien serveur intact | e2e : empreinte complète (contenu, mode, date) identique avant et après déploiement, fusion, migration et annulation, sur les arbres synthétique et réel | — |
| Contrats IPC | unitaire : un schéma par canal, refus de payloads invalides ; `smoke:ipc` : expéditeur, liste blanche du preload, validation et appels réels | — |
| Identité d’hôte, profils, secrets | intégration : serveur SSH local (confiance au premier usage, clé changée, clé refusée) ; unitaire : profils et passphrase chiffrée | stockage `safeStorage` réel sous Linux sans trousseau : manuel |
| Parcours et rapport | unitaire : verrouillage des étapes, sauts, rapport Markdown ; `smoke:ui` : rendu du stepper | parcours complet cliqué dans l’interface : manuel |
