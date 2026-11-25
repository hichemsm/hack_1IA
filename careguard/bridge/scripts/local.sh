#!/usr/bin/env bash
# Chaîne locale pour développer et tester CareGuard sans le testnet :
#   anvil (EVM Shanghai, chain-id 44005 comme Aevum) + MockUSD + CareVault, puis interface/.env.local
# Usage : pnpm local    (Ctrl+C arrête anvil)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RPC_URL="http://127.0.0.1:8545"
ENV_FILE="$ROOT/interface/.env.local"
ANVIL_LOG="${TMPDIR:-/tmp}/careguard-anvil.log"

# Clés de test PUBLIQUES d'anvil (mnémonique « test test … junk ») — aucune valeur réelle
GUARDIAN_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # compte 0 : aidante
TX_AGENT_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d  # compte 1 : agent transaction
SECURITY_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a  # compte 2 : agent sécurité

for bin in anvil forge cast; do
  command -v "$bin" >/dev/null || { echo "❌ $bin introuvable : installez Foundry (https://getfoundry.sh)" >&2; exit 1; }
done
if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  echo "❌ Un nœud répond déjà sur $RPC_URL : arrêtez-le avant de relancer pnpm local." >&2
  exit 1
fi

anvil --hardfork shanghai --chain-id 44005 --port 8545 >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 50); do
  cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
  kill -0 "$ANVIL_PID" 2>/dev/null || { echo "❌ anvil s'est arrêté, voir $ANVIL_LOG" >&2; exit 1; }
  sleep 0.2
done
cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 || { echo "❌ anvil ne répond pas, voir $ANVIL_LOG" >&2; exit 1; }

TX_AGENT_ADDRESS=$(cast wallet address --private-key "$TX_AGENT_KEY")
SECURITY_SIGNER_ADDRESS=$(cast wallet address --private-key "$SECURITY_KEY")

echo "▶ Déploiement de MockUSD + CareVault…"
DEPLOY_OUT=$(
  cd "$ROOT/bridge/contracts" &&
  GUARDIAN_PRIVATE_KEY="$GUARDIAN_KEY" TX_AGENT_ADDRESS="$TX_AGENT_ADDRESS" SECURITY_SIGNER_ADDRESS="$SECURITY_SIGNER_ADDRESS" \
    forge script script/DeployLocal.s.sol --rpc-url "$RPC_URL" --broadcast --legacy 2>&1
) || { echo "$DEPLOY_OUT" >&2; echo "❌ Échec du déploiement" >&2; exit 1; }

TUSD8_ADDRESS=$(grep -oE 'TUSD8_ADDRESS=0x[0-9a-fA-F]{40}' <<<"$DEPLOY_OUT" | head -1 | cut -d= -f2)
CAREVAULT_ADDRESS=$(grep -oE 'CAREVAULT_ADDRESS=0x[0-9a-fA-F]{40}' <<<"$DEPLOY_OUT" | head -1 | cut -d= -f2)
if [[ -z "$TUSD8_ADDRESS" || -z "$CAREVAULT_ADDRESS" ]]; then
  echo "$DEPLOY_OUT" >&2; echo "❌ Adresses introuvables dans la sortie du déploiement" >&2; exit 1
fi

# Ne jamais écraser une configuration testnet sans la sauvegarder
if [[ -f "$ENV_FILE" ]] && ! grep -q '^AEVUM_RPC_URL=http://127.0.0.1' "$ENV_FILE"; then
  cp "$ENV_FILE" "$ENV_FILE.bak"
  echo "ℹ $ENV_FILE existant sauvegardé dans $ENV_FILE.bak"
fi

cat >"$ENV_FILE" <<EOF
# Généré par bridge/scripts/local.sh — chaîne LOCALE anvil, clés de test publiques d'anvil uniquement
AEVUM_RPC_URL=$RPC_URL
NEXT_PUBLIC_AEVUM_RPC_URL=$RPC_URL
CAREVAULT_ADDRESS=$CAREVAULT_ADDRESS
TUSD8_ADDRESS=$TUSD8_ADDRESS
TX_AGENT_PRIVATE_KEY=$TX_AGENT_KEY
SECURITY_PRIVATE_KEY=$SECURITY_KEY
EOF

cat <<EOF

✅ Chaîne locale prête ($RPC_URL, chain-id 44005)
   tUSD8 (MockUSD) : $TUSD8_ADDRESS
   CareVault       : $CAREVAULT_ADDRESS  (1 000 tUSD8 déposés)
   Aidante         : compte anvil 0
   Agent tx        : $TX_AGENT_ADDRESS (compte 1)
   Agent sécurité  : $SECURITY_SIGNER_ADDRESS (compte 2)
   Config écrite   : $ENV_FILE

   Dans un autre terminal : pnpm test:e2e   ou   pnpm dev
   Ctrl+C pour arrêter anvil (log : $ANVIL_LOG)
EOF

wait "$ANVIL_PID"
