/* ---------------------------------------------------------------------
   Layer 2: ViemBlockchainAdapter — the real, live chain data source.

   No server, no API key, no database: this reads ownership, transfer
   history, and revealed artwork straight off Ethereum mainnet using
   public RPC endpoints and public IPFS gateways, all from
   window.CONTRACT_CONFIG (contract-config.js).

   This is an ES module (needs top-level `import`), which is why it's
   loaded with <script type="module"> in index.html and why it only
   works when the page is served over http(s) — Chrome (and every other
   browser) blocks module scripts under file://. Opening index.html
   directly still works fine for local preview; it just stays on
   MockBlockchainAdapter's placeholder data until you serve it for real.

   How the ownership index works: instead of calling ownerOf() 222 times
   (222 round trips), this fetches every Transfer event the contract has
   ever emitted in a single getLogs call, then reconstructs current
   owner / original minter / mint date / full transfer history per token
   from that log, entirely in memory. Fast, and it's the same log a block
   explorer would read.

   How images work: tokenURI(tokenId) is only callable for a token that
   exists (has been minted) — before that it correctly reverts, and this
   adapter treats that as "no image yet," not an error. Once minted, the
   real source of truth for "what does token #N actually look like" is
   whatever tokenURI(N) resolves to on IPFS — not any local file order —
   so nothing about image mapping needs to be sorted or maintained by
   hand, before or after OpenSea's Reveal step.
   --------------------------------------------------------------------- */
import { createPublicClient, http, fallback } from "https://esm.sh/viem@2.21.0?bundle";

(function () {

var config = window.CONTRACT_CONFIG;
if (!config || !config.address || !config.abi) {
  console.warn("viem-blockchain-adapter: window.CONTRACT_CONFIG is missing or incomplete — staying on MockBlockchainAdapter.");
  return;
}

var TRANSFER_EVENT = config.abi.filter(function (x) { return x.type === "event" && x.name === "Transfer"; })[0];
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
var BURN_ADDRESSES = [ZERO_ADDRESS, "0x000000000000000000000000000000000000dead"];

var client = createPublicClient({
  chain: {
    id: config.chainId,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: config.rpcUrls } }
  },
  transport: fallback((config.rpcUrls || []).map(function (url) { return http(url); }))
});

function resolveContentUri(uri) {
  if (!uri) return null;
  if (uri.indexOf("ipfs://") === 0) {
    var path = uri.slice("ipfs://".length);
    var gateway = (config.ipfsGateways && config.ipfsGateways[0]) || "https://ipfs.io/ipfs/";
    return gateway + path;
  }
  if (uri.indexOf("ar://") === 0) {
    return "https://arweave.net/" + uri.slice("ar://".length);
  }
  return uri; // already http(s), or a data: URI — fetch()/Image() can use either directly
}

// Tries each configured IPFS gateway in turn for a given ipfs:// URI,
// rather than committing to whichever one resolveContentUri() picked
// first — a single flaky gateway shouldn't make revealed art disappear.
function fetchWithGatewayFallback(uri) {
  if (!uri) return Promise.reject(new Error("no uri"));
  if (uri.indexOf("ipfs://") !== 0) {
    return fetch(resolveContentUri(uri)).then(function (res) {
      if (!res.ok) throw new Error("fetch failed: " + res.status);
      return res;
    });
  }
  var path = uri.slice("ipfs://".length);
  var gateways = (config.ipfsGateways && config.ipfsGateways.length) ? config.ipfsGateways : ["https://ipfs.io/ipfs/"];
  var attempt = function (i) {
    if (i >= gateways.length) return Promise.reject(new Error("all IPFS gateways failed for " + uri));
    return fetch(gateways[i] + path).then(function (res) {
      if (!res.ok) throw new Error("gateway failed: " + res.status);
      return res;
    }).catch(function () { return attempt(i + 1); });
  };
  return attempt(0);
}

function ViemBlockchainAdapter() {
  window.BlockchainAdapter.call(this);
  this.index = {};
  this.metadataCache = {};
  this.tokenURICache = {};
  this.ready = this._buildIndex();
}
ViemBlockchainAdapter.prototype = Object.create(window.BlockchainAdapter.prototype);
ViemBlockchainAdapter.prototype.constructor = ViemBlockchainAdapter;

ViemBlockchainAdapter.prototype._buildIndex = function () {
  var self = this;
  if (!TRANSFER_EVENT) {
    console.warn("ViemBlockchainAdapter: no Transfer event in CONTRACT_CONFIG.abi");
    return Promise.resolve();
  }

  // Public RPC endpoints commonly cap how many blocks a single eth_getLogs
  // call can span, and the caps vary by provider and aren't documented
  // consistently. deployBlock..latest only grows as the collection ages,
  // so a single unbounded getLogs call that happens to work on day one can
  // start silently failing later — the whole index falls back to empty,
  // which reads on-page as "no Mentographs found" for every wallet, even
  // though totalSupply() (a separate, single-block call) keeps working
  // fine. Paginating in fixed-size windows, with retry-by-bisection on any
  // window a given provider rejects, avoids that failure mode entirely.
  var CHUNK_SIZE = BigInt(1900);

  return client.getBlockNumber().then(function (latest) {
    var fromBlock = BigInt(config.deployBlock || 0);
    var ranges = [];
    for (var start = fromBlock; start <= latest; start += CHUNK_SIZE) {
      var end = start + CHUNK_SIZE - BigInt(1);
      if (end > latest) end = latest;
      ranges.push([start, end]);
    }

    function fetchRange(fromB, toB, attemptsLeft) {
      return client.getLogs({
        address: config.address,
        event: TRANSFER_EVENT,
        fromBlock: fromB,
        toBlock: toB
      }).catch(function (err) {
        if (attemptsLeft <= 0 || toB <= fromB) {
          console.warn("ViemBlockchainAdapter: giving up on block range " + fromB + "-" + toB + " after retries:", err);
          return [];
        }
        // Split the offending window in half and retry each half — if the
        // failure was a range-too-large rejection from one provider, a
        // narrower window (possibly served by a different fallback
        // provider) usually succeeds.
        var mid = fromB + (toB - fromB) / BigInt(2);
        return Promise.all([
          fetchRange(fromB, mid, attemptsLeft - 1),
          fetchRange(mid + BigInt(1), toB, attemptsLeft - 1)
        ]).then(function (parts) { return parts[0].concat(parts[1]); });
      });
    }

    // Cap how many windows are in flight at once rather than firing every
    // chunk simultaneously against free public endpoints.
    var CONCURRENCY = 3;
    var results = [];
    var i = 0;
    function next() {
      if (i >= ranges.length) return Promise.resolve();
      var idx = i++;
      return fetchRange(ranges[idx][0], ranges[idx][1], 2).then(function (logs) {
        results[idx] = logs;
        return next();
      });
    }
    var workers = [];
    for (var w = 0; w < CONCURRENCY && w < ranges.length; w++) workers.push(next());
    return Promise.all(workers).then(function () {
      return [].concat.apply([], results);
    });
  }).then(function (logs) {
    var blockNumbers = {};
    logs.forEach(function (log) { blockNumbers[log.blockNumber.toString()] = log.blockNumber; });
    var uniqueBlocks = Object.keys(blockNumbers).map(function (k) { return blockNumbers[k]; });

    return Promise.all(uniqueBlocks.map(function (bn) {
      return client.getBlock({ blockNumber: bn }).then(function (block) {
        return [bn.toString(), Number(block.timestamp)];
      }).catch(function () {
        return [bn.toString(), null]; // timestamp unavailable — still show the transfer, just without a date
      });
    })).then(function (pairs) {
      var timestamps = {};
      pairs.forEach(function (p) { timestamps[p[0]] = p[1]; });

      logs.forEach(function (log) {
        var tokenId = log.args.tokenId.toString();
        var rec = self.index[tokenId] || (self.index[tokenId] = { transferHistory: [] });
        var ts = timestamps[log.blockNumber.toString()];
        rec.transferHistory.push({
          from: log.args.from,
          to: log.args.to,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          date: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null
        });
      });

      Object.keys(self.index).forEach(function (tokenId) {
        var rec = self.index[tokenId];
        rec.transferHistory.sort(function (a, b) { return Number(a.blockNumber - b.blockNumber); });
        var mintEntry = rec.transferHistory.filter(function (tr) { return tr.from.toLowerCase() === ZERO_ADDRESS; })[0];
        var last = rec.transferHistory[rec.transferHistory.length - 1];
        rec.owner = last.to;
        rec.originalMinter = mintEntry ? mintEntry.to : rec.transferHistory[0].to;
        rec.mintDate = mintEntry ? mintEntry.date : rec.transferHistory[0].date;
        rec.mintBlock = mintEntry ? mintEntry.blockNumber : rec.transferHistory[0].blockNumber;
        rec.burned = BURN_ADDRESSES.indexOf(last.to.toLowerCase()) !== -1;
      });
    });
  }).catch(function (err) {
    console.warn("ViemBlockchainAdapter: failed to build the transfer-log index (falling back to empty / not-yet-minted for everything):", err);
    self.index = {};
    self.initError = err;
  });
};

function normalizeState(rec) {
  rec = rec || {};
  return {
    owner: rec.owner || null,
    originalMinter: rec.originalMinter || null,
    mintDate: rec.mintDate || null,
    mintBlock: rec.mintBlock,
    burned: !!rec.burned,
    transferHistory: rec.transferHistory || []
  };
}

ViemBlockchainAdapter.prototype.getCollectionState = function () {
  // Read fresh from the chain (one cheap call) rather than trusting the
  // in-memory index, so a live "X / 222 minted" counter stays correct
  // even between transfer-log refreshes.
  return client.readContract({
    address: config.address,
    abi: config.abi,
    functionName: "totalSupply"
  }).then(function (totalSupply) {
    return { name: "Mentographs", symbol: "glimpse", maxSupply: 222, totalSupply: Number(totalSupply) };
  }).catch(function () {
    return { name: "Mentographs", symbol: "glimpse", maxSupply: 222, totalSupply: null };
  });
};

ViemBlockchainAdapter.prototype.getTokenState = function (tokenId) {
  var self = this;
  return this.ready.then(function () {
    return normalizeState(self.index[String(tokenId)]);
  });
};

ViemBlockchainAdapter.prototype.getTokensOwnedBy = function (address) {
  var self = this;
  if (!address) return Promise.resolve([]);
  var addr = String(address).toLowerCase();
  return this.ready.then(function () {
    var out = [];
    Object.keys(self.index).forEach(function (tokenId) {
      var rec = self.index[tokenId];
      if (rec.owner && String(rec.owner).toLowerCase() === addr && !rec.burned) out.push(Number(tokenId));
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  });
};

// Real artwork, resolved live from the chain. Returns null (never throws)
// for: not minted yet, not revealed yet, a metadata host that's briefly
// down, or a malformed pre-reveal URI — every one of those is "no image
// yet," and callers fall back to the abstract DNA-driven rendering, which
// is always correct to show and never a dead end.
ViemBlockchainAdapter.prototype.getTokenMetadata = function (tokenId) {
  var self = this;
  var key = String(tokenId);
  if (this.metadataCache[key] !== undefined) return Promise.resolve(this.metadataCache[key]);

  var uriPromise = this.tokenURICache[key] || (this.tokenURICache[key] = client.readContract({
    address: config.address,
    abi: config.abi,
    functionName: "tokenURI",
    args: [BigInt(tokenId)]
  }));

  var result = uriPromise
    .then(function (uri) {
      if (uri && uri.indexOf("data:application/json") === 0) {
        // fully on-chain metadata, base64 or plain — no fetch needed
        var commaIdx = uri.indexOf(",");
        var payload = uri.slice(commaIdx + 1);
        var json = uri.slice(0, commaIdx).indexOf("base64") !== -1
          ? JSON.parse(atob(payload))
          : JSON.parse(decodeURIComponent(payload));
        return json;
      }
      return fetchWithGatewayFallback(uri).then(function (res) { return res.json(); });
    })
    .then(function (json) {
      var image = json.image ? resolveContentUri(json.image) : null;
      var out = image ? { image: image, name: json.name || null, attributes: json.attributes || [] } : null;
      self.metadataCache[key] = out;
      return out;
    })
    .catch(function () {
      self.metadataCache[key] = null;
      return null;
    });

  return result;
};

ViemBlockchainAdapter.prototype.watchToken = function (tokenId, callback) {
  var self = this;
  var unwatch = client.watchContractEvent({
    address: config.address,
    abi: config.abi,
    eventName: "Transfer",
    args: { tokenId: BigInt(tokenId) },
    onLogs: function (logs) {
      logs.forEach(function (log) {
        var rec = self.index[String(tokenId)] || (self.index[String(tokenId)] = { transferHistory: [] });
        rec.transferHistory.push({ from: log.args.from, to: log.args.to, blockNumber: log.blockNumber, txHash: log.transactionHash, date: new Date().toISOString().slice(0, 10) });
        rec.owner = log.args.to;
        rec.originalMinter = rec.originalMinter || (log.args.from.toLowerCase() === ZERO_ADDRESS ? log.args.to : null);
        rec.mintDate = rec.mintDate || (log.args.from.toLowerCase() === ZERO_ADDRESS ? rec.transferHistory[rec.transferHistory.length - 1].date : null);
        rec.burned = BURN_ADDRESSES.indexOf(log.args.to.toLowerCase()) !== -1;
      });
      callback(normalizeState(self.index[String(tokenId)]));
    },
    onError: function (err) { console.warn("watchToken(" + tokenId + ") error:", err); }
  });
  return unwatch;
};

window.ViemBlockchainAdapter = ViemBlockchainAdapter;
window.dispatchEvent(new Event("viem-adapter-ready"));

})();
