# Définir la migration des données GTNH

Type: grilling
Labels: wayfinder:grilling
Status: open
Assignee: unassigned
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 02

## Question

Quelles données doivent accompagner le monde copié pour préserver l’état du serveur et des joueurs, et comment garantir leur cohérence avec la configuration fusionnée ?

À résoudre après [Définir la fusion des fichiers](02-fusion-fichiers.md) : lecture du `level-name` source, nom du monde cible, monde absent ou emplacement atypique, données joueurs et dimensions, données hors monde, rôles respectifs de `serverutilities/` et `journeymap/`, liens éventuels et exclusions de sauvegardes.

Définir le moment de confirmation de l’arrêt manuel, l’ordre copie/fusion et les contrôles de complétude. La copie doit conserver l’ancien serveur intact ; la présence de données dans l’ancien serveur doit être vérifiée et non déduite de l’archive neuve.

## Comments

Aucune décision technique résolue lors de la création du ticket.
