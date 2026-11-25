// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CareVault} from "../src/CareVault.sol";
import {MockUSD} from "../test/mocks/MockUSD.sol";

/// Déploiement LOCAL (anvil) : faux tUSD8 + coffre sans délai soignant, configuré comme Deploy.s.sol,
/// alimenté de 1 000 tUSD8 par l'aidante. Lancé par bridge/scripts/local.sh.
/// forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --legacy
contract DeployLocal is Script {
    function run() external {
        uint256 guardianKey = vm.envUint("GUARDIAN_PRIVATE_KEY");
        address guardian = vm.addr(guardianKey);
        address txAgent = vm.envAddress("TX_AGENT_ADDRESS");
        address securitySigner = vm.envAddress("SECURITY_SIGNER_ADDRESS");
        // Une adresse par soignant (comptes anvil 3, 4, 5) pour pouvoir vérifier chaque solde
        address payoutMedecin = vm.envOr("PAYOUT_MEDECIN", 0x90F79bf6EB2c4f870365E785982E1f101E93b906);
        address payoutKine = vm.envOr("PAYOUT_KINE", 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65);
        address payoutPharmacie = vm.envOr("PAYOUT_PHARMACIE", 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc);

        vm.startBroadcast(guardianKey);

        MockUSD token = new MockUSD();
        CareVault vault = new CareVault(IERC20(address(token)), guardian, 0);
        vault.setAgents(txAgent, securitySigner, uint64(block.timestamp + 60 days));

        // Mêmes plafonds que Deploy.s.sol (tUSD8, 6 décimales) : par paiement, par jour
        vault.setRule(1, 60e6, 120e6); // médecin
        vault.setRule(2, 40e6, 80e6); // paramédical
        vault.setRule(3, 80e6, 150e6); // pharmacie
        vault.setRule(4, 150e6, 300e6); // aide à domicile
        vault.setApprovalThreshold(50e6);

        vault.addProvider(keccak256("medecin-martin"), payoutMedecin, 1, 1);
        vault.addProvider(keccak256("kine-dupont"), payoutKine, 2, 1);
        vault.addProvider(keccak256("pharmacie-centrale"), payoutPharmacie, 3, 1);

        token.mint(guardian, 1_000e6);
        token.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);

        vm.stopBroadcast();

        console2.log(string.concat("TUSD8_ADDRESS=", vm.toString(address(token))));
        console2.log(string.concat("CAREVAULT_ADDRESS=", vm.toString(address(vault))));
    }
}
