import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseEther,
} from "viem";
import { poolKeyType, protocol } from "../src/config.ts";
import {
  verifyChain,
  readSnapshot,
  readActivity,
  priceLimit,
  swapArgs,
} from "../src/chain.ts";
const run = promisify(execFile);
const d = JSON.parse(
  await readFile(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const contracts = Object.fromEntries(
  await Promise.all(
    d.contracts.map(async (c) => [
      c.name,
      {
        ...c,
        abi: JSON.parse(
          await readFile(
            new URL(`../../dist/${c.abiPath}`, import.meta.url),
            "utf8",
          ),
        ),
      },
    ]),
  ),
);
const token = contracts[d.token.contract],
  hook = contracts.LoyaltyTierHook;
const poolKey = {
  currency0: d.pool.pairedCurrency,
  currency1: token.address,
  fee: d.pool.fee,
  tickSpacing: d.pool.tickSpacing,
  hooks: hook.address,
};
const attempts = [];
const client = createPublicClient({
  transport: custom(
    {
      request: async ({ method, params }) => {
        let last;
        for (const url of d.network.rpcUrls) {
          try {
            const { stdout } = await run(
              "curl",
              [
                "--silent",
                "--show-error",
                "--fail",
                "--max-time",
                "15",
                "-H",
                "Content-Type: application/json",
                "--data",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method,
                  params: params || [],
                }),
                url,
              ],
              { maxBuffer: 1024 * 1024 },
            );
            const json = JSON.parse(stdout);
            if (json.error) throw Error(JSON.stringify(json.error));
            attempts.push({ url, method, success: true });
            return json.result;
          } catch (e) {
            last = e;
            attempts.push({
              url,
              method,
              success: false,
              error: e.message.slice(0, 240),
            });
          }
        }
        throw last;
      },
    },
    { retryCount: 0 },
  ),
});
function managerAddress() {
  return d.network.uniswapV4.poolManager;
}
const r = {
  d,
  contracts,
  token,
  hook,
  poolKey,
  poolId: keccak256(encodeAbiParameters([poolKeyType], [poolKey])),
  client,
};
let report = {
  checkedAt: new Date().toISOString(),
  poolId: r.poolId,
  broadcast: false,
};
try {
  await verifyChain(r);
  report.verification = "passed";
  report.snapshot = await readSnapshot(
    r,
    undefined,
    process.argv[2] ? BigInt(process.argv[2]) : undefined,
  );
  report.activity = await readActivity(r, report.snapshot.block);
  report.poolSeed = await client.getContractEvents({
    address: managerAddress(),
    abi: parseAbi([
      "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
    ]),
    eventName: "ModifyLiquidity",
    args: { id: r.poolId },
    fromBlock: BigInt(d.deploymentBlock),
    toBlock: BigInt(d.deploymentBlock),
  });
  const sample = "0x1111111111111111111111111111111111111111";
  try {
    report.readOnlyBuyQuote = await client.simulateContract({
      address: d.network.uniswapV4.quoter,
      abi: protocol.quoter,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey,
          zeroForOne: true,
          exactAmount: parseEther("0.000001"),
          hookData: encodeAbiParameters([{ type: "address" }], [sample]),
        },
      ],
      account: sample,
      blockNumber: report.snapshot.block,
    });
  } catch (e) {
    report.readOnlyBuyQuoteError = e.shortMessage || e.message;
  }
  try {
    const result = await client.simulateContract({
      address: d.routing.poolSwapTest,
      abi: protocol.router,
      functionName: "swap",
      args: swapArgs(
        r,
        sample,
        true,
        parseEther("0.000001"),
        priceLimit(report.snapshot.price, true, 50),
      ),
      value: parseEther("0.000001"),
      account: sample,
      blockNumber: report.snapshot.block,
      stateOverride: [{ address: sample, balance: parseEther("1") }],
    });
    report.readOnlyBuySimulation = {
      result: result.result,
      amountIn: "1000000000000",
      priceMovementBps: 50,
      accountBalanceOverride: "1000000000000000000",
      broadcast: false,
    };
  } catch (e) {
    report.readOnlyBuySimulationError = e.shortMessage || e.message;
  }
} catch (e) {
  report.error = e.shortMessage || e.message;
  process.exitCode = 1;
}
report.attempts = attempts;
await writeFile(
  new URL("../../docs/frontend/live-check.json", import.meta.url),
  JSON.stringify(
    report,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    { ...report, attempts: `${attempts.length} RPC attempts` },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
