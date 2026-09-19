# Périmètre convenu — GTNH Server Updater

Status: cadrage validé ; décisions techniques ouvertes

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

Ces scénarios sont des critères à implémenter et tester ultérieurement, pas des tests déjà exécutés.
