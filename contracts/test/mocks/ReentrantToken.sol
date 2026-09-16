// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TakeoverEscrow} from "../../src/TakeoverEscrow.sol";

/// @notice ERC20 that attempts a one-shot reentry into the escrow's release()
///         on every transfer/transferFrom while armed. The reentrant call is
///         swallowed (try/catch) so tests can assert the guard held AND the
///         outer flow completed with exact balances.
contract ReentrantToken is ERC20 {
    TakeoverEscrow public target;
    bytes32 public targetId;
    address public targetTo;
    bool public armed;
    bool public entered;

    constructor() ERC20("Reentrant", "RNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address escrow, bytes32 id, address to) external {
        target = TakeoverEscrow(escrow);
        targetId = id;
        targetTo = to;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _attemptReentry();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _attemptReentry();
        return super.transferFrom(from, to, amount);
    }

    function _attemptReentry() internal {
        if (!armed) return;
        armed = false;
        entered = true;
        try target.release(targetId, targetTo) {} catch {}
    }
}
