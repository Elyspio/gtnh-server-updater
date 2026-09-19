# GTNH Server Updater — cartographie Wayfinder

Status: open
Labels: wayfinder:map

## Destination

Définir une application Electron permettant de préparer un nouveau serveur GTNH sur Linux via SSH, de fusionner les configurations et de copier le monde. La cartographie est terminée quand les décisions nécessaires à l’implémentation sont résolues et que la spécification est exploitable sans choix fonctionnel restant.

## Notes

- [Périmètre convenu et validation](spec.md) : exigences approuvées pendant le cadrage initial ; ce document n’est pas encore une spécification d’implémentation complète.
- [Suivi Markdown local](tracker.md) : conventions de tickets, dépendances, attribution et résolution.
- Consulter les skills `wayfinder`, `grilling` et `domain-modeling` pour les sessions de décision.
- Poser les questions via l’interface GUI ; réponses concises et techniques en français, interface de l’application en anglais.
- Ne pas lancer de sous-agents sans demande explicite de l’utilisateur.
- Chaque ticket existant est une décision HITL à résoudre avec l’utilisateur. Ne pas transformer des propositions techniques en décisions acquises.
- La création de cette carte ne développe pas l’application et ne résout aucun ticket.

## Decisions so far

- [Définir le déploiement distant](issues/01-deploiement-distant.md) — Déploiement sans sudo, ZIP strictement validé avant suppression confirmée, puis extraction directe avec conservation des fichiers partiels en cas d’échec.

## Not yet specified

Aucune zone supplémentaire identifiée au-delà des tickets ouverts. Réévaluer cette section lors de chaque résolution ; de nouvelles questions pourront émerger de l’étude du serveur existant et de la fusion.

## Out of scope

- Arrêt et démarrage automatiques du serveur : l’utilisateur les gère manuellement.
- Modification ou suppression de l’ancien serveur.
- Identification automatique des personnalisations sans archive d’origine de l’ancienne version.
- Livraison de l’application pendant cette étape de cartographie.
