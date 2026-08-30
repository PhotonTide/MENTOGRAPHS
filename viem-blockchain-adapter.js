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
import { mainnet } from "https://esm.sh/viem@2.21.0/chains?bundle";

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

// A second client, specifically for ENS reverse lookups (Dominion page
// wallet display), built against viem's own `mainnet` chain definition
// rather than the bare-bones custom `chain` object above — ENS resolution
// needs the well-known ENS Registry / Universal Resolver contract
// addresses, and those ship correctly (and get kept up to date) inside
// viem's chain definitions rather than something worth hand-copying here.
// Only meaningful on mainnet; on any other chainId this collection isn't
// deployed to, ENS lookups are simply skipped (see getEnsName below).
var ensClient = (config.chainId === 1) ? createPublicClient({
  chain: mainnet,
  transport: fallback((config.rpcUrls || []).map(function (url) { return http(url); }))
}) : null;

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

// Same idea as resolveContentUri(), but returns every gateway URL worth
// trying, in order, instead of committing to just the first one. The JSON
// metadata fetch (fetchWithGatewayFallback, below) already retries across
// all configured gateways when one is down — this gives image loading
// (an <img>, not a fetch()) the same list to retry against, since a single
// dead gateway shouldn't leave a revealed piece stuck on the abstract
// rendering when the other configured gateways would have served it fine.
function resolveContentUriCandidates(uri) {
  if (!uri) return [];
  if (uri.indexOf("ipfs://") === 0) {
    var path = uri.slice("ipfs://".length);
    var gateways = (config.ipfsGateways && config.ipfsGateways.length) ? config.ipfsGateways : ["https://ipfs.io/ipfs/"];
    return gateways.map(function (gw) { return gw + path; });
  }
  var single = resolveContentUri(uri);
  return single ? [single] : [];
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
  this.ensCache = {};
  this.ready = this._buildIndex();
}
ViemBlockchainAdapter.prototype = Object.create(window.BlockchainAdapter.prototype);
ViemBlockchainAdapter.prototype.constructor = ViemBlockchainAdapter;

// Alchemy's alchemy_getAssetTransfers is a proper indexed API (paginated by
// pageKey, no block-range-per-call limit) rather than a raw log scan, and
// withMetadata:true hands back each transfer's block timestamp inline — no
// separate getBlock() round trip needed. This is the primary path whenever
// an Alchemy URL is configured (see getAlchemyRestBase, below).
function fetchAlchemyTransfers(alchemyBase) {
  var MAX_COUNT_HEX = "0x3e8"; // 1000 per page, Alchemy's max
  function page(pageKey, acc) {
    var params = {
      fromBlock: config.deployBlock ? ("0x" + BigInt(config.deployBlock).toString(16)) : "0x0",
      toBlock: "latest",
      contractAddresses: [config.address],
      category: ["erc721"],
      withMetadata: true,
      maxCount: MAX_COUNT_HEX
    };
    if (pageKey) params.pageKey = pageKey;
    return fetch(alchemyBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [params] })
    }).then(function (res) { return res.json(); }).then(function (json) {
      if (json.error) throw new Error("alchemy_getAssetTransfers: " + json.error.message);
      var transfers = (json.result && json.result.transfers) || [];
      var combined = acc.concat(transfers);
      return (json.result && json.result.pageKey) ? page(json.result.pageKey, combined) : combined;
    });
  }
  return page(null, []).then(function (transfers) {
    return transfers.map(function (tr) {
      return {
        tokenId: BigInt(tr.erc721TokenId || tr.tokenId).toString(),
        from: tr.from,
        to: tr.to,
        blockNumber: BigInt(tr.blockNum),
        txHash: tr.hash,
        date: (tr.metadata && tr.metadata.blockTimestamp) ? tr.metadata.blockTimestamp.slice(0, 10) : null
      };
    });
  });
}

// Fallback for when no Alchemy URL is configured at all (contract-config.js
// changes providers, say). Raw eth_getLogs, chunked and retried.
//
// Public RPC endpoints commonly cap how many blocks a single eth_getLogs
// call can span, and the caps vary by provider — and can be far stricter
// than "commonly" suggests (this contract's own Alchemy key, for instance,
// has been seen enforcing a hard 10-block ceiling on eth_getLogs regardless
// of the range requested, a couple of orders of magnitude below the usual
// free-tier limit, likely a plan/quota issue worth checking on Alchemy's
// dashboard rather than something this code can fix). A single unbounded
// getLogs call that happens to work on day one can start silently failing
// later — the whole index falls back to empty, which reads on-page as
// "not yet minted" for every token, even though totalSupply() (a separate,
// single-block call) keeps working fine. So: paginate in fixed-size
// windows, and if a window is rejected, parse the provider's own stated
// cap out of the error message (most providers, Alchemy included, state it
// directly) and re-chunk to exactly that size instead of blindly bisecting
// — bisecting a 15000-block window by half only twice (the old retry
// budget) never gets anywhere near a 10-block requirement.
function fetchRawLogTransfers() {
  var CHUNK_SIZE = BigInt(15000);
  var knownCap = null; // learned from a provider's rejection message, once

  function parseCapFromError(err) {
    var msg = (err && err.message) || String(err);
    var m = /up to a?n? ?(\d+) block/i.exec(msg);
    return m ? BigInt(m[1]) : null;
  }

  function fetchWindow(fromB, toB) {
    return client.getLogs({
      address: config.address,
      event: TRANSFER_EVENT,
      fromBlock: fromB,
      toBlock: toB
    });
  }

  // Splits [fromB, toB] into consecutive windows of at most capSize blocks
  // and fetches them with modest concurrency — once a provider has told us
  // its real ceiling, requests below it are cheap and reliable, so more of
  // them in flight at once is what keeps a ~70k-block history from taking
  // many minutes on a fresh page load.
  function fetchInFixedWindows(fromB, toB, capSize) {
    var windows = [];
    for (var start = fromB; start <= toB; start += capSize) {
      var end = start + capSize - BigInt(1);
      if (end > toB) end = toB;
      windows.push([start, end]);
    }
    var CONCURRENCY = 10;
    var results = [];
    var i = 0;
    function next() {
      if (i >= windows.length) return Promise.resolve();
      var idx = i++;
      return fetchWindow(windows[idx][0], windows[idx][1]).catch(function (err) {
        console.warn("ViemBlockchainAdapter: giving up on block range " + windows[idx][0] + "-" + windows[idx][1] + ":", err);
        return [];
      }).then(function (logs) {
        results[idx] = logs;
        return next();
      });
    }
    var workers = [];
    for (var w = 0; w < CONCURRENCY && w < windows.length; w++) workers.push(next());
    return Promise.all(workers).then(function () { return [].concat.apply([], results); });
  }

  function fetchRange(fromB, toB, attemptsLeft) {
    if (knownCap !== null && (toB - fromB + BigInt(1)) > knownCap) {
      return fetchInFixedWindows(fromB, toB, knownCap);
    }
    return fetchWindow(fromB, toB).catch(function (err) {
      var cap = parseCapFromError(err);
      if (cap !== null) {
        knownCap = knownCap === null ? cap : (cap < knownCap ? cap : knownCap);
        return fetchInFixedWindows(fromB, toB, knownCap);
      }
      if (attemptsLeft <= 0 || toB <= fromB) {
        console.warn("ViemBlockchainAdapter: giving up on block range " + fromB + "-" + toB + " after retries:", err);
        return [];
      }
      // Unrecognized error shape — fall back to bisection as a safety net.
      var mid = fromB + (toB - fromB) / BigInt(2);
      return Promise.all([
        fetchRange(fromB, mid, attemptsLeft - 1),
        fetchRange(mid + BigInt(1), toB, attemptsLeft - 1)
      ]).then(function (parts) { return parts[0].concat(parts[1]); });
    });
  }

  return client.getBlockNumber().then(function (latest) {
    var fromBlock = BigInt(config.deployBlock || 0);
    var ranges = [];
    for (var start = fromBlock; start <= latest; start += CHUNK_SIZE) {
      var end = start + CHUNK_SIZE - BigInt(1);
      if (end > latest) end = latest;
      ranges.push([start, end]);
    }
    // Sequential across top-level chunks — gentle by default; the
    // concurrency bump only kicks in once fetchInFixedWindows takes over.
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
    return next().then(function () { return [].concat.apply([], results); });
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
      return logs.map(function (log) {
        var ts = timestamps[log.blockNumber.toString()];
        return {
          tokenId: log.args.tokenId.toString(),
          from: log.args.from,
          to: log.args.to,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          date: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null
        };
      });
    });
  });
}

ViemBlockchainAdapter.prototype._buildIndex = function () {
  var self = this;
  if (!TRANSFER_EVENT) {
    console.warn("ViemBlockchainAdapter: no Transfer event in CONTRACT_CONFIG.abi");
    return Promise.resolve();
  }

  var alchemyBase = getAlchemyRestBase();
  var transfersPromise = alchemyBase
    ? fetchAlchemyTransfers(alchemyBase).catch(function (err) {
        console.warn("ViemBlockchainAdapter: alchemy_getAssetTransfers failed, falling back to a raw eth_getLogs scan:", err);
        return fetchRawLogTransfers();
      })
    : fetchRawLogTransfers();

  return transfersPromise.then(function (transfers) {
    transfers.forEach(function (tr) {
      var rec = self.index[tr.tokenId] || (self.index[tr.tokenId] = { transferHistory: [] });
      rec.transferHistory.push(tr);
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

// Picks out an Alchemy JSON-RPC URL from the configured provider list, if
// any, so getTokensOwnedBy can hit Alchemy's NFT REST API directly rather
// than depending on the (much more fragile, provider-dependent) manual
// Transfer-log scan below. Alchemy's REST endpoints are built and
// documented for exactly this — being called straight from a browser
// frontend — unlike raw eth_getLogs, which is where every failure in this
// site's history has come from (auth walls, missing CORS headers, archive
// restrictions on free tiers, etc. — see contract-config.js).
function getAlchemyRestBase() {
  var url = (config.rpcUrls || []).filter(function (u) { return u.indexOf("g.alchemy.com") !== -1; })[0];
  return url || null;
}

ViemBlockchainAdapter.prototype.getTokensOwnedBy = function (address) {
  var self = this;
  if (!address) return Promise.resolve([]);
  var addr = String(address).toLowerCase();

  function fromTransferLogIndex() {
    return self.ready.then(function () {
      var out = [];
      Object.keys(self.index).forEach(function (tokenId) {
        var rec = self.index[tokenId];
        if (rec.owner && String(rec.owner).toLowerCase() === addr && !rec.burned) out.push(Number(tokenId));
      });
      out.sort(function (a, b) { return a - b; });
      return out;
    });
  }

  var alchemyBase = getAlchemyRestBase();
  if (!alchemyBase) return fromTransferLogIndex();

  var url = alchemyBase + "/getNFTs/?owner=" + encodeURIComponent(address) + "&contractAddresses[]=" + encodeURIComponent(config.address);
  return fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error("Alchemy getNFTs responded with " + res.status);
      return res.json();
    })
    .then(function (data) {
      var out = (data.ownedNfts || []).map(function (nft) { return Number(nft.id.tokenId); });
      out.sort(function (a, b) { return a - b; });
      return out;
    })
    .catch(function (err) {
      console.warn("ViemBlockchainAdapter: Alchemy getNFTs failed, falling back to the transfer-log index:", err);
      return fromTransferLogIndex();
    });
};

// Powers the Dominion page. Reuses the same in-memory transfer-log index
// everything else on the site already relies on — no extra RPC calls —
// aggregated per current owner and sorted highest-holding first. Burned
// tokens don't count toward anyone's total.
ViemBlockchainAdapter.prototype.getHoldingsLeaderboard = function () {
  var self = this;
  return this.ready.then(function () {
    var counts = {};
    Object.keys(self.index).forEach(function (tokenId) {
      var rec = self.index[tokenId];
      if (!rec.owner || rec.burned) return;
      var addr = rec.owner.toLowerCase();
      counts[addr] = (counts[addr] || 0) + 1;
    });
    var list = Object.keys(counts).map(function (address) { return { address: address, count: counts[address] }; });
    list.sort(function (a, b) { return b.count - a.count; });
    return list;
  });
};

// Best-effort reverse ENS lookup for display purposes only (Dominion page
// wallet names) — resolves to null, never throws, if there isn't one or
// the lookup fails for any reason (unsupported RPC method, network
// hiccup, etc.), and callers are expected to fall back to the shortened
// address exactly as if this returned null normally.
ViemBlockchainAdapter.prototype.getEnsName = function (address) {
  if (!ensClient || !address) return Promise.resolve(null);
  var key = String(address).toLowerCase();
  if (this.ensCache[key] !== undefined) return Promise.resolve(this.ensCache[key]);
  var self = this;
  var p = ensClient.getEnsName({ address: address }).then(function (name) {
    self.ensCache[key] = name || null;
    return self.ensCache[key];
  }).catch(function () {
    self.ensCache[key] = null;
    return null;
  });
  this.ensCache[key] = p; // cache the in-flight promise too, so concurrent callers share one lookup
  return p;
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
      var imageCandidates = json.image ? resolveContentUriCandidates(json.image) : [];
      var image = imageCandidates.length ? imageCandidates[0] : null;
      var out = image ? { image: image, imageCandidates: imageCandidates, name: json.name || null, attributes: json.attributes || [] } : null;
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
