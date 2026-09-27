# Vendored dependencies

Dependencies are regular files, not submodules or package-manager downloads. Original Solidity
sources retain their licenses and are not modified. Unused source files are omitted. Root licenses
are retained beside each dependency. Each directory includes a `REVISION` file.
`vendor-sha256.txt` records a SHA-256 digest of every vendored file for offline integrity checks.

| Dependency | Pinned revision | Included use |
| --- | --- | --- |
| [Uniswap/v4-core](https://github.com/Uniswap/v4-core/tree/46c6834698c48bc4a463a86d8420f4eb1d7f3b75) | `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` | Core source, upstream swap/liquidity test routers and their CurrencySettler |
| [OpenZeppelin Contracts v5.1.0](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/69c8def5f222ff96f2b5beff05dfba996368aa79) | `69c8def5f222ff96f2b5beff05dfba996368aa79` | ERC20 and its interfaces/context |
| [forge-std v1.9.7](https://github.com/foundry-rs/forge-std/tree/77041d2ce690e692d6e03cc812b57d1ddaa4d505) | `77041d2ce690e692d6e03cc812b57d1ddaa4d505` | Test framework |
| [Solmate](https://github.com/transmissions11/solmate/tree/4b47a19038b798b4a33d9749d25e570443520647) | `4b47a19038b798b4a33d9749d25e570443520647` | Core PoolManager's Owned base |

Core is pinned to a revision exposing `SwapParams` and `ModifyLiquidityParams` in
`src/types/PoolOperation.sol`, matching the supplied protected-test imports. The old `v4.0.0` tag
places these structs elsewhere and is not used. Solidity is version-pinned in foundry.toml and
supplied by the execution environment; no compiler binary is vendored.
