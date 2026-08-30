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

   THIS FILE IS A PLACEHOLDER until that contract is deployed. `address`
   below is null on purpose — the Dominion page reads that as "not live
   yet" and shows the holdings leaderboard normally, but keeps the Claim
   Source button disabled with an explanatory note instead of trying (and
   failing) to call a contract that doesn't exist. Once the Source
   contract is deployed:

     1. Paste its deployed address into `address` below (starts with 0x).
     2. Double-check `abi` below still matches the contract exactly —
        it's already written to match the Source contract Claude
        prepared alongside this site update, so if that's what you
        deployed unmodified, nothing here needs to change.
     3. Push. That's it — the Dominion page picks it up automatically,
        no other file needs touching.

   Everything else about how this site reads the deployed contract
   (viem, public RPC, no server) matches contract-config.js — see that
   file if any of this is unfamiliar.
   --------------------------------------------------------------------- */
window.SOURCE_CONFIG = {
  // Fill this in once the Source contract is deployed (see above). Left
  // null intentionally — do not put the Mentographs contract address
  // here, this is a different, separate contract.
  address: null,

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
