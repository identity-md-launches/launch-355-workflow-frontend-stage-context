import {
  encodeAbiParameters,
  decodeErrorResult,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import { protocol, type Runtime } from "./config.ts";
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export function units(n: bigint, decimals = 18, digits = 6) {
  const full = formatUnits(n, decimals);
  const [a, b] = full.split(".");
  if (!b) return a;
  const tail = b.slice(0, digits).replace(/0+$/, "");
  return tail ? `${a}.${tail}` : n > 0n && a === "0" ? `<${10 ** -digits}` : a;
}
function revertName(error: unknown, abi: Abi, depth = 0): string | undefined {
  if (depth > 10 || !error) return;
  if (typeof error === "string" && /^0x[0-9a-f]+$/i.test(error)) {
    try {
      const decoded = decodeErrorResult({
        abi: [...protocol.errors, ...abi],
        data: error as Hex,
      });
      if (decoded.errorName === "WrappedError")
        return revertName(decoded.args?.[2], abi, depth + 1) || "WrappedError";
      if (decoded.errorName === "UnexpectedRevertBytes")
        return (
          revertName(decoded.args?.[0], abi, depth + 1) ||
          "UnexpectedRevertBytes"
        );
      return decoded.errorName;
    } catch {
      return;
    }
  }
  if (typeof error === "object") {
    const object = error as Record<string, unknown>;
    for (const key of ["raw", "data", "cause", "error", "originalError"]) {
      const name = revertName(object[key], abi, depth + 1);
      if (name) return name;
    }
  }
}
export function errorMessage(e: unknown, abi: Abi = []): string {
  const x = e as {
    shortMessage?: string;
    message?: string;
    details?: string;
    code?: number;
    cause?: unknown;
  };
  if (
    x.code === 4001 ||
    /reject|denied/i.test(x.shortMessage || x.message || "")
  )
    return "Request declined in your wallet. You can try again.";
  const name = revertName(e, abi);
  if (name === "PartialFill")
    return "Contract reverted: PartialFill. The swap would hit its price limit before filling. Try a smaller amount or review the price movement limit.";
  if (name)
    return `Contract reverted: ${name}. Refresh live state and review the amount before trying again.`;
  return [
    x.shortMessage || x.message || "Unable to complete the request. Try again.",
    x.details,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);
}
export function inputAmount(s: string, decimals: number) {
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s) ||
    (s.split(".")[1]?.length || 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const n = parseUnits(s, decimals);
  if (n <= 0n || n >= 1n << 127n)
    throw Error("Enter a positive amount below the contract limit.");
  return n;
}
function sqrt(n: bigint): bigint {
  if (n < 0n) throw Error("Negative square root");
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
// Bound movement in the pool's token1/token0 price from the reviewed snapshot.
export function priceLimit(price: bigint, buy: boolean, bps: number) {
  if (!Number.isInteger(bps) || bps < 10 || bps > 500)
    throw Error("Choose a price limit between 0.1% and 5%.");
  const limit = sqrt(
    (price * price * BigInt(10000 + (buy ? -bps : bps))) / 10000n,
  );
  if (
    limit <= 4295128739n ||
    limit >= 1461446703485210103287273052203988822378723970342n
  )
    throw Error("Pool price is outside the supported limit range.");
  return limit;
}
export function swapArgs(
  r: Runtime,
  address: Address,
  buy: boolean,
  amount: bigint,
  limit: bigint,
) {
  return [
    r.poolKey,
    { zeroForOne: buy, amountSpecified: -amount, sqrtPriceLimitX96: limit },
    { takeClaims: false, settleUsingBurn: false },
    encodeAbiParameters([{ type: "address" }], [address]),
  ] as const;
}
export async function verifyChain(r: Runtime) {
  const { client, d, hook } = r;
  if ((await client.getChainId()) !== d.chainId)
    throw Error(
      "RPC chain does not match this deployment. Actions are disabled.",
    );
  const addresses = [
    ...d.contracts.map((c) => c.address),
    d.routing.poolSwapTest,
    d.network.uniswapV4.poolManager,
    d.network.uniswapV4.stateView,
    d.network.uniswapV4.quoter,
  ];
  const codes = await Promise.all(
    addresses.map((address) => client.getCode({ address })),
  );
  codes.forEach((c, i) => {
    if (!c || c === "0x")
      throw Error(`No contract code at ${addresses[i]}. Actions are disabled.`);
  });
  const manager = d.network.uniswapV4.poolManager.toLowerCase();
  const managers = await Promise.all([
    client.readContract({
      address: hook.address,
      abi: hook.abi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: d.routing.poolSwapTest,
      abi: protocol.router,
      functionName: "manager",
    }),
    client.readContract({
      address: d.network.uniswapV4.stateView,
      abi: protocol.state,
      functionName: "poolManager",
    }),
    client.readContract({
      address: d.network.uniswapV4.quoter,
      abi: protocol.quoter,
      functionName: "poolManager",
    }),
  ]);
  if (managers.some((m) => String(m).toLowerCase() !== manager))
    throw Error(
      "A contract uses a different PoolManager. Actions are disabled.",
    );
}
export interface Snapshot {
  block: bigint;
  time: number;
  price: bigint;
  liquidity: bigint;
  lpFee: number;
  fees: bigint;
  thresholds: bigint[];
  decimals: number;
  symbol: string;
  volume: bigint;
  tier: number;
  bps: number;
  next: bigint;
  balance: bigint;
  eth: bigint;
  allowance: bigint;
  contractWallet: boolean;
  account?: Address;
}
export async function readSnapshot(
  r: Runtime,
  address?: Address,
  blockNumber?: bigint,
): Promise<Snapshot> {
  const block =
    blockNumber ?? (await r.client.getBlockNumber({ cacheTime: 0 }));
  const read = (
    target: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    r.client.readContract({
      address: target,
      abi,
      functionName,
      args,
      blockNumber: block,
    });
  const h = (f: string, args: readonly unknown[] = []) =>
    read(r.hook.address, r.hook.abi, f, args);
  const t = (f: string, args: readonly unknown[] = []) =>
    read(r.token.address, r.token.abi, f, args);
  const [slot, liquidity, fees, a, b, c, decimals, symbol] = await Promise.all([
    r.client.readContract({
      address: r.d.network.uniswapV4.stateView,
      abi: protocol.state,
      functionName: "getSlot0",
      args: [r.poolId],
      blockNumber: block,
    }),
    r.client.readContract({
      address: r.d.network.uniswapV4.stateView,
      abi: protocol.state,
      functionName: "getLiquidity",
      args: [r.poolId],
      blockNumber: block,
    }),
    h("accruedFees"),
    h("TIER_1_AT"),
    h("TIER_2_AT"),
    h("TIER_3_AT"),
    t("decimals"),
    t("symbol"),
  ]);
  if (Number(decimals) !== r.d.token.decimals || symbol !== r.d.token.symbol)
    throw Error(
      "Token metadata differs from the handoff. Actions are disabled.",
    );
  const [volume, tier, bps, next, balance, eth, allowance, code] = address
    ? await Promise.all([
        h("volumeOf", [r.poolId, address]),
        h("tierOf", [r.poolId, address]),
        h("feeBpsOf", [r.poolId, address]),
        h("nextTierAt", [r.poolId, address]),
        t("balanceOf", [address]),
        r.client.getBalance({ address, blockNumber: block }),
        t("allowance", [address, r.d.routing.poolSwapTest]),
        r.client.getCode({ address, blockNumber: block }),
      ])
    : [0n, 0, 100, 0n, 0n, 0n, 0n, undefined];
  return {
    block,
    time: Date.now(),
    price: slot[0],
    liquidity,
    lpFee: slot[3],
    fees: fees as bigint,
    thresholds: [a, b, c] as bigint[],
    decimals: Number(decimals),
    symbol: String(symbol),
    volume: volume as bigint,
    tier: Number(tier),
    bps: Number(bps),
    next: next as bigint,
    balance: balance as bigint,
    eth: eth as bigint,
    allowance: allowance as bigint,
    contractWallet: !!code && code !== "0x",
    account: address,
  };
}
export interface Activity {
  type: "volume" | "burn";
  block: bigint;
  tx: Hex;
  user?: Address;
  eth: bigint;
  tier?: number;
  index: number;
}
export async function readActivity(r: Runtime, to: bigint) {
  const from =
    to - 1999n > BigInt(r.d.deploymentBlock)
      ? to - 1999n
      : BigInt(r.d.deploymentBlock);
  const events: Activity[] = [];
  for (let start = from; start <= to; start += 500n) {
    const end = start + 499n < to ? start + 499n : to;
    const logs = await r.client.getContractEvents({
      address: r.hook.address,
      abi: r.hook.abi,
      fromBlock: start,
      toBlock: end,
      strict: true,
    });
    for (const log of logs) {
      const args = log.args as Record<string, unknown>;
      if (log.eventName === "VolumeAdded" && args.poolId === r.poolId)
        events.push({
          type: "volume",
          block: log.blockNumber!,
          tx: log.transactionHash!,
          user: args.user as Address,
          eth: args.ethLeg as bigint,
          tier: Number(args.tier),
          index: log.logIndex!,
        });
      if (log.eventName === "FeesBurned")
        events.push({
          type: "burn",
          block: log.blockNumber!,
          tx: log.transactionHash!,
          eth: args.amount as bigint,
          index: log.logIndex!,
        });
    }
  }
  return {
    from,
    to,
    items: events
      .sort((a, b) =>
        a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1,
      )
      .slice(0, 12),
  };
}
