/* ---------------------------------------------------------------------
   Mentographs — live contract configuration.

   This is the one file that ties the site to the real, deployed
   contract. Everything else (viem-blockchain-adapter.js) just reads
   from window.CONTRACT_CONFIG rather than hardcoding an address.

   Confirmed directly against the deployed contract on Ethereum mainnet
   before shipping this file:
     name()        -> "Mentographs"
     symbol()      -> "glimpse"
     maxSupply()   -> 222
     totalSupply() -> 0   (nothing minted yet — expected pre-launch)

   It's an OpenSea Studio "SeaDrop" collection (ERC721SeaDropCloneable,
   deployed as an EIP-1167 minimal proxy), which is why the ABI below
   only needs a handful of standard ERC-721 + SeaDrop reads/events rather
   than the full contract surface.
   --------------------------------------------------------------------- */
window.CONTRACT_CONFIG = {
  // The deployed Mentographs contract (proxy address — this is the address
  // people mint from and the one every read below targets).
  address: "0x2f55091e04a81462c10603e9903106499c4980b9",

  // Ethereum mainnet.
  chainId: 1,

  // Block the contract was created in. Transfer-log scans start here
  // instead of from block 0, which is what makes indexing the whole
  // collection's ownership fast enough to do straight from the browser.
  deployBlock: 25785152,

  // Public RPC endpoint(s). Checked directly in a real browser (not just
  // curl/server-side, which never hits CORS) on 2026-08-26 and found:
  //   - rpc.ankr.com/eth: now requires a paid API key. Removed.
  //   - eth.llamarpc.com: has no Access-Control-Allow-Origin header at
  //     all, so it can NEVER be called from browser JS — every request
  //     fails at the CORS preflight before it even reaches their server.
  //     Removed (it was silent dead weight even before ankr broke).
  //   - eth.merkle.io: same CORS problem as llamarpc.com. Removed.
  //   - ethereum-rpc.publicnode.com: the only one of the four that
  //     actually supports being called from a browser (no CORS block).
  //     It did return 403s under the burst of parallel requests generated
  //     while testing this — see the reduced CONCURRENCY / larger
  //     CHUNK_SIZE in viem-blockchain-adapter.js, which cuts the request
  //     count way down to stay under whatever rate limit that was.
  //
  // Bottom line: free public RPCs are inherently flaky for this (CORS
  // support and rate limits vary and change without notice). The durable
  // fix is a real provider key — Alchemy or Infura's free tier both work
  // great and support CORS properly; add the URL they give you as an
  // additional entry in this array (keep publicnode as a fallback).
  rpcUrls: [
    "https://ethereum-rpc.publicnode.com"
  ],

  // Public IPFS gateways (same fallback idea) used to resolve ipfs://
  // tokenURIs and ipfs:// image fields to fetchable https URLs.
  ipfsGateways: [
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://gateway.pinata.cloud/ipfs/"
  ],

  // Trimmed ABI — only what this site actually calls or listens for.
  // (Full ABI is on the implementation contract, verified on Etherscan/
  // Blockscout, if it's ever needed: 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A)
  abi: [
    { "inputs": [], "name": "name", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "symbol", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "maxSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "ownerOf", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "tokenURI", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "minter", "type": "address" }], "name": "getMintStats", "outputs": [{ "internalType": "uint256", "name": "minterNumMinted", "type": "uint256" }, { "internalType": "uint256", "name": "currentTotalSupply", "type": "uint256" }, { "internalType": "uint256", "name": "maxSupply", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    {
      "anonymous": false,
      "inputs": [
        { "indexed": true, "internalType": "address", "name": "from", "type": "address" },
        { "indexed": true, "internalType": "address", "name": "to", "type": "address" },
        { "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }
      ],
      "name": "Transfer",
      "type": "event"
    }
  ]
};
