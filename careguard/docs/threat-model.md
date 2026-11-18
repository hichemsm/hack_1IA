# Modèle de menaces — CareGuard

| Menace | Exemple | Défense | Où |
|---|---|---|---|
| Fausse facture | Facture d'un « kiné » inconnu | Liste blanche des soignants | `CareVault._checkAndConsumeLimits` |
| Changement de RIB | « Payez sur ce nouveau compte » | L'adresse de paiement vient du registre, jamais de la facture ; modifier un soignant relance le délai de 48 h | `CareVault.addProvider` |
| Prompt injection | Texte caché dans un PDF | Le LLM n'a ni outil ni clé ; l'agent sécurité relit la facture brute ; détection de texte suspect | `core/src/agents/security.ts`, `core/src/llm.ts` |
| Orchestrateur compromis | Ordre de paiement forcé | Signature EIP-712 de l'agent sécurité exigée par le contrat | `CareVault._checkAuth` |
| Orchestrateur et sécurité compromis | Signature valide d'un mauvais paiement | Plafonds par paiement et par jour, seuil de double validation, soignant actif | `CareVault` |
| Facture payée deux fois | Renvoi du même PDF | `invoiceUsed[hash]` | `CareVault` |
| Modification du montant après signature | 16 € signés, 2 000 € envoyés | Le montant fait partie du message signé | `APPROVAL_TYPEHASH` |
| Rejeu d'une vieille signature | Accord réutilisé des jours après | `deadline` de 15 minutes | `CareVault._checkAuth` |
| Fuite de données de santé | Données lisibles on-chain | Seuls des hashes et des montants sont publiés | `core/src/ids.ts` |
| Clé d'agent volée | Serveur compromis | Révocation instantanée par l'aidante, expiration des agents | `CareVault.revokeAgents`, `setAgents` |
