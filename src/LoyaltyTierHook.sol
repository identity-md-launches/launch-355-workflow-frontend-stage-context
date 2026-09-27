// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";

/// @notice Per-pool ETH volume discounts, with fees redeemable only to dEaD.
/// @dev Only the two advertised swap callbacks are implemented. No initialization/liquidity hooks,
/// admin, router allowlist or token allowlist. Requires Cancun because v4 uses transient storage.
contract LoyaltyTierHook is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint128 public constant TIER_1_AT = 0.01 ether;
    uint128 public constant TIER_2_AT = 0.1 ether;
    uint128 public constant TIER_3_AT = 1 ether;

    mapping(PoolId poolId => mapping(address user => uint128 volume)) private _volume;

    error OnlyPoolManager();
    error InvalidPoolManager();
    error PartialFill();
    error AmountTooLarge();
    error VolumeOverflow();

    /// @param tier The tier AFTER this volume was added. This swap was priced at the OLD tier.
    event VolumeAdded(PoolId indexed poolId, address indexed user, uint128 ethLeg, uint128 total, uint8 tier);
    event FeesBurned(uint256 amount);

    constructor(IPoolManager manager) {
        if (address(manager) == address(0)) revert InvalidPoolManager();
        poolManager = manager;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function volumeOf(PoolId poolId, address user) public view returns (uint128) {
        return _volume[poolId][user];
    }

    function tierOf(PoolId poolId, address user) public view returns (uint8) {
        return _tier(_volume[poolId][user]);
    }

    function feeBpsOf(PoolId poolId, address user) public view returns (uint16) {
        return uint16(100 - 25 * uint256(tierOf(poolId, user)));
    }

    /// @return The next absolute lifetime volume threshold in wei, or zero at the highest tier.
    function nextTierAt(PoolId poolId, address user) external view returns (uint128) {
        uint128 volume = _volume[poolId][user];
        if (volume < TIER_1_AT) return TIER_1_AT;
        if (volume < TIER_2_AT) return TIER_2_AT;
        if (volume < TIER_3_AT) return TIER_3_AT;
        return 0;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        int128 fee = 0;
        if (key.currency0.isAddressZero()) {
            // Bound before negation/multiplication, including int256.min. Core uses signed 128-bit deltas.
            uint128 specified = _magnitude(params.amountSpecified);
            if (_ethSpecified(params)) {
                fee = _fee(specified, _rate(key.toId(), _identity(hookData)));
                // Mint a claim, never withdraw unsettled ETH from the manager in a swap callback.
                _mintFee(fee);
            }
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee, 0), 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        if (!key.currency0.isAddressZero()) return (IHooks.afterSwap.selector, 0);

        PoolId poolId = key.toId();
        address user = _identity(hookData);
        // beforeSwap does not change volume and calls only the trusted manager's mint. Core makes
        // no intervening untrusted call, so this is still the pre-swap rate; no scratch state needed.
        uint16 bps = _rate(poolId, user);
        uint128 ethLeg;
        int128 afterFee = 0;
        if (_ethSpecified(params)) {
            ethLeg = _magnitude(params.amountSpecified);
            int128 beforeFee = _fee(ethLeg, bps);
            if (int256(delta.amount0()) != params.amountSpecified + beforeFee) revert PartialFill();
        } else {
            if (int256(delta.amount1()) != params.amountSpecified) revert PartialFill();
            ethLeg = _magnitude(delta.amount0());
            afterFee = _fee(ethLeg, bps);
            _mintFee(afterFee);
        }

        if (user != address(0)) {
            uint256 total = uint256(_volume[poolId][user]) + ethLeg;
            if (total > type(uint128).max) revert VolumeOverflow();
            _volume[poolId][user] = uint128(total);
            emit VolumeAdded(poolId, user, ethLeg, uint128(total), _tier(uint128(total)));
        }
        return (IHooks.afterSwap.selector, afterFee);
    }

    /// @notice All outstanding ETH claims, including any claims donated directly to this hook.
    /// @dev The manager's claim balance is the single source of truth; no counter can drift from it.
    function accruedFees() public view returns (uint256) {
        return poolManager.balanceOf(address(this), 0);
    }

    /// @notice Anyone may burn all claims. The caller cannot select a recipient or keep a reward.
    function burnFees() external returns (uint256 amount) {
        if (accruedFees() == 0) return 0;
        amount = abi.decode(poolManager.unlock(""), (uint256));
    }

    function unlockCallback(bytes calldata) external onlyPoolManager returns (bytes memory) {
        uint256 amount = accruedFees();
        // CEI: burning zeroes the entire claim balance before take makes the ETH transfer.
        poolManager.burn(address(this), 0, amount);
        poolManager.take(Currency.wrap(address(0)), DEAD, amount);
        emit FeesBurned(amount);
        return abi.encode(amount);
    }

    function _mintFee(int128 fee) private {
        if (fee != 0) poolManager.mint(address(this), 0, uint128(fee));
    }

    function _ethSpecified(SwapParams calldata params) private pure returns (bool) {
        return params.zeroForOne == (params.amountSpecified < 0);
    }

    function _magnitude(int256 amount) private pure returns (uint128) {
        if (amount < -int256(type(int128).max) || amount > int256(type(int128).max)) revert AmountTooLarge();
        return uint128(uint256(amount < 0 ? -amount : amount));
    }

    function _fee(uint128 ethLeg, uint16 bps) private pure returns (int128) {
        // ethLeg <= int128.max and bps <= 100: multiplication and signed narrowing are safe.
        return int128(int256(uint256(ethLeg) * bps / 10_000));
    }

    function _identity(bytes calldata hookData) private view returns (address user) {
        if (hookData.length != 32) return address(0);
        // Treat non-canonical ABI words as anonymous too, rather than letting abi.decode revert.
        if (uint256(bytes32(hookData)) > type(uint160).max) return address(0);
        user = abi.decode(hookData, (address));
        if (user == address(0) || user != tx.origin) return address(0);
    }

    function _rate(PoolId poolId, address user) private view returns (uint16) {
        return user == address(0) ? 100 : feeBpsOf(poolId, user);
    }

    function _tier(uint128 volume) private pure returns (uint8) {
        if (volume >= TIER_3_AT) return 3;
        if (volume >= TIER_2_AT) return 2;
        if (volume >= TIER_1_AT) return 1;
        return 0;
    }
}
