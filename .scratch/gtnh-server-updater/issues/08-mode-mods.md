# Remplacer un mod par sa propre version

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Claude
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 04, 05

## Question

Comment remplacer de façon fiable la version GTNH d'un mod (ici le Matter Manipulator) par un build personnel, sur le serveur et sur les clients, depuis l'application ?

## Comments

- 2026-11-21 — Demande de l'utilisateur : deux modes dans l'application, « mods » et « server update ».
- 2026-11-21 — Faits relevés : serveur `root@ely-minecraft`, service systemd `gtnh.service` (`User=minecraft`, `WorkingDirectory=/data/gtnh/2.9.0`, `screen` + `startserver-java9.sh` qui relance Java en boucle, `ExecStop` envoie `stop`, `TimeoutStopSec=120`). Le démarrage complet se lit dans `logs/fml-server-latest.log` (`Sent event FMLServerStartedEvent to mod FML`) ; `logs/latest.log` reste quasi vide. Clients : PrismLauncher, `%APPDATA%\PrismLauncher\instances`, nom dans `instance.cfg`. Le fork du mod n'a ni release ni CI. La fusion du parcours de mise à jour exclut `/mods/` et `*.jar` : un JAR personnel disparaît sans bruit à la mise à jour suivante.

## Answer

Un second mode, **Mods**, s'ajoute au parcours **Server update** ; la bascule est en en-tête et le profil SSH est partagé. Le mode est générique (tout modid) et chaque action est ponctuelle : rien n'est réappliqué automatiquement.

**Source.** Un dossier de builds (par exemple `build/libs`). Chaque JAR doit déclarer exactement un modid dans `mcmod.info` (format liste ou `modListVersion` 2) ; les JAR `-dev`, `-sources`, `-javadoc`, `-api` et `-deobf` sont ignorés. Le dossier est mémorisé pour chaque modid trouvé. L'application propose une entrée par version (préfixe numérique de la version `mcmod.info`), avec son build le plus récent présélectionné ; les autres builds restent affichables.

**Cibles.**
- Serveur : le profil gagne un champ « service systemd » (`gtnh` par défaut). Le dossier serveur est lu par `systemctl show -p WorkingDirectory`. Aucun chemin à retaper après une mise à jour.
- Instances Prism : dossier par défaut `%APPDATA%\PrismLauncher\instances` (ou `InstanceDir` de `prismlauncher.cfg`), surcharge mémorisée. L'utilisateur coche les instances ; seules celles qui contiennent déjà le modid sont cochables ; une instance lancée est refusée.
- Serveur seul ou clients seuls possibles.

**Identification de l'original.** Le JAR de `mods/` (et `mods/1.7.10/`) dont `mcmod.info` porte le modid. Zéro ou plusieurs correspondances : cible refusée. Refus aussi si le JAR choisi est identique (SHA-256) à celui en place.

**Serveur d'abord.** Confirmation du redémarrage (pas de détection des joueurs), envoi SFTP vers un temporaire hors de `mods/`, `systemctl stop`, original déplacé dans `mods-backup/<modid>/<date>/`, JAR placé sous son nom personnel avec propriétaire et droits de l'original, `systemctl start`.

**Vérification du démarrage.** Succès : le `logs/fml-server-latest.log` régénéré contient `Sent event FMLServerStartedEvent to mod FML`. Échec : nouveau fichier dans `crash-reports/`, `Encountered an unexpected exception`, nouveau journal (relance par la boucle du script), service inactif, ou 10 minutes sans succès. En cas d'échec : `systemctl stop` et rapport avec un extrait du journal ; pas de retour arrière automatique.

**Clients ensuite**, seulement après un démarrage serveur réussi (ou sans cible serveur) : même sauvegarde hors de `mods/`, puis remplacement.

**Sauvegardes et restauration.** Chaque sauvegarde garde l'original et l'empreinte du JAR installé à sa place. Cinq sauvegardes par modid : la plus ancienne (l'original GTNH) et les quatre plus récentes. « Restaurer » remet la plus ancienne, avec le même enchaînement arrêt, démarrage et vérification ; elle est refusée si le JAR en place n'est pas celui que l'application a installé en dernier.

**Parcours de mise à jour.** `/mods-backup/` est exclu de la fusion. Le rapport final signale les mods personnels actifs de l'ancien serveur, à refaire via le mode Mods.

Hors périmètre : distribution aux autres joueurs, build Gradle depuis l'application, releases GitHub du fork, annonce en jeu avant redémarrage.
