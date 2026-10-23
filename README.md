# DappFence × ENS: signer

Generates signed DappFence manifests for ENS websites (`*.eth.limo`), so DappFence can block files
that eth.limo or the IPFS gateway modified.

An ENS name's `contenthash` (onchain) points to an IPFS CID, the root hash of the site. The signer:

1. Reads the CID from ENS.
2. Downloads the site from an IPFS gateway, checking every block against its CID. Any mismatch aborts.
3. Signs a DappFence manifest with the sha256 of each file, as it is in IPFS.

`manifest-server.mjs` serves the signed manifests.

## Run (Node 22+)

```sh
npm install
echo "DAPPFENCE_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" > .env
node signer.mjs vitalik.eth     # writes manifests/vitalik.eth.json
node manifest-server.mjs        # serves manifests/ on http://localhost:4100
```
