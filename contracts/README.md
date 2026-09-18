# contracts/

TakeoverEscrow lives at `src/TakeoverEscrow.sol`: the TAKEOVER USDT
escrow on Polygon. The interface is specified in
`docs/escrow-contract-interface.md` (authoritative); Foundry tests live
in `test/` (unit + fuzz + invariant).

Pinned: Solidity 0.8.28, OpenZeppelin Contracts v5.7.0 (submodule).
Build/test with `forge` from this directory.

Deployed (Polygon mainnet, chainId 137, 14j-1):
`0x7F8F66E1e07372dc371edf8F21d2d84208a4Fc06` (deploy tx
`0x69be60fcb56601d8e83fd469cbe858a59f9e705201a114e32edb08ab811c47fa`)
— USDT `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`, signer per `contracts/.env`.
(The same address exists on Amoy from 14e-2a — a CREATE-nonce coincidence,
not the live contract. Amoy USDT was `0xC885e1eeD2A2f2215b756Fa04B89aAD1A27559dE`.)
