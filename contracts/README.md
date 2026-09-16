# contracts/

TakeoverEscrow lives at `src/TakeoverEscrow.sol`: the TAKEOVER USDT
escrow on Polygon. The interface is specified in
`docs/escrow-contract-interface.md` (authoritative); Foundry tests live
in `test/` (unit + fuzz + invariant).

Pinned: Solidity 0.8.28, OpenZeppelin Contracts v5.7.0 (submodule).
Build/test with `forge` from this directory.

Deployed (Amoy, chainId 80002):
`0x7F8F66E1e07372dc371edf8F21d2d84208a4Fc06` — USDT
`0xC885e1eeD2A2f2215b756Fa04B89aAD1A27559dE`, signer per `contracts/.env`.
