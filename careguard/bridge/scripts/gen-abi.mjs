// Régénère bridge/src/abi.generated.ts depuis la sortie Foundry (après `forge build`).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artifact = join(here, "../contracts/out/CareVault.sol/CareVault.json");
const out = join(here, "../src/abi.generated.ts");

const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
writeFileSync(
  out,
  `// Généré par bridge/scripts/gen-abi.mjs — ne pas modifier à la main\nexport const careVaultAbiFull = ${JSON.stringify(abi, null, 2)} as const;\n`,
);
console.log(`ABI complète écrite dans ${out} (${abi.length} entrées)`);
