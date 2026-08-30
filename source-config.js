/* ---------------------------------------------------------------------
   Mentographs — Source contract configuration.

   Same idea as contract-config.js, for the separate "Source" 1/1: a
   standalone piece that isn't bought or sold in the normal sense. Instead
   its ownership automatically follows whoever currently holds the most
   Mentographs — see the Dominion page. It lives in its own small
   contract, deployed separately from the main 222-piece Mentographs
   contract, because the Mentographs contract itself (an OpenSea Studio
   SeaDrop clone) has no hook for this kind of logic and can't be changed
   after deployment anyway.

   LIVE: the Source contract is deployed at the address below (mainnet,
   deployed via Remix from account 0xa90dc6d356b622b9783f5020722e6f92b663438f,
   tx 0x92fdf...95d01, block 25866381). The ABI below already matches the
   MentographsSource.sol contract that was actually deployed — nothing
   else needs to change.

   Everything else about how this site reads the deployed contract
   (viem, public RPC, no server) matches contract-config.js — see that
   file if any of this is unfamiliar.
   --------------------------------------------------------------------- */
window.SOURCE_CONFIG = {
  // The deployed Source contract on Ethereum mainnet.
  address: "0x0b69729f75de268179f5ddc1738216a804154e6e",

  // Same chain as Mentographs itself.
  chainId: 1,

  // Trimmed ABI — only what the Dominion page actually calls or listens
  // for. Matches the Source.sol contract Claude will hand over next. The
  // standard ERC-721 Transfer event (not just a custom one) matters here
  // specifically: the site reconstructs "who held it, and for how long"
  // the exact same way it already does for Mentographs itself — via
  // Alchemy's asset-transfers API, which indexes by the standard Transfer
  // event. Without it, past-holder history on the Dominion page can't be
  // rebuilt.
  abi: [
    { "inputs": [], "name": "currentHolder", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "currentHolderSince", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "claimSource", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
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
