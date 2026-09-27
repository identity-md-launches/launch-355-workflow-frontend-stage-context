// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Explicit rehearsal inputs: workflow gives no numeric manifest price/allocation.
/// The manifest contributor should use these or rerun the parameterized rehearsal with its values.
library LaunchParameters {
    uint160 internal constant SQRT_PRICE_X96 = 792281625142643375935439503360000;
    uint256 internal constant SEED_TIER = 1_000_000_000 ether;
    uint24 internal constant LP_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
}
