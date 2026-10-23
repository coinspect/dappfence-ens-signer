// Serves the signed manifests on http://localhost:4100:
//   GET /manifests/<name.eth>.json
//
//   node manifest-server.mjs

import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

const dir = path.resolve("manifests");

http
  .createServer(async (req, res) => {
    const name = req.url.match(/^\/manifests\/([a-z0-9.-]+\.eth)\.json$/)?.[1];
    const body = name && (await fs.readFile(path.join(dir, `${name}.json`)).catch(() => null));
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }).end(body);
  })
  .listen(4100, () => console.log(`Serving ${dir} on http://localhost:4100`));
