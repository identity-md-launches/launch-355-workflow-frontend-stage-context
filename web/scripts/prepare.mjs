import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { keccak256, toHex } from "viem";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
const d = await read("config/deployment.json");
const n = await read("config/network.json");
const routing = await read("config/routing.json");
export const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
if (
  d.chainId !== n.network.chainId ||
  Number(n.walletAddChain.chainId) !== d.chainId
)
  throw Error("Chain mismatch");
await mkdir("public/abi", { recursive: true });
for (const c of d.contracts) {
  const p = `docs/abi/${c.name}.json`;
  const bytes = execFileSync("git", ["show", `${d.sourceCommit}:${p}`], {
    cwd: "..",
  });
  const current = await readFile(`../${p}`);
  if (!bytes.equals(current))
    throw Error(`Working ABI differs from pinned source: ${p}`);
  const abi = JSON.parse(bytes);
  const hash = keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
  if (hash !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name} ${hash}`);
  await writeFile(`public/abi/${c.name}.json`, bytes);
  console.log(`Verified ${c.name}: ${hash}`);
}
const output = {
  version: 1,
  launchId: d.launchId,
  chainId: d.chainId,
  sourceCommit: d.sourceCommit,
  attestationHash: d.attestationHash,
  contracts: d.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
  assets: [],
  network: n.network,
  walletAddChain: n.walletAddChain,
  pool: d.manifest.pool,
  token: d.manifest.token,
  deploymentBlock: Math.min(...d.contracts.map((c) => c.blockNumber)),
  routing,
};
await writeFile(
  "public/imd-deployment.json",
  JSON.stringify(output, null, 2) + "\n",
);
