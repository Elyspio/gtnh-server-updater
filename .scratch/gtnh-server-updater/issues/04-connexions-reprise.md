# Définir les connexions et la reprise après erreur

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Claude
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 01

## Question

Comment établir une connexion SSH fiable et rendre explicite l’état d’un déploiement interrompu, annulé ou échoué ?

À résoudre après [Définir le déploiement distant](01-deploiement-distant.md) : données des profils, formats de clés, passphrases, conservation éventuelle des secrets, vérification de l’identité de l’hôte, première connexion et changement de clé d’hôte.

Définir ensuite les délais, erreurs d’authentification, déconnexions pendant transfert/extraction/copie/écriture, comportement des opérations distantes après perte de connexion, annulation, nettoyage, journalisation sans secrets et possibilité de reprise ou de redémarrage contrôlé. Couvrir aussi la fermeture de l’application et les sessions concurrentes.

## Comments

Aucune décision technique résolue lors de la création du ticket.

- 2026-09-19 — Ticket réclamé pour la session de décision avec l’utilisateur.
- 2026-09-19 — Faits relevés : aucune vérification de clé d’hôte dans la tranche initiale (toute clé acceptée) ; chaque appel ouvre une connexion ; opérations gardées en mémoire seulement.
- 2026-09-19 — Implémentation : la pty envisagée est remplacée par un chien de garde sur l’entrée standard du canal (une pty fusionne stdout et stderr et convertit les fins de ligne). Comportement vérifié sous `sh`/dash dans WSL : arrêt normal avec code de sortie conservé, groupe tué 2 s après fermeture de l’entrée, fichiers PID nettoyés. `kill -- -PID` est refusé par dash ; la forme `kill -TERM -PID` est utilisée.
- 2026-09-19 — Tests de bout en bout sur un serveur Debian 13 (`pnpm test:e2e`) : identité via `known_hosts`, prérequis manquants signalés (`curl`, `unzip`), annulation pendant un envoi SFTP, arrêt d’une commande suivie à la coupure, orphelins listés et arrêtés. Corrections issues de ces tests : les appels SFTP échouent désormais dès la perte de connexion (ils restaient bloqués), un `trap` supprime le fichier PID quand sshd signale le shell à la coupure, les ZIP créés sous Windows (entrées de type `?`) sont acceptés, et les temporaires d’un preflight ou d’une fusion préparés mais jamais appliqués sont supprimés à la fermeture de l’application.

## Answer

Identité de l’hôte : `~/.ssh/known_hosts` OpenSSH est lu (entrées hachées incluses, `[hôte]:port` si port ≠ 22, alias de `~/.ssh/config` non résolus), complété par un `known_hosts` propre à l’application dans `userData`. Clé connue : connexion. Clé inconnue : empreinte SHA256 affichée et acceptation explicite, puis ajout au fichier de l’application. Clé différente d’une clé connue : refus sans contournement dans l’application.

Profils : plusieurs profils nommés (hôte, port, utilisateur, chemin de clé, chemins serveur) en JSON dans `userData`. La passphrase n’est stockée que sur demande, chiffrée par Electron `safeStorage` ; si le chiffrement est indisponible ou si le backend Linux est `basic_text`, elle n’est pas stockée et reste en mémoire pour la session.

Connexion : délai de connexion 20 s, keepalive 10 s × 3. Les erreurs distinguent hôte injoignable, authentification refusée et clé d’hôte inconnue ou différente. Aucun délai sur les commandes longues.

Opérations attachées : une coupure SSH fait échouer l’étape avec un état explicite ; aucune reprise ni persistance de session. L’utilisateur relance l’étape, dont les précontrôles sont refaits. Chaque commande distante longue s’exécute dans son propre groupe de processus avec PID enregistré sur le serveur ; un chien de garde qui lit l’entrée standard du canal SSH tue ce groupe dès que le canal se ferme (coupure ou annulation). `setsid` devient un prérequis du serveur. Toute étape est annulable : le groupe distant est tué, les temporaires de l’application (ZIP téléchargé, archive d’origine extraite) sont supprimés, les fichiers partiels de destination sont conservés et listés. Cette règle remplace la conservation du ZIP après échec d’extraction décidée dans [Définir le déploiement distant](01-deploiement-distant.md). À la connexion suivante, un processus orphelin de l’application encore vivant est signalé et peut être tué.

Application : instance unique, une opération à la fois. Fermer pendant une opération demande confirmation, annule l’opération puis ferme. Un journal local sans secret (`userData/logs`, rotation 5 × 5 Mo) enregistre étapes, commandes, codes de sortie et erreurs, jamais passphrase, clé ni contenu de fichier.
