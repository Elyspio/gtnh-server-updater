# Définir les connexions et la reprise après erreur

Type: grilling
Labels: wayfinder:grilling
Status: open
Assignee: unassigned
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: 01

## Question

Comment établir une connexion SSH fiable et rendre explicite l’état d’un déploiement interrompu, annulé ou échoué ?

À résoudre après [Définir le déploiement distant](01-deploiement-distant.md) : données des profils, formats de clés, passphrases, conservation éventuelle des secrets, vérification de l’identité de l’hôte, première connexion et changement de clé d’hôte.

Définir ensuite les délais, erreurs d’authentification, déconnexions pendant transfert/extraction/copie/écriture, comportement des opérations distantes après perte de connexion, annulation, nettoyage, journalisation sans secrets et possibilité de reprise ou de redémarrage contrôlé. Couvrir aussi la fermeture de l’application et les sessions concurrentes.

## Comments

Aucune décision technique résolue lors de la création du ticket.
