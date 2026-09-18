// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TakeoverEscrow} from "../src/TakeoverEscrow.sol";

/// @notice Deploys TakeoverEscrow to Polygon mainnet (chainId 137).
/// @dev Reads TOKEN_ADDRESS, SIGNER_ADDRESS, DEPLOYER_PRIVATE_KEY from the
///      environment (mainnet values — pass explicitly; contracts/.env still
///      carries the Amoy TOKEN_ADDRESS). Constructor: (token, signer).
///      Simulate: forge script script/DeployPolygon.s.sol --rpc-url <MAINNET_RPC>
///      Deploy:   ... --broadcast
contract DeployPolygon is Script {
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
