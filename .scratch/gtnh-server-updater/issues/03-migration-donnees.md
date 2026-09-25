# Définir la migration des données GTNH

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Claude
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 02

## Question

Quelles données doivent accompagner le monde copié pour préserver l’état du serveur et des joueurs, et comment garantir leur cohérence avec la configuration fusionnée ?

À résoudre après [Définir la fusion des fichiers](02-fusion-fichiers.md) : lecture du `level-name` source, nom du monde cible, monde absent ou emplacement atypique, données joueurs et dimensions, données hors monde, rôles respectifs de `serverutilities/` et `journeymap/`, liens éventuels et exclusions de sauvegardes.

Définir le moment de confirmation de l’arrêt manuel, l’ordre copie/fusion et les contrôles de complétude. La copie doit conserver l’ancien serveur intact ; la présence de données dans l’ancien serveur doit être vérifiée et non déduite de l’archive neuve.

## Comments

Aucune décision technique résolue lors de la création du ticket.

- 2026-09-19 — Ticket réclamé pour la session de décision avec l’utilisateur.
- 2026-09-19 — Fait relevé : le `serverutilities.cfg` de GTNH liste dans `additional_backup_files` les données liées au monde situées hors de son dossier (`visualprospecting/server/$WORLDNAME_*`, `TCNodeTracker/$WORLDNAME`, `journeymap/data/sp/$WORLDNAME`, chemins client `saves/NEI/...` et `visualprospecting/client/...`).

## Answer

L’utilisateur confirme l’arrêt manuel de l’ancien serveur dès le début du parcours, par une case à cocher sans détection de processus. Déploiement, fusion et migration restent bloqués tant qu’elle n’est pas cochée. La migration s’exécute après l’application de la fusion.

Le monde source est le dossier `level-name` du `server.properties` de l’ancien serveur ; il doit exister et contenir `level.dat`. Il est copié sous ce même nom. Si le `server.properties` du nouveau serveur porte un autre `level-name`, seule cette ligne est réécrite à la valeur source, et le changement figure dans le récapitulatif. Les autres dossiers contenant un `level.dat` sont listés en information, non copiés et exclus de la fusion.

Les données hors monde proviennent de `additional_backup_files` dans l’ancien `serverutilities/serverutilities.cfg`, avec `$WORLDNAME` remplacé. Si le fichier ou la clé manque, la liste GTNH par défaut (`journeymap/data/sp/$WORLDNAME/**`, `TCNodeTracker/$WORLDNAME/**`, `visualprospecting/server/$WORLDNAME_*/**`) est utilisée avec un avertissement. Les chemins client (`saves/`, `visualprospecting/client/`) sont ignorés ; les chemins absents sont signalés sans bloquer. Les chemins migrés sont exclus de la fusion.

Les liens symboliques dans les données copiées sont bloquants. L’espace libre doit couvrir la taille source plus 10 %. Une cible déjà présente dans le nouveau serveur exige la saisie exacte du chemin du monde cible avant remplacement.

Chaque chemin est copié par `cp -a` vers un nom temporaire, vérifié par nombre de fichiers et nombre d’octets, puis renommé. En cas d’échec, les fichiers partiels restent en place et sont signalés ; aucun rollback n’est tenté. L’ancien serveur n’est que lu.
