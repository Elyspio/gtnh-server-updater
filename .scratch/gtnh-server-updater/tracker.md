# Suivi local — opérations Wayfinder

Les documents de cet effort vivent dans `.scratch/gtnh-server-updater/`. `map.md` est la carte canonique ; `spec.md` conserve le périmètre initial. Chaque ticket dispose de son propre fichier dans `issues/`.

## Métadonnées

- `Type: grilling` et `Labels: wayfinder:grilling` : décision avec l’utilisateur.
- `Status: open`, `claimed` ou `resolved` : ouvert, en cours ou résolu.
- `Assignee: unassigned` tant qu’aucune session ne traite le ticket.
- `Parent` : lien vers la carte.
- `Blocked by: none` ou liste d’identifiants à deux chiffres séparés par des virgules.

## Frontier et cycle de vie

1. Parcourir les tickets par numéro croissant. Un ticket disponible est `open`, non attribué et sans dépendance non résolue.
2. Avant de le traiter, renseigner l’assignation et passer son statut à `claimed`.
3. Explorer les faits localement, puis poser les questions de décision via l’interface GUI. Ne pas répondre à la place de l’utilisateur.
4. Conserver les échanges utiles sous `## Comments`. Après résolution avec l’utilisateur, ajouter `## Answer`, puis passer le statut à `resolved`.
5. Ajouter à `map.md`, dans `Decisions so far`, un lien portant le titre du ticket et une courte synthèse. Le détail de la décision reste dans le ticket.
6. Créer les nouvelles questions révélées comme tickets distincts, puis câbler leurs dépendances. Réexaminer le brouillard et le hors-périmètre.

Une session de travail résout au plus un ticket HITL. Les tickets ouverts ne sont pas dupliqués dans le corps de la carte ; leur disponibilité se déduit des métadonnées des fichiers.

Les identifiants servent uniquement au suivi et aux relations `Blocked by`. Dans les échanges utilisateur, désigner chaque ticket par son titre, avec un lien.
