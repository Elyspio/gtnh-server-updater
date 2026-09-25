# Définir la fusion des fichiers

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Claude
Parent: [GTNH Server Updater — cartographie Wayfinder](../map.md)
Blocked by: none

## Question

Comment comparer les deux installations et permettre une fusion manuelle ligne par ligne, en conservant explicitement les choix de l’utilisateur ?

À résoudre : liste exacte des exclusions, détection des fichiers identiques, présentation du diff et du résultat éditable, granularité des choix, valeurs initiales, fichiers propres à une version, éventuelles suppressions, encodages, fins de ligne, gros fichiers et binaires. Préciser quand les choix sont enregistrés et quand les fichiers distants sont effectivement modifiés.

Ne pas assimiler une différence à une personnalisation : aucune base commune n’est disponible. Définir les scénarios de validation pour les configurations texte, scripts, listes de joueurs et fichiers binaires.

## Comments

Aucune décision technique résolue lors de la création du ticket.
- 2026-09-19 — Ticket réclamé pour la session de décision avec l’utilisateur.
- 2026-09-19 — Premier tour sur une comparaison 2-voies (exclusions, sha256sum, défauts). L’utilisateur précise ensuite l’objectif : reprendre uniquement les fichiers modifiés par l’utilisateur depuis la dernière installation, pas ceux modifiés par le changement de version. L’archive d’origine de l’ancienne version devient donc obligatoire et sert de base à une comparaison 3-voies.
- 2026-09-20 — Le classement octet par octet s’est révélé trop bruyant sur l’installation réelle ; il est affiné par [Distinguer les modifications utilisateur des réécritures de mods](06-bruit-configuration.md), qui remplace aussi la copie cochée par défaut des fichiers ajoutés.
- 2026-09-19 — Test réel (installation daily-731 d’`ely-minecraft` copiée sur un serveur de test, archive d’origine daily-731) : 8 918 fichiers d’origine comparés en 16 s, 94 modifiés, 160 ajoutés. `server.zip` (525 Mo), `World-*.zip` (798 Mo), `.healer.log`, `GregTech.lang` et `coretweaks/cache|out` apparaissaient comme ajouts utilisateur copiés par défaut ; l’utilisateur a décidé de les ajouter aux exclusions fixes. Beaucoup de configurations sont réécrites par les mods au démarrage : elles apparaissent comme modifications utilisateur, ce qui reste sans risque tant que la nouvelle version ne les change pas (sinon fusion 3-voies).

## Answer

Trois arbres sont comparés : ancien serveur, base (archive d’origine de l’ancienne version) et nouveau serveur extrait. La base est obligatoire ; elle est fournie comme ZIP local (SFTP) ou URL HTTPS, validée avec les mêmes règles que le déploiement, extraite dans un dossier temporaire à côté de la destination puis supprimée après l’application. Son espace décompressé est compté dans le contrôle d’espace.

Exclusions fixes : `mods/`, `libraries/`, `*.jar`, `logs/`, `crash-reports/`, `backups/`, caches (`.cache/`, `*.tmp`), archives à la racine (`/*.zip`), `*.log`, `coretweaks/cache/`, `coretweaks/out/`, `GregTech.lang` (régénéré au démarrage) et dossiers monde avec leurs données (traités par la migration). L’utilisateur peut ajouter des motifs glob pour la session. L’identité est calculée par taille puis `sha256sum` distant (ajouté aux prérequis) ; aucune normalisation.

Classification (O = ancien, B = base, N = nouveau) :

- O = B, ou fichier absent de O mais présent dans B (supprimé par l’utilisateur) : nouveau conservé, non affiché.
- O ≠ B et N = B : modification utilisateur seule ; ancien repris, coché par défaut.
- O ≠ B et N ≠ B : conflit ; pré-fusion 3-voies, les blocs modifiés d’un seul côté sont appliqués, les blocs modifiés des deux côtés sont tranchés (nouveau / ancien / les deux) avec résultat éditable. Refuser la fusion = nouveau. Un fichier présent dans O et N mais absent de B est un conflit à base vide.
- O présent, absent de B et de N : ajout utilisateur ; copie cochée par défaut.
- O ≠ B et N absent : retiré par la nouvelle version ; copie proposée, décochée.
- Tout le reste : nouvelle version. Aucun fichier du nouveau serveur n’est supprimé.

Binaires (octet NUL), texte non UTF-8 ou fichiers > 2 Mo en conflit : choix fichier entier, défaut nouveau. Le résultat texte conserve l’encodage UTF-8, le BOM, les fins de ligne, le newline final et le mode du fichier nouveau.

Présentation : arbre filtrable par statut, actions en masse par dossier. Si plus de 50 % des fichiers de la base comparés diffèrent de l’ancien serveur, ou si `config/` ou `server.properties` manquent dans la base, un avertissement doit être confirmé avant de continuer.

Les choix restent en mémoire ; un récapitulatif précède l’application groupée dans le nouveau dossier uniquement (fichier temporaire puis rename). L’ancien serveur n’est que lu. La persistance des choix relève de [Définir les connexions et la reprise après erreur](04-connexions-reprise.md) ; `level-name` et données du monde relèvent de [Définir la migration des données GTNH](03-migration-donnees.md).
