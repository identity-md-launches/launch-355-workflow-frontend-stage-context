import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  encodeEventTopics,
  encodeAbiParameters,
  keccak256,
  toHex,
  parseEther,
  parseAbi,
} from "viem";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const evidence = fileURLToPath(
  new URL("../../docs/frontend/", import.meta.url),
);
await mkdir(evidence, { recursive: true });
const d = JSON.parse(await readFile(`${root}/imd-deployment.json`, "utf8"));
const abis = Object.fromEntries(
  await Promise.all(
    d.contracts.map(async (c) => [
      c.name,
      JSON.parse(await readFile(`${root}/${c.abiPath}`, "utf8")),
    ]),
  ),
);
const routerAbi = parseAbi([
  "function manager() view returns(address)",
  "function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96),(bool takeClaims,bool settleUsingBurn),bytes) payable returns(int256)",
]);
const stateAbi = parseAbi([
  "function poolManager() view returns(address)",
  "function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32) view returns(uint128)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns(uint256,uint256)",
]);
const allAbi = [
  ...abis.TIER,
  ...abis.LoyaltyTierHook,
  ...routerAbi,
  ...stateAbi,
  ...quoterAbi,
];
const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const manager = d.network.uniswapV4.poolManager;
const block = "0xb40cc0";
const bHash = "0x" + "ab".repeat(32);
const txHash = "0x" + "cd".repeat(32);
const failures = [];
const checks = [];
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ).replace(/^\/preview\//, "");
    if (!path || path === "preview") path = "index.html";
    if (path.includes("..")) throw Error("Unsafe path");
    const bytes = await readFile(`${root}/${path}`);
    const ext = path.split(".").pop();
    res.setHeader(
      "Content-Type",
      {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
      }[ext] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      "/opt/imd-tools/ms-playwright/chromium-1246/chrome-linux64/chrome",
    headless: true,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: "/tmp/tiers-browser-config",
      XDG_CACHE_HOME: "/tmp/tiers-browser-cache",
    },
    args: ["--no-sandbox", "--disable-crash-reporter"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const badResources = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(url) && r.status() >= 400)
      badResources.push(r.url());
  });
  const state = {
    allowance: 0n,
    tier: 1,
    volume: parseEther("0.032"),
    fees: parseEther("0.0012"),
    rpcFail: false,
    quoteFail: false,
    swapFail: false,
    zeroLiquidity: false,
    missingCode: false,
    wrongManager: false,
    wrongRpc: false,
    txRevert: false,
    events: false,
    contractWallet: false,
    txs: [],
    calls: [],
  };
  const receipt = () => ({
    transactionHash: txHash,
    transactionIndex: "0x0",
    blockHash: bHash,
    blockNumber: block,
    from: account,
    to: d.routing.poolSwapTest,
    cumulativeGasUsed: "0x10000",
    gasUsed: "0x10000",
    contractAddress: null,
    logs: [],
    logsBloom: "0x" + "00".repeat(256),
    status: state.txRevert ? "0x0" : "0x1",
    effectiveGasPrice: "0x3b9aca00",
    type: "0x2",
  });
  async function rpc(method, params = []) {
    state.calls.push({ method, params });
    if (state.rpcFail) throw Error("Mock RPC offline");
    if (method === "eth_chainId")
      return state.wrongRpc ? "0x1" : d.walletAddChain.chainId;
    if (method === "eth_blockNumber") return block;
    if (method === "eth_getCode")
      return state.missingCode ||
        (!state.contractWallet &&
          [account, other].includes(params[0].toLowerCase()))
        ? "0x"
        : "0x6000";
    if (method === "eth_getBalance") return toHex(parseEther("2"));
    if (method === "eth_getLogs") {
      assert.ok(BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) < 500n);
      if (!state.events || BigInt(params[0].toBlock) < BigInt(block)) return [];
      const token = d.contracts.find((c) => c.name === "TIER").address;
      const hook = d.contracts.find(
        (c) => c.name === "LoyaltyTierHook",
      ).address;
      const id = keccak256(
        encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            { type: "uint24" },
            { type: "int24" },
            { type: "address" },
          ],
          [d.pool.pairedCurrency, token, d.pool.fee, d.pool.tickSpacing, hook],
        ),
      );
      return [
        {
          address: hook,
          blockHash: bHash,
          blockNumber: block,
          transactionHash: txHash,
          transactionIndex: "0x0",
          logIndex: "0x1",
          removed: false,
          topics: encodeEventTopics({
            abi: abis.LoyaltyTierHook,
            eventName: "VolumeAdded",
            args: { poolId: id, user: account },
          }),
          data: encodeAbiParameters(
            [{ type: "uint128" }, { type: "uint128" }, { type: "uint8" }],
            [parseEther("0.002"), parseEther("0.034"), 1],
          ),
        },
        {
          address: hook,
          blockHash: bHash,
          blockNumber: block,
          transactionHash: txHash,
          transactionIndex: "0x0",
          logIndex: "0x2",
          removed: false,
          topics: encodeEventTopics({
            abi: abis.LoyaltyTierHook,
            eventName: "FeesBurned",
          }),
          data: encodeAbiParameters(
            [{ type: "uint256" }],
            [parseEther("0.0012")],
          ),
        },
      ];
    }
    if (method === "eth_getTransactionReceipt") return receipt();
    if (method === "eth_call") {
      const call = params[0];
      const decoded = decodeFunctionData({ abi: allAbi, data: call.data });
      const name = decoded.functionName;
      let value;
      if (name === "quoteExactInputSingle") {
        if (state.quoteFail)
          throw Error("Quote reverted: insufficient liquidity");
        const q = decoded.args[0];
        assert.equal(
          q.hookData,
          encodeAbiParameters([{ type: "address" }], [account]),
        );
        assert.equal(call.to.toLowerCase(), d.network.uniswapV4.quoter);
        value = [
          q.zeroForOne ? q.exactAmount * 98000000n : q.exactAmount / 102000000n,
          100000n,
        ];
      } else if (name === "swap") {
        if (state.swapFail)
          throw Object.assign(Error("execution reverted"), {
            data: encodeErrorResult({
              abi: parseAbi([
                "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
              ]),
              errorName: "WrappedError",
              args: [
                d.contracts.find((c) => c.name === "LoyaltyTierHook").address,
                "0x00000000",
                encodeErrorResult({
                  abi: abis.LoyaltyTierHook,
                  errorName: "PartialFill",
                }),
                "0x",
              ],
            }),
          });
        const [key, p, settings, hookData] = decoded.args;
        assert.equal(
          key.hooks.toLowerCase(),
          d.contracts.find((c) => c.name === "LoyaltyTierHook").address,
        );
        assert.equal(key.fee, d.pool.fee);
        assert.equal(key.tickSpacing, d.pool.tickSpacing);
        assert.equal(call.to.toLowerCase(), d.routing.poolSwapTest);
        assert.equal(
          hookData,
          encodeAbiParameters([{ type: "address" }], [account]),
        );
        assert.ok(p.amountSpecified < 0n);
        assert.deepEqual(settings, {
          takeClaims: false,
          settleUsingBurn: false,
        });
        assert.ok(p.sqrtPriceLimitX96 > 0n);
        assert.equal(
          BigInt(call.value || 0),
          p.zeroForOne ? -p.amountSpecified : 0n,
        );
        value = 0n;
      } else
        value = {
          manager: state.wrongManager ? other : manager,
          poolManager: state.wrongManager ? other : manager,
          getSlot0: [792281625142643375935439503360000n, 184216, 0, 3000],
          getLiquidity: state.zeroLiquidity ? 0n : 100000000000000000000000n,
          accruedFees: state.fees,
          TIER_1_AT: parseEther("0.01"),
          TIER_2_AT: parseEther("0.1"),
          TIER_3_AT: parseEther("1"),
          decimals: 18,
          symbol: "TIER",
          volumeOf: state.volume,
          tierOf: state.tier,
          feeBpsOf: 100 - state.tier * 25,
          nextTierAt: parseEther("0.1"),
          balanceOf: parseEther("1000000"),
          allowance: state.allowance,
          approve: true,
          burnFees: state.fees,
        }[name];
      if (value === undefined) throw Error(`Unhandled call ${name}`);
      return encodeFunctionResult({
        abi: allAbi,
        functionName: name,
        result: value,
      });
    }
    throw Error(`Unhandled RPC ${method}`);
  }
  await context.route(/^https:\/\//, async (route) => {
    const body = route.request().postDataJSON();
    const one = async (x) => {
      try {
        return {
          jsonrpc: "2.0",
          id: x.id,
          result: await rpc(x.method, x.params),
        };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: x.id,
          error: {
            code: e.data ? 3 : -32000,
            message: e.message,
            data: e.data,
          },
        };
      }
    };
    const result = Array.isArray(body)
      ? await Promise.all(body.map(one))
      : await one(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.exposeFunction("__mockSend", async (tx) => {
    state.txs.push(tx);
    const decoded = decodeFunctionData({ abi: allAbi, data: tx.data });
    if (decoded.functionName === "approve") {
      assert.equal(decoded.args[0].toLowerCase(), d.routing.poolSwapTest);
      state.allowance = decoded.args[1];
    }
    if (decoded.functionName === "burnFees") state.fees = 0n;
    if (decoded.functionName === "swap") state.volume += parseEther("0.001");
    return txHash;
  });
  await page.addInitScript(
    ({ account, chain }) => {
      const events = {};
      window.__wallet = {
        chain: "0x1",
        accounts: [],
        requests: [],
        unknown: true,
        reject: false,
      };
      window.ethereum = {
        isMetaMask: true,
        on: (n, fn) => (events[n] ??= []).push(fn),
        removeListener: (n, fn) => {
          events[n] = (events[n] || []).filter((x) => x !== fn);
        },
        request: async ({ method, params }) => {
          const s = window.__wallet;
          s.requests.push({ method, params });
          if (method === "eth_chainId") return s.chain;
          if (method === "eth_accounts") return s.accounts;
          if (method === "eth_requestAccounts") {
            if (s.reject)
              throw { code: 4001, message: "User rejected connection" };
            s.accounts = [account];
            return s.accounts;
          }
          if (method === "wallet_switchEthereumChain") {
            if (s.reject) throw { code: 4001, message: "User rejected switch" };
            if (s.unknown) throw { code: 4902, message: "Unknown chain" };
            s.chain = params[0].chainId;
            (events.chainChanged || []).forEach((fn) => fn(s.chain));
            return null;
          }
          if (method === "wallet_addEthereumChain") {
            s.unknown = false;
            return null;
          }
          if (method === "eth_sendTransaction") {
            if (s.reject)
              throw { code: 4001, message: "User rejected transaction" };
            return window.__mockSend(params[0]);
          }
          if (method === "wallet_getCapabilities") return {};
          if (method === "wallet_requestPermissions") return [];
          throw Error("Unhandled wallet method " + method);
        },
      };
      window.__emitAccount = (value) => {
        window.__wallet.accounts = [value];
        (events.accountsChanged || []).forEach((fn) => fn([value]));
      };
    },
    { account, chain: d.walletAddChain.chainId },
  );
  async function check(name, fn) {
    try {
      await fn();
      checks.push({ name, result: "passed" });
      console.log("PASS", name);
    } catch (e) {
      failures.push({ name, error: e.message });
      console.log("FAIL", name, e.message);
      console.log("ALERTS", await page.getByRole("alert").allTextContents());
      console.log("STATUS", await page.getByRole("status").allTextContents());
      console.log("LAST CALLS", state.calls.slice(-4));
      throw e;
    }
  }
  const waitLive = () =>
    page.getByText("Live on Sepolia", { exact: true }).waitFor();
  const connect = () =>
    page
      .getByRole("button", { name: "Connect wallet", exact: false })
      .first()
      .click();
  await page.goto(url);
  await waitLive();
  await check(
    "Relative export, disconnected state and runtime ABI loading",
    async () => {
      assert.equal(await page.title(), "Tiers — a little loyalty, onchain");
      await page
        .getByRole("button", { name: "Connect wallet to swap" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Burn accrued fees" })
          .isDisabled(),
        true,
      );
    },
  );
  await page.screenshot({
    path: `${evidence}/desktop-disconnected.png`,
    fullPage: true,
  });
  await check("Wallet rejection is recoverable", async () => {
    await page.evaluate(() => (window.__wallet.reject = true));
    await connect();
    await page
      .getByText("Request declined in your wallet. You can try again.")
      .waitFor();
    await page.evaluate(() => (window.__wallet.reject = false));
  });
  await check(
    "Connect, wrong chain, add unknown chain then switch",
    async () => {
      await connect();
      await page.getByRole("button", { name: "Switch to Sepolia" }).click();
      await page
        .getByRole("button", { name: "Get quote", exact: false })
        .waitFor();
      const requests = await page.evaluate(() => window.__wallet.requests);
      const add = requests.find((x) => x.method === "wallet_addEthereumChain");
      assert.deepEqual(add.params[0], d.walletAddChain);
      assert.equal(
        requests.filter((x) => x.method === "wallet_switchEthereumChain")
          .length,
        2,
      );
      await waitLive();
    },
  );
  await check(
    "Live wallet standing, pre-swap fee and volume remaining",
    async () => {
      await page.getByText("0.068 ETH to Insider", { exact: true }).waitFor();
      assert.ok((await page.getByText("0.75%", { exact: true }).count()) >= 2);
    },
  );
  await check("Invalid amount, precision validation and focus", async () => {
    await page.getByLabel("You pay").fill("-1");
    await page.getByRole("button", { name: "Get quote", exact: false }).click();
    await page
      .getByText("Enter a positive amount with at most 18 decimal places.")
      .waitFor();
    assert.equal(
      await page
        .locator("#amount")
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await page.getByLabel("You pay").fill("0.0000000000000000001");
    await page.getByRole("button", { name: "Get quote", exact: false }).click();
    assert.equal(
      await page.getByLabel("You pay").getAttribute("aria-invalid"),
      "true",
    );
  });
  await check("Buy quote carries identity and request amount", async () => {
    await page.getByLabel("You pay").fill("0.001");
    await page.getByRole("button", { name: "Get quote", exact: false }).click();
    await page.getByRole("button", { name: "Confirm buy" }).waitFor();
    await page.getByText("98000 TIER", { exact: false }).first().waitFor();
    await page.getByText("0.0000075 ETH", { exact: true }).waitFor();
  });
  await check("Quote invalidates on edits", async () => {
    await page.getByLabel("You pay").fill("0.002");
    assert.equal(
      await page.getByRole("button", { name: "Confirm buy" }).count(),
      0,
    );
    await page.getByLabel("You pay").fill("0.001");
    await page.getByRole("button", { name: "Get quote", exact: false }).click();
    await page.getByRole("button", { name: "Confirm buy" }).waitFor();
  });
  await check("Simulation rejection prevents wallet transaction", async () => {
    state.swapFail = true;
    await page.getByRole("button", { name: "Confirm buy" }).click();
    await page.getByRole("alert").filter({ hasText: "revert" }).waitFor();
    await page
      .getByText("The swap would hit its price limit before filling.", {
        exact: false,
      })
      .waitFor();
    assert.equal(state.txs.length, 0);
    state.swapFail = false;
  });
  await check(
    "Buy simulation, exact native value, pending and confirmed receipt",
    async () => {
      await page.getByRole("button", { name: "Confirm buy" }).click();
      await page.getByText("Swap confirmed.", { exact: true }).waitFor();
      assert.equal(state.txs.length, 1);
      assert.equal(BigInt(state.txs[0].value), parseEther("0.001"));
    },
  );
  await check(
    "Sell approval is separate, exact and targets assigned router",
    async () => {
      await page
        .getByRole("button", { name: "Sell TIER", exact: true })
        .click();
      await page.getByLabel("You pay").fill("1000");
      await page
        .getByRole("button", { name: "Get quote", exact: false })
        .click();
      await page
        .getByRole("button", { name: "Approve TIER", exact: true })
        .click();
      await page.getByText("Approval confirmed.", { exact: true }).waitFor();
      assert.equal(state.allowance, parseEther("1000"));
      await page.getByRole("button", { name: "Confirm sell" }).waitFor();
    },
  );
  await check(
    "Sell simulation, zero native value and wallet rejection",
    async () => {
      await page.evaluate(() => (window.__wallet.reject = true));
      await page.getByRole("button", { name: "Confirm sell" }).click();
      await page
        .getByText("Request declined in your wallet. You can try again.")
        .waitFor();
      assert.equal(state.txs.length, 2);
      await page.evaluate(() => (window.__wallet.reject = false));
      await page.getByRole("button", { name: "Confirm sell" }).click();
      await page.getByText("Swap confirmed.", { exact: true }).waitFor();
      assert.equal(BigInt(state.txs[2].value || 0), 0n);
    },
  );
  await check("Burn consent and permissionless burn transaction", async () => {
    assert.equal(
      await page
        .getByRole("button", { name: "Burn accrued fees" })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel("I understand this transfer is irreversible.")
      .check();
    await page.getByRole("button", { name: "Burn accrued fees" }).click();
    await page.getByText("Fee burn confirmed.", { exact: true }).waitFor();
    assert.equal(state.fees, 0n);
  });
  await check(
    "Account changes invalidate quote and refresh standing",
    async () => {
      await page.evaluate((other) => window.__emitAccount(other), other);
      await waitLive();
      assert.equal(
        await page.getByRole("button", { name: "Confirm sell" }).count(),
        0,
      );
      await page
        .getByRole("button", {
          name: `Disconnect ${other.slice(0, 6)}…${other.slice(-4)}`,
        })
        .waitFor();
      await page.evaluate((account) => window.__emitAccount(account), account);
      await waitLive();
    },
  );
  await check(
    "Zero active liquidity still allows quoting a reachable range",
    async () => {
      state.zeroLiquidity = true;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await page
        .getByText("No liquidity at the current tick.", { exact: false })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Get quote", exact: false })
          .isDisabled(),
        false,
      );
      state.zeroLiquidity = false;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await waitLive();
    },
  );
  await check(
    "Missing code blocks transactions and retry recovers",
    async () => {
      state.missingCode = true;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await page.getByText("Reads unavailable", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Get quote", exact: false })
          .isDisabled(),
        true,
      );
      state.missingCode = false;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await waitLive();
    },
  );
  await check("Manager mismatch blocks transactions", async () => {
    state.wrongManager = true;
    await page.getByRole("button", { name: "Refresh live state" }).click();
    await page.getByText("Reads unavailable", { exact: true }).waitFor();
    state.wrongManager = false;
    await page.getByRole("button", { name: "Refresh live state" }).click();
    await waitLive();
  });
  await check("RPC chain mismatch blocks transactions", async () => {
    state.wrongRpc = true;
    await page.getByRole("button", { name: "Refresh live state" }).click();
    await page.getByText("Reads unavailable", { exact: true }).waitFor();
    state.wrongRpc = false;
    await page.getByRole("button", { name: "Refresh live state" }).click();
    await waitLive();
  });
  await check(
    "Event decoding, pool filtering and bounded block windows",
    async () => {
      state.events = true;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await waitLive();
      await page.getByText("Fees burned", { exact: true }).waitFor();
      await page.getByText("0.002 ETH volume added", { exact: true }).waitFor();
    },
  );
  await check(
    "Smart account reads remain available and direct swaps are disabled",
    async () => {
      state.contractWallet = true;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await waitLive();
      await page
        .getByText("This form supports direct EOA transactions.", {
          exact: false,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Get quote", exact: false })
          .isDisabled(),
        true,
      );
      state.contractWallet = false;
      await page.getByRole("button", { name: "Refresh live state" }).click();
      await waitLive();
    },
  );

  await check("RPC outage disables actions and recovers", async () => {
    state.rpcFail = true;
    await page.getByRole("button", { name: "Refresh live state" }).click();
    await page.getByText("Reads unavailable", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Get quote", exact: false })
        .isDisabled(),
      true,
    );
    state.rpcFail = false;
    await page.getByRole("button", { name: "Refresh live state" }).click();
    await waitLive();
  });
  await check("Quote revert error with recovery", async () => {
    state.quoteFail = true;
    await page.getByLabel("You pay").fill("100");
    await page.getByRole("button", { name: "Get quote", exact: false }).click();
    await page.getByRole("alert").filter({ hasText: "revert" }).waitFor();
    state.quoteFail = false;
  });
  await page.getByRole("button", { name: "Buy TIER", exact: true }).click();
  await page.getByLabel("You pay").fill("0.001");
  await page.getByRole("button", { name: "Get quote", exact: false }).click();
  await page.getByRole("button", { name: "Confirm buy" }).waitFor();
  await page.screenshot({
    path: `${evidence}/connected-quote.png`,
    fullPage: true,
  });
  await check("Receipt revert is reported", async () => {
    state.txRevert = true;
    await page.getByRole("button", { name: "Confirm buy" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "reverted onchain" })
      .waitFor();
    state.txRevert = false;
  });
  await check("Quote expiry blocks transaction", async () => {
    await page.clock.install();
    await page.clock.fastForward(61000);
    await page
      .getByText("Quote expired. Get a fresh quote to continue.")
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Confirm buy" }).count(),
      0,
    );
    await page.clock.resume();
  });
  await page.reload();
  await waitLive();
  await check(
    "Desktop and mobile reflow, keyboard focus, reduced motion and accessibility",
    async () => {
      for (const width of [1440, 900, 390, 320]) {
        await page.setViewportSize({ width, height: 1050 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false, `${width}px overflow`);
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        await writeFile(
          `${evidence}/axe-${width}.json`,
          JSON.stringify(
            {
              violations: axe.violations,
              incomplete: axe.incomplete.map((x) => ({
                id: x.id,
                description: x.description,
                nodes: x.nodes.map((n) => ({
                  target: n.target,
                  summary: n.failureSummary,
                })),
              })),
              passes: axe.passes.length,
            },
            null,
            2,
          ),
        );
        assert.equal(
          axe.violations.length,
          0,
          JSON.stringify(
            axe.violations.map((x) => ({
              id: x.id,
              nodes: x.nodes.map((n) => n.target),
            })),
          ),
        );
        if (width === 1440 || width === 390 || width === 320)
          await page.screenshot({
            path: `${evidence}/${width === 1440 ? "desktop" : `mobile-${width}`}.png`,
            fullPage: true,
          });
      }
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("Tab");
      const focused = await page.locator(":focus").evaluate((el) => ({
        tag: el.tagName,
        text: el.textContent,
        outline: getComputedStyle(el).outlineWidth,
      }));
      assert.notEqual(focused.outline, "0px");
      await page.screenshot({ path: `${evidence}/keyboard-focus.png` });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .getByRole("button")
          .first()
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "200%"),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    },
  );
  await check(
    "No failed static resources or uncaught browser errors",
    async () => {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(badResources, []);
    },
  );
  await check(
    "Keyboard-only wallet connection, chain switch and quote form",
    async () => {
      async function tabUntil(test) {
        for (let i = 0; i < 50; i++) {
          await page.keyboard.press("Tab");
          if (
            (await page.locator(":focus").count()) &&
            (await page.locator(":focus").evaluate(test))
          )
            return;
        }
        throw Error("Keyboard target unreachable");
      }
      await tabUntil(
        (el) =>
          el.tagName === "BUTTON" && el.textContent.includes("Connect wallet"),
      );
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Switch to Sepolia" }).waitFor();
      await tabUntil((el) => el.textContent === "Switch to Sepolia");
      await page.keyboard.press("Enter");
      await waitLive();
      await tabUntil((el) => el.id === "amount");
      await page.keyboard.type("0.0001");
      await page.screenshot({ path: `${evidence}/input-focus.png` });
      await tabUntil(
        (el) => el.tagName === "BUTTON" && el.textContent.includes("Get quote"),
      );
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Confirm buy" }).waitFor();
    },
  );
  await check("ABI tampering stops configuration loading", async () => {
    const isolated = await browser.newContext();
    await isolated.route("**/abi/TIER.json", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" }),
    );
    const p = await isolated.newPage();
    await p.goto(url);
    await p.getByRole("heading", { name: "Deployment unavailable" }).waitFor();
    await p
      .getByText("ABI verification failed: TIER", { exact: true })
      .waitFor();
    await isolated.close();
  });
  // A separate clean context establishes the missing-wallet state.
  const absent = await browser.newContext();
  await absent.route(/^https:\/\//, async (route) => {
    const b = route.request().postDataJSON();
    const result = await rpc(b.method, b.params);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: b.id, result }),
    });
  });
  const noWallet = await absent.newPage();
  await noWallet.goto(url);
  await noWallet
    .getByRole("button", { name: "Connect wallet to swap" })
    .click();
  await noWallet
    .getByText("No browser wallet found.", { exact: false })
    .waitFor();
  checks.push({
    name: "Missing browser wallet gives installation guidance",
    result: "passed",
  });
  await absent.close();
  const metrics = await page.evaluate(() => {
    const selectors = [
      "body",
      ".quiet",
      ".primary",
      ".burn",
      ".error",
      ".current",
    ];
    return selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        selector,
        color: s.color,
        background: s.backgroundColor,
        font: s.fontFamily,
        size: s.fontSize,
      };
    });
  });
  const contrast = await page.evaluate(() => {
    function rgb(s) {
      return s
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    }
    function lum(c) {
      return c
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    }
    return [
      "h1",
      "h1 span",
      ".quiet",
      ".primary",
      ".burn p",
      ".error",
      ".current",
    ].map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const fg = getComputedStyle(el).color;
      let parent = el,
        bg;
      while (parent) {
        bg = getComputedStyle(parent).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
        parent = parent.parentElement;
      }
      bg = parent ? bg : "rgb(255, 255, 255)";
      const a = lum(rgb(fg)),
        b = lum(rgb(bg));
      return {
        selector,
        foreground: fg,
        background: bg,
        ratio: Number(
          ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
        ),
      };
    });
  });
  await writeFile(
    `${evidence}/contrast.json`,
    JSON.stringify(contrast, null, 2),
  );
  await writeFile(
    `${evidence}/rendered-styles.json`,
    JSON.stringify(metrics, null, 2),
  );
  await writeFile(
    `${evidence}/interaction-results.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: await browser.version(),
        urlPath: "/preview/",
        checks,
        failures,
        transactionsMocked: state.txs.length,
        realTransactions: 0,
        pageErrors,
        badResources,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${checks.length} checks passed; ${state.txs.length} mocked transactions; no broadcasts.`,
  );
} catch (e) {
  console.error(e);
  await writeFile(
    `${evidence}/interaction-results.json`,
    JSON.stringify({ checks, failures, error: e.message }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
