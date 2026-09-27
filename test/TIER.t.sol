// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {TIER} from "../src/TIER.sol";

contract TIERTest is Test {
    TIER token;
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);

    function setUp() public {
        token = new TIER();
    }

    function test_metadataAndSingleMintToDeployer() public view {
        assertEq(token.name(), "Tiers");
        assertEq(token.symbol(), "TIER");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(this)), token.totalSupply());
    }

    function testFuzz_transferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, token.totalSupply());
        uint256 supply = token.totalSupply();
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), supply - amount);
        assertEq(token.totalSupply(), supply);
    }

    function test_allowanceSpendingAndInfiniteApproval() public {
        token.approve(ALICE, 10 ether);
        vm.prank(ALICE);
        token.transferFrom(address(this), BOB, 4 ether);
        assertEq(token.allowance(address(this), ALICE), 6 ether);
        assertEq(token.balanceOf(BOB), 4 ether);
        token.approve(ALICE, type(uint256).max);
        vm.prank(ALICE);
        token.transferFrom(address(this), BOB, 2 ether);
        assertEq(token.allowance(address(this), ALICE), type(uint256).max);
    }

    function test_invalidTransfersRevert() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        token.transfer(BOB, 1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, ALICE, 0, 1));
        token.transferFrom(address(this), BOB, 1);
    }

    function test_noMintOrAdministrativeEntrypointsEvenForDeployer() public {
        string[10] memory selectors = [
            "mint(address,uint256)",
            "mint(uint256)",
            "mint()",
            "issue(uint256)",
            "setOwner(address)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "initialize(address)",
            "unpause()",
            "setMinter(address)"
        ];
        for (uint256 i; i < selectors.length; ++i) {
            (bool ok,) = address(token).call(abi.encodeWithSignature(selectors[i], ALICE, 1 ether));
            assertFalse(ok);
            vm.prank(ALICE);
            (ok,) = address(token).call(abi.encodeWithSignature(selectors[i], ALICE, 1 ether));
            assertFalse(ok);
        }
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(ALICE), 0);
    }

    function test_noEscapeOpcodes() public view {
        bytes memory runtime = address(token).code;
        for (uint256 i; i < runtime.length; ++i) {
            uint8 op = uint8(runtime[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff);
        }
    }
}
