import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../dist/", import.meta.url));
export async function walk(dir, prefix = "") {
  const paths = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw Error("No symlinks in export");
    if (e.isDirectory())
      paths.push(...(await walk(`${dir}/${e.name}`, `${prefix}${e.name}/`)));
    else paths.push(`${prefix}${e.name}`);
  }
  return paths.sort();
}
const manifest = JSON.parse(
  await readFile(`${root}/imd-deployment.json`, "utf8"),
);
const files = (await walk(root)).filter((p) => p !== "imd-deployment.json");
if (files.length > 128) throw Error("Too many exported files");
let total = 0;
manifest.assets = await Promise.all(
  files.map(async (path) => {
    const bytes = await readFile(`${root}/${path}`);
    total += bytes.length;
    if (bytes.length > 8388608) throw Error("Asset exceeds 8 MiB");
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  }),
);
if (total > 8 * 1024 * 1024)
  throw Error("Export alone exceeds submission budget");
await writeFile(
  `${root}/imd-deployment.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Manifest: ${files.length} assets, ${total} bytes`);
