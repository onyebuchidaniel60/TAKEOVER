// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TakeoverEscrow} from "../src/TakeoverEscrow.sol";

/// @notice Deploys TakeoverEscrow to Polygon Amoy (chainId 80002).
/// @dev Reads TOKEN_ADDRESS, SIGNER_ADDRESS, DEPLOYER_PRIVATE_KEY from the
///      environment (contracts/.env is auto-loaded when run from contracts/).
///      Simulate: forge script script/DeployAmoy.s.sol --rpc-url $AMOY_RPC_URL
///      Deploy:   ... --broadcast
contract DeployAmoy is Script {
    function run() external returns (TakeoverEscrow) {
        address token = vm.envAddress("TOKEN_ADDRESS");
        address signer = vm.envAddress("SIGNER_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        TakeoverEscrow escrow = new TakeoverEscrow(token, signer);
        vm.stopBroadcast();
        console.log("TakeoverEscrow deployed at:", address(escrow));
        return escrow;
    }
}
