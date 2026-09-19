# Définir le déploiement distant

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Codex
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: none

## Question

Quel contrat de déploiement permet de télécharger ou transférer le ZIP et de l’extraire dans le nouveau dossier Linux sans modifier l’ancien serveur ?

À résoudre : prérequis Linux et outils disponibles, validation des URL, validation du contenu ZIP, dossier parent éventuel, chemins absolus et relatifs, liens symboliques, séparation des dossiers source et destination, destination existante, permissions, espace disponible et fichiers temporaires. Définir aussi comment sélectionner les dossiers distants.

Partir de l’archive réelle décrite dans le [périmètre](../spec.md). Définir les contrôles préalables, les erreurs affichées et les scénarios de validation avant de choisir l’implémentation.

## Comments

Aucune décision technique résolue lors de la création du ticket.

- 2026-09-19 — Ticket réclamé pour la session de décision avec l’utilisateur.

## Answer

Le serveur distant fournit un shell POSIX, `curl` et `unzip`; aucune commande n’utilise `sudo`. Une archive locale est transférée par SFTP et une URL publique est téléchargée sur le serveur avec HTTPS uniquement, cinq redirections HTTPS au maximum et aucune authentification HTTP.

Les chemins sont absolus et sélectionnables par navigateur distant ou saisie. `/`, les destinations symboliques, les chemins identiques et les arbres imbriqués sont refusés après résolution physique. L’ancien serveur est uniquement lu pendant les contrôles. Le parent de destination doit exister et être accessible en écriture.

Le ZIP est stocké temporairement à côté de la destination, testé intégralement et inspecté avant suppression. Les chemins absolus, segments `..`, antislashs, liens et fichiers spéciaux sont bloquants. `config/`, `mods/` et `server.properties` doivent se trouver directement à la racine; un dossier parent englobant est refusé. L’espace libre doit couvrir la taille décompressée plus 10 %.

Une destination non vide exige la saisie exacte de son chemin résolu. Après confirmation, elle est supprimée, recréée et le ZIP est extrait directement. Le ZIP temporaire est supprimé après succès. Après échec d’extraction, le ZIP et les fichiers partiels restent en place et leurs chemins figurent dans le résultat; aucun rollback n’est tenté.

Implémentation initiale : service SSH et déploiement, contrats partagés, preload IPC limité, interface anglaise et tests de politique. La vérification de clé d’hôte, les interruptions et la reprise restent dans [Définir les connexions et la reprise après erreur](04-connexions-reprise.md).
