import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { keccak256, toHex } from "viem";
import { fileURLToPath } from "node:url";
const web = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = `${root}/dist`;
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
const manifest = await read(`${dist}/imd-deployment.json`);
const handoff = await read(`${web}/config/deployment.json`);
const network = await read(`${web}/config/network.json`);
const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
for (const k of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.deepEqual(manifest[k], handoff[k], k);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.deepEqual(
  manifest.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
assert.deepEqual(manifest.pool, handoff.manifest.pool);
const walk = async (dir, prefix = "") => {
  const paths = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    assert.equal(e.isSymbolicLink(), false);
    if (e.isDirectory())
      paths.push(...(await walk(`${dir}/${e.name}`, `${prefix}${e.name}/`)));
    else paths.push(`${prefix}${e.name}`);
  }
  return paths.sort();
};
const paths = (await walk(dist)).filter((p) => p !== "imd-deployment.json");
assert.deepEqual(manifest.assets.map((x) => x.path).sort(), paths);
assert.ok(paths.length <= 128);
assert.ok(paths.includes("index.html"));
let total = 0;
for (const a of manifest.assets) {
  assert.ok(
    !a.path.includes("..") && !a.path.startsWith("/") && !a.path.includes(":"),
  );
  const bytes = await readFile(`${dist}/${a.path}`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    a.sha256,
    a.path,
  );
  assert.ok(bytes.length <= 8388608);
  total += bytes.length;
}
assert.ok(total < 32 * 1024 * 1024);
for (const c of manifest.contracts) {
  const abi = await read(`${dist}/${c.abiPath}`);
  assert.ok(Array.isArray(abi));
  assert.equal(
    keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2),
    c.abiHash,
  );
  assert.deepEqual(
    abi,
    JSON.parse(
      execFileSync(
        "git",
        ["show", `${handoff.sourceCommit}:docs/abi/${c.name}.json`],
        { cwd: root, encoding: "utf8" },
      ),
    ),
  );
}
const html = await readFile(`${dist}/index.html`, "utf8");
assert.ok(html.includes("./assets/"));
assert.ok(!html.includes('src="/assets/'));
const forbidden = paths.filter((p) =>
  /node_modules|\.tgz$|\.map$|\.cache|package-lock|\.git/.test(p),
);
assert.deepEqual(forbidden, []);
const report = {
  checkedAt: new Date().toISOString(),
  result: "passed",
  assets: paths.length,
  assetBytes: total,
  manifestBytes: (await stat(`${dist}/imd-deployment.json`)).size,
  sourceCommit: manifest.sourceCommit,
  abiHashesVerified: true,
  networkUnchanged: true,
  completeAssetInventory: true,
  relativeBase: true,
};
await writeFile(
  `${root}/docs/frontend/export-check.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
