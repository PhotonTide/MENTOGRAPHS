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

  // Primary: pho's personal Alchemy app (free tier). Unlike the public
  // no-key endpoints tried before this (see git history / prior comments
  // for the saga — Ankr now requires a paid key, llamarpc.com and
  // eth.merkle.io have no CORS headers at all so browser JS can never
  // call them, and publicnode's free tier refuses "archive" log scans
  // this far back without a personal token), Alchemy is built for exactly
  // this: browser-based dapp calls, proper CORS support, and no
  // archive-request restriction on the free tier. publicnode is kept as
  // a second entry purely as a fallback in case Alchemy ever has an
  // outage — it just won't serve the full historical scan on its own.
  rpcUrls: [
    "https://eth-mainnet.g.alchemy.com/v2/alch_HrnygEIH21q3NiKG5-DGb",
    "https://ethereum-rpc.publicnode.com"
  ],

  // Public IPFS gateways (same fallback idea) used to resolve ipfs://
  // tokenURIs and ipfs:// image fields to fetchable https URLs. Ordered by
  // measured reliability against this contract's own actual CIDs, not
  // alphabetically or by popularity: repeated live tests (both the JSON
  // metadata and the real image files) show ipfs.io and dweb.link failing
  // outright, every time, in well under a second — dead weight this
  // collection's content just doesn't route through — while
  // gateway.pinata.cloud is the one that consistently, eventually serves
  // it (anywhere from ~2s to ~30s+ depending on the file, since it's
  // fetching-and-pinning on demand rather than serving from a hot cache).
  // Pinata goes first so real art shows up as fast as this collection's
  // content can actually be fetched, instead of waiting out two gateways
  // that have never once succeeded before even starting the one that
  // does. The dead ones stay listed as long-shot fallbacks in case that
  // ever changes — retrying them costs nothing since a fast failure just
  // starts the next candidate immediately (see viem-blockchain-adapter.js
  // and getArtworkImageEntry in index.html).
  ipfsGateways: [
    "https://gateway.pinata.cloud/ipfs/",
    "https://dweb.link/ipfs/",
    "https://ipfs.io/ipfs/"
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
