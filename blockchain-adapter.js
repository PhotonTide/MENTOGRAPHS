/* ---------------------------------------------------------------------
   Layer 2: blockchain adapter interface.

   Every adapter (MockBlockchainAdapter for local/pre-chain preview,
   ViemBlockchainAdapter for the real deployed contract) implements this
   same shape, so index.html never has to know or care which one is
   currently active. This file just documents that shape and gives both
   adapters something to extend.

   Methods:
     getCollectionState() -> Promise<{ name, symbol, maxSupply, totalSupply }>
     getTokenState(tokenId) -> Promise<{
         owner, originalMinter, mintDate, mintBlock, burned, transferHistory
       }>
       transferHistory is an array of { from, to, date, blockNumber, txHash }.
       For a token that hasn't been minted yet, owner/originalMinter/mintDate
       should all be null and transferHistory an empty array — that's the
       honest "not yet minted" state, not an error.
     getTokenHistory(tokenId) -> Promise<transferHistory array>
       Convenience wrapper; by default just re-reads getTokenState().
     getTokensOwnedBy(address) -> Promise<number[]>
       All tokenIds currently owned by `address`, used by the
       "Find my Mentograph" wallet lookup. Empty array if none / address
       is falsy.
     getTokenMetadata(tokenId) -> Promise<{ image, name, attributes } | null>
       Optional. Only ViemBlockchainAdapter implements this for real —
       it reads tokenURI() on-chain and resolves the resulting metadata
       JSON to a real image URL. Returns null if there's no real image
       yet (not minted, not revealed, or the fetch failed) — callers
       must treat null as "fall back to the abstract rendering", never
       as an error.
     watchToken(tokenId, callback) -> unwatch function   [optional]
       If implemented, callback fires with a fresh getTokenState()-shaped
       object whenever this token's ownership changes on-chain while
       being watched. Feature-detected by callers (`if (adapter.watchToken)`)
       rather than assumed, since MockBlockchainAdapter doesn't implement it.
     getHoldingsLeaderboard() -> Promise<Array<{ address, count }>>
       Every current (non-burned) holder and how many Mentographs they
       hold, sorted highest-count first. Powers the Dominion page. Default
       implementation below returns an empty list; both real adapters
       override it.
     getEnsName(address) -> Promise<string | null>
       Best-effort reverse ENS lookup for display purposes only — null
       (never a thrown error) if there isn't one or the lookup fails.
       Only ViemBlockchainAdapter overrides this for real.
   --------------------------------------------------------------------- */
(function () {
  function BlockchainAdapter() {}

  BlockchainAdapter.prototype.getCollectionState = function () {
    return Promise.reject(new Error("getCollectionState() not implemented"));
  };
  BlockchainAdapter.prototype.getTokenState = function (_tokenId) {
    return Promise.reject(new Error("getTokenState() not implemented"));
  };
  BlockchainAdapter.prototype.getTokenHistory = function (tokenId) {
    return this.getTokenState(tokenId).then(function (state) {
      return state.transferHistory || [];
    });
  };
  BlockchainAdapter.prototype.getTokensOwnedBy = function (_address) {
    return Promise.reject(new Error("getTokensOwnedBy() not implemented"));
  };
  BlockchainAdapter.prototype.getTokenMetadata = function (_tokenId) {
    return Promise.resolve(null); // no real image support by default
  };
  BlockchainAdapter.prototype.getHoldingsLeaderboard = function () {
    return Promise.resolve([]); // no live holdings data by default
  };
  BlockchainAdapter.prototype.getEnsName = function (_address) {
    return Promise.resolve(null); // no ENS resolution by default
  };
  // watchToken intentionally left undefined on the prototype so
  // `adapter.watchToken` is a clean feature-detect for adapters that don't
  // implement it.

  window.BlockchainAdapter = BlockchainAdapter;
})();
