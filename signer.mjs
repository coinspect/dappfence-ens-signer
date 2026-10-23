import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import * as dagPb from "@ipld/dag-pb";
import { deriveIdentity, signManifest } from "@dappfence/manifest-tools";
import { generateManifest } from "@dappfence/manifest-tools/manifest";
import { JsonRpcProvider } from "ethers";
import { UnixFS } from "ipfs-unixfs";
import { CID } from "multiformats/cid";

const RPC = "https://ethereum-rpc.publicnode.com";
const GATEWAY = "https://ipfs.filebase.io";

const ensName = process.argv[2];
if (!ensName) throw new Error("Usage: node signer.mjs <name.eth>");

try { process.loadEnvFile(); } catch {}
const secretKey = process.env.DAPPFENCE_SECRET_KEY;
if (!secretKey) throw new Error("DAPPFENCE_SECRET_KEY is not set");
const siteDir = path.resolve("site", ensName);

// 1. ENS -> CID, read onchain
const provider = new JsonRpcProvider(RPC, 1, { staticNetwork: true });
const blockNumber = await provider.getBlockNumber();
const contenthash = await (await provider.getResolver(ensName)).getContentHash();
if (!contenthash?.startsWith("ipfs://")) throw new Error(`Not an ipfs:// contenthash: ${contenthash}`);
const rootCid = CID.parse(contenthash.slice(7)).toV1();
console.log(`1. ${ensName} -> ${rootCid} (block ${blockNumber})`);

// 2. Fetch every block from the gateway and check sha256(block) against its CID.
// Child CIDs come only from verified blocks, so everything downloaded matches the ENS root CID.
async function getBlock(cid) {
  const cacheFile = path.resolve("cache", cid.toV1().toString());
  let bytes;
  if (existsSync(cacheFile)) {
    bytes = await fs.readFile(cacheFile);
  } else {
    for (let attempt = 1; !bytes; attempt++) {
      const res = await fetch(`${GATEWAY}/ipfs/${cid}?format=raw`).catch(() => null);
      if (res?.ok) bytes = Buffer.from(await res.arrayBuffer());
      else if (attempt === 8) throw new Error(`Failed to fetch ${cid}: ${res?.status}`);
      else await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // rate limited
    }
  }
  const hash = createHash("sha256").update(bytes).digest();
  if (!hash.equals(Buffer.from(cid.multihash.digest))) {
    throw new Error(`Block ${cid} does not match its CID: the gateway returned tampered data`);
  }
  await fs.mkdir("cache", { recursive: true });
  await fs.writeFile(cacheFile, bytes);
  return bytes;
}

async function readFile(cid) {
  const bytes = await getBlock(cid);
  if (cid.code !== dagPb.code) return bytes;
  const node = dagPb.decode(bytes);
  if (!node.Links.length) return Buffer.from(UnixFS.unmarshal(node.Data).data ?? []);
  return Buffer.concat(await Promise.all(node.Links.map((l) => readFile(l.Hash))));
}

async function download(cid, dest) {
  const node = cid.code === dagPb.code ? dagPb.decode(await getBlock(cid)) : null;
  const type = node ? UnixFS.unmarshal(node.Data).type : "raw";
  if (type === "directory") {
    await fs.mkdir(dest, { recursive: true });
    for (const link of node.Links) await download(link.Hash, path.join(dest, link.Name));
  } else {
    await fs.writeFile(dest, await readFile(cid));
  }
}

await fs.rm(siteDir, { recursive: true, force: true });
await download(rootCid, siteDir);
console.log(`2. Downloaded ${siteDir}, every block matches the CID`);

// 3. Build the manifest with the sha256 of each downloaded file, record in metadata.source which
// ENS name, CID and block it came from, sign it, and write it to manifests/<name>.json
await generateManifest({
  secretKey,
  outDir: siteDir,
  manifestPath: "integrity-manifest.json",
  mode: "protected",
  pathRules: [{ type: "directory-index" }],
  logger: console,
});
const generated = path.join(siteDir, "integrity-manifest.json");
const { pay } = JSON.parse(await fs.readFile(generated, "utf8"));
await fs.rm(generated);
pay.metadata.source = { ensName, contenthash, cid: rootCid.toString(), blockNumber };

const manifestFile = path.resolve("manifests", `${ensName}.json`);
await fs.mkdir(path.dirname(manifestFile), { recursive: true });
await fs.writeFile(manifestFile, JSON.stringify(signManifest(pay, { secretKey }), null, 2));
console.log(`3. Signed ${Object.keys(pay.files).length} files by ${deriveIdentity(secretKey)} -> ${manifestFile}`);
