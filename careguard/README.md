# CareGuard

**Le portefeuille santé de vos proches, gardé par 4 agents.**
*« L'IA propose, le contrat dispose. Et l'aidant sait enfin ce qui sera remboursé. »*

Projet pour l'**Aevum Builder Challenge #1** (QDay × PQA Labs, DoraHacks) — paiements en **tUSD8** sur le **testnet QDay Aevum** (chain 44005).

Un aidant familial confie le portefeuille santé d'un parent âgé à 4 agents. Pour chaque facture de soins, ils affichent la part **Sécu**, la part **mutuelle** et le **reste à charge**, repèrent les fraudes, puis paient. Le smart contract exige la signature de deux agents différents et impose des plafonds que même des agents compromis ne peuvent pas franchir.

## Structure

```
careguard/
├── core/        Les 4 agents (logique pure, sans clé ni blockchain)
├── interface/   L'app de l'aidante (Next.js)
└── bridge/      Ce qui relie tout : smart contract, accès à la chaîne, câblage des agents
```

| Dossier | Contenu | Fichiers clés |
|---|---|---|
| `core/` | Orchestrateur, agent montants, agent sécurité, agent transaction, moteur de reste à charge | `src/agents/*.ts`, `src/rac/engine.ts`, `src/rac/bareme-2026-11.json` |
| `bridge/` | Contrat `CareVault` (Foundry), client viem Aevum, adaptateurs, `createCareGuard()` | `contracts/src/CareVault.sol`, `src/wiring.ts`, `src/adapters.ts` |
| `interface/` | Pages Factures, Soignants, Journal, Réglages + route API | `app/factures/page.tsx`, `app/api/invoice/route.ts` |

Sens des dépendances : `interface → bridge → core`. Le core ne connaît ni les clés ni la chaîne : il reçoit des **ports** (`core/src/ports.ts`) que `bridge/` implémente.

## Les 4 agents

| Agent | LLM | Pouvoir | Rôle |
|---|---|---|---|
| Orchestrateur | Oui | Aucun | Lit la facture, répartit le travail, rédige l'explication |
| Montants | **Non** | Aucun | Calcule Sécu / mutuelle / reste à charge, tient les plafonds annuels |
| Sécurité | Détection seulement | **Signature EIP-712 + veto** | Relit la facture brute, score de risque, signe ou refuse |
| Transaction | **Non** | **Clé de paiement** | Simule puis appelle `agentPay`, traduit les refus du contrat |

`CareVault.agentPay` n'accepte un paiement que si l'appel vient de l'agent transaction **et** porte une signature valide de l'agent sécurité. Puis il vérifie : soignant connu et actif depuis 48 h, catégorie, facture jamais payée, plafonds par paiement et par jour, seuil de double validation par l'aidante.

## Démarrage

Prérequis : Node 20+, pnpm 9, [Foundry](https://book.getfoundry.sh/).

```bash
git init && pnpm install

# Contrats
cd bridge/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.0.2
forge test -vv
cd ../..

# Moteur de reste à charge
pnpm test:core
```

### Déployer sur Aevum testnet

1. Créez **trois** wallets de test : aidante, agent transaction, agent sécurité.
2. Faucet : https://faucet.qday.info/en — du tQDAY (gas) pour l'aidante et l'agent transaction, du tUSD8 pour l'aidante.
3. `cp .env.example bridge/contracts/.env` et remplissez les clés.
4. Déployez :

```bash
cd bridge/contracts
source .env
forge script script/Deploy.s.sol --rpc-url aevum --broadcast --legacy
```

5. Approuvez puis déposez des tUSD8 dans le coffre depuis le wallet de l'aidante (`deposit`).

> La vérification du code source sur l'explorateur ne fonctionne pas encore : indiquez dans la soumission l'adresse du contrat et le commit exact déployé.

### Lancer l'interface

```bash
cp .env.example interface/.env.local   # renseigner CAREVAULT_ADDRESS et les clés des agents
pnpm dev                               # http://localhost:3000/factures
```

Sans `ANTHROPIC_API_KEY`, les agents tournent en mode hors ligne (factures JSON uniquement, détection par règles).

### Générer de l'activité on-chain

```bash
pnpm simulate -- 50 10   # 50 factures, une toutes les 10 s
```

## Démo de l'attaque (3 niveaux)

Fichier : `demo/factures/piegee.json` (ou un PDF avec texte caché).

1. **Mode normal** : l'agent sécurité détecte l'injection, le soignant inconnu et le montant anormal → bloqué.
2. **Démo « orchestrateur compromis »** : paiement forcé sans signature → le contrat refuse (« signature de l'agent sécurité manquante »).
3. **Démo « orchestrateur + sécurité compromis »** : signature valide → le contrat refuse quand même (« soignant inconnu »).

## Particularités d'Aevum

| Point | Ce qu'on fait |
|---|---|
| EVM Shanghai (pas de TSTORE, MCOPY) | `evm_version = "shanghai"`, `ReentrancyGuard` classique, OpenZeppelin v5.0.2 |
| `eth_getLogs` limité à 1 000 blocs | `getLogsChunked` dans `bridge/src/chain.ts` |
| Pas de WebSocket | Polling HTTPS toutes les 2 s |
| Transactions legacy | `gasPrice` explicite (viem) et `--legacy` (forge) |

## Données et cadre juridique

- **Aucune donnée de santé on-chain** : hash de facture, catégorie, montants et version du barème uniquement.
- Barème de remboursement versionné (`core/src/rac/bareme-2026-11.json`), son hash est cité dans chaque paiement.
- Estimation indicative : ne remplace pas le décompte ameli ni celui de la mutuelle.
- Testnet uniquement. N'utilisez jamais une clé qui détient de vrais fonds.

## Build Fresh

Tout le code de ce dépôt a été écrit après le lancement du challenge (16 novembre 2026). L'historique des commits et la date de déploiement on-chain en font foi.

## Licence

MIT
