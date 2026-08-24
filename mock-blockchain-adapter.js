/* ---------------------------------------------------------------------
   Layer 2: MockBlockchainAdapter.

   Implements the BlockchainAdapter interface (see blockchain-adapter.js)
   against a plain in-memory array instead of a real chain. Used in two
   situations:

     1. Local file:// preview, before this is deployed anywhere. Opening
        index.html by double-clicking it can't run viem-blockchain-adapter.js
        (browsers block ES module scripts under file://), so this is what
        renders instead.
     2. As the safe default the instant the page loads over http(s) too,
        until ViemBlockchainAdapter finishes its first fetch and swaps in
        (see the "viem-adapter-ready" listener in index.html).

   Every token here starts as { owner: null, mintDate: null, ... } — i.e.
   "not yet minted" — because that's the honest state before Aug 26. This
   adapter never invents fake ownership data.
   --------------------------------------------------------------------- */
(function () {
  function MockBlockchainAdapter(opts) {
    window.BlockchainAdapter.call(this);
    opts = opts || {};
    var embeddedData = opts.embeddedData || [];
    this.byId = {};
    embeddedData.forEach(function (rec) {
      this.byId[String(rec.tokenId)] = rec;
    }, this);
    this.maxSupply = embeddedData.length;
  }
  MockBlockchainAdapter.prototype = Object.create(window.BlockchainAdapter.prototype);
  MockBlockchainAdapter.prototype.constructor = MockBlockchainAdapter;

  function normalizeState(rec) {
    rec = rec || {};
    return {
      owner: rec.owner || null,
      originalMinter: rec.originalMinter || rec.owner || null,
      mintDate: rec.mintDate || null,
      mintBlock: rec.mintBlock,
      burned: !!rec.burned,
      transferHistory: rec.transferHistory || []
    };
  }

  MockBlockchainAdapter.prototype.getCollectionState = function () {
    var mintedCount = 0;
    for (var id in this.byId) {
      if (this.byId[id].owner) mintedCount++;
    }
    return Promise.resolve({
      name: "Mentographs",
      symbol: "glimpse",
      maxSupply: this.maxSupply,
      totalSupply: mintedCount
    });
  };

  MockBlockchainAdapter.prototype.getTokenState = function (tokenId) {
    return Promise.resolve(normalizeState(this.byId[String(tokenId)]));
  };

  MockBlockchainAdapter.prototype.getTokensOwnedBy = function (address) {
    if (!address) return Promise.resolve([]);
    var addr = String(address).toLowerCase();
    var out = [];
    for (var id in this.byId) {
      var rec = this.byId[id];
      if (rec.owner && String(rec.owner).toLowerCase() === addr && !rec.burned) {
        out.push(Number(id));
      }
    }
    out.sort(function (a, b) { return a - b; });
    return Promise.resolve(out);
  };

  // getTokenMetadata is intentionally not overridden — the Mock adapter has
  // no real images to offer, so it keeps the base class's "always null"
  // behavior and callers fall back to the abstract rendering, exactly as
  // they should before anything is minted.

  window.MockBlockchainAdapter = MockBlockchainAdapter;
})();
