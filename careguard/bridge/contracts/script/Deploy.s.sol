// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CareVault} from "../src/CareVault.sol";

/// Déploie le coffre, configure les agents, les règles et 3 soignants de démo.
/// forge script script/Deploy.s.sol --rpc-url aevum --broadcast --legacy
contract Deploy is Script {
    function run() external {
        uint256 guardianKey = vm.envUint("GUARDIAN_PRIVATE_KEY");
        address guardian = vm.addr(guardianKey);
        address token = vm.envAddress("TUSD8_ADDRESS");
        address txAgent = vm.envAddress("TX_AGENT_ADDRESS");
        address securitySigner = vm.envAddress("SECURITY_SIGNER_ADDRESS");
        uint256 delay = vm.envOr("PROVIDER_DELAY", uint256(48 hours));
        // Par défaut, les soignants de démo reversent à l'aidante : les tUSD8 du testnet circulent en boucle
        address demoPayout = vm.envOr("DEMO_PAYOUT", guardian);

        vm.startBroadcast(guardianKey);

        CareVault vault = new CareVault(IERC20(token), guardian, delay);
        vault.setAgents(txAgent, securitySigner, uint64(block.timestamp + 60 days));

        // Plafonds par catégorie (tUSD8, 6 décimales) : par paiement, par jour
        vault.setRule(1, 60e6, 120e6); // médecin
        vault.setRule(2, 40e6, 80e6); // paramédical
        vault.setRule(3, 80e6, 150e6); // pharmacie
        vault.setRule(4, 150e6, 300e6); // aide à domicile
        vault.setApprovalThreshold(50e6); // au-delà : validation de l'aidante

        vault.addProvider(keccak256("medecin-martin"), demoPayout, 1, 1);
        vault.addProvider(keccak256("kine-dupont"), demoPayout, 2, 1);
        vault.addProvider(keccak256("pharmacie-centrale"), demoPayout, 3, 1);

        vm.stopBroadcast();

        console2.log("CareVault deploye a :", address(vault));
        console2.log("Soignants payables a partir de :", block.timestamp + delay);
    }
}
