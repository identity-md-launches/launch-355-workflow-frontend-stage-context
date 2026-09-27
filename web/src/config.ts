import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
  toHex,
  parseAbi,
  encodeAbiParameters,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import { createConfig, injected } from "wagmi";

export interface Deployment {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: {
      poolManager: Address;
      stateView: Address;
      quoter: Address;
      universalRouter: Address;
      permit2: Address;
      positionManager: Address;
    };
  };
  walletAddChain: {
    chainId: Hex;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: {
    pairedCurrency: Address;
    fee: number;
    tickSpacing: number;
    initialPrice: string;
  };
  token: { name: string; symbol: string; decimals: number; contract: string };
  deploymentBlock: number;
  routing: { poolSwapTest: Address };
}
export const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;
export const protocol = {
  errors: parseAbi([
    "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
    "error UnexpectedRevertBytes(bytes revertData)",
  ]),
  router: parseAbi([
    "function manager() view returns (address)",
    "function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) payable returns (int256 delta)",
  ]),
  state: parseAbi([
    "function poolManager() view returns (address)",
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  ]),
  quoter: parseAbi([
    "function poolManager() view returns (address)",
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  ]),
};
export function canonical(x: unknown): unknown {
  return Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical((x as Record<string, unknown>)[k])]),
        )
      : x;
}
const safePath = (p: string) =>
  !p.startsWith("/") &&
  !p.includes("..") &&
  !p.includes(":") &&
  !p.includes("\\");
export async function loadDeployment() {
  const response = await fetch(
    `${import.meta.env.BASE_URL}imd-deployment.json`,
    { cache: "no-cache" },
  );
  if (!response.ok)
    throw Error(
      "Deployment configuration could not be loaded. Reload the page.",
    );
  const d: Deployment = await response.json();
  if (
    d.version !== 1 ||
    d.chainId !== d.network.chainId ||
    Number(d.walletAddChain.chainId) !== d.chainId ||
    !d.network.testnet
  )
    throw Error("Invalid deployment network. Actions are unavailable.");
  const entries = await Promise.all(
    d.contracts.map(async (c) => {
      if (!safePath(c.abiPath)) throw Error("Unsafe ABI path");
      const r = await fetch(`${import.meta.env.BASE_URL}${c.abiPath}`);
      if (!r.ok) throw Error(`Cannot load ${c.name} ABI`);
      const abi: Abi = await r.json();
      if (
        !Array.isArray(abi) ||
        keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2) !== c.abiHash
      )
        throw Error(`ABI verification failed: ${c.name}`);
      return [c.name, { ...c, abi: abi as Abi }] as const;
    }),
  );
  const contracts = Object.fromEntries(entries);
  const token = contracts[d.token.contract],
    hook = contracts.LoyaltyTierHook;
  if (
    !token ||
    !hook ||
    d.pool.pairedCurrency !== "0x0000000000000000000000000000000000000000"
  )
    throw Error("Unsupported pool configuration");
  const chain = defineChain({
    id: d.chainId,
    name: d.network.name,
    nativeCurrency: d.network.nativeCurrency,
    rpcUrls: { default: { http: d.network.rpcUrls } },
    blockExplorers: {
      default: { name: d.network.name, url: d.network.explorer },
    },
    testnet: d.network.testnet,
  });
  const transport = () =>
    fallback(
      d.network.rpcUrls.map((url) =>
        http(url, { timeout: 10000, retryCount: 0 }),
      ),
      { retryCount: 0 },
    );
  const client = createPublicClient({ chain, transport: transport() });
  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: transport() },
    multiInjectedProviderDiscovery: true,
  });
  const poolKey = {
    currency0: d.pool.pairedCurrency as Address,
    currency1: token.address,
    fee: d.pool.fee,
    tickSpacing: d.pool.tickSpacing,
    hooks: hook.address,
  };
  const poolId = keccak256(encodeAbiParameters([poolKeyType], [poolKey]));
  return { d, contracts, token, hook, chain, client, wagmi, poolKey, poolId };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
