# Mentographs — The Field

The live site for the Mentographs collection: an interactive, drag-and-zoom
"Field" of all 222 pieces, plus an About page, a full Gallery grid, and a
Connect Wallet button so people can find what they minted.

No build step. No server. No framework. It's plain HTML/CSS/JS — open
`index.html` directly, or serve the folder as-is on GitHub Pages / Vercel /
Netlify / literally anywhere that can host static files.

## What's in this folder

- `index.html` — everything: the Field, the detail panel, About, Gallery,
  Connect Wallet. All the artwork data (titles, descriptions, regions) for
  all 222 tokens is embedded directly in this file.
- `contract-config.js` — the deployed contract's address, chain, a couple
  of public RPC URLs, and the (trimmed) ABI. **This is the one file you'd
  ever touch** if the contract address ever changes.
- `blockchain-adapter.js` — defines the shared interface both adapters
  below implement, so the rest of the site never has to know which one is
  currently active.
- `mock-blockchain-adapter.js` — a placeholder adapter used for local
  file:// preview (double-clicking `index.html`) and as the safe default
  for the first instant a page load happens, before the real adapter has
  loaded. Every token reads as "not yet minted" — it never invents fake
  owners.
- `viem-blockchain-adapter.js` — the real adapter. Reads ownership,
  transfer history, and revealed artwork straight from Ethereum mainnet
  using public RPC endpoints, via [viem](https://viem.sh) loaded from a
  CDN (`esm.sh`) — no `npm install`, no bundler. This is an ES module, so
  browsers only load it when the page is served over `http(s)://`, not
  `file://`.
- `pre-reveal.gif` — the shared placeholder every fragment shows before
  it's individually minted and revealed (see below).
- `artist-photo.jpg` — the gallery installation photo used in the About
  section.

## How images actually work (read this)

You mentioned having all 217+ real Mentograph images but not in the right
token order — **you don't need to sort them.** Here's why:

Once a token is minted, its `tokenURI(tokenId)` on the contract resolves to
a metadata file (JSON) that has an `image` field — and that mapping is
controlled by OpenSea Studio's Upload/Reveal flow, not by this website.
This site reads that live, per token, the moment someone opens it, with
three fallback tiers:

1. Someone clicks a fragment (in the Field or the Gallery).
2. The site calls `tokenURI(tokenId)` on the real contract.
3. If it resolves (token is minted **and** revealed), the site fetches that
   metadata JSON, pulls out the `image` field, and shows the real artwork.
4. If it doesn't resolve yet (not minted, or minted but not yet revealed),
   the site shows `pre-reveal.gif` instead — the same shared placeholder
   for every single fragment, exactly like a typical pre-reveal drop.
5. If even that fails to load (e.g. the file's missing during local
   preview), it falls back one more level to the abstract, DNA-driven
   rendering — never a broken image, never a gray box.

So: right now, every fragment shows `pre-reveal.gif`. After people start
minting, tokens show real art automatically **as soon as you hit Reveal in
OpenSea Studio, per token** — nothing about this site needs to change or
be redeployed when that happens. A token that's minted but not yet
revealed keeps showing the GIF, correctly, until it specifically is.

If you ever do want local images to show up for local `file://` preview
specifically (never affects the live deployed site), drop files into this
same folder named `1.png`, `2.png`, `3.jpg`, etc. (matching each file's
number to how the code currently orders your images — see the
`EMBEDDED_IMAGE_FILES` comment near the top of `index.html`'s script).
This is optional and only cosmetic for local preview; it's not how the
real site sources art.

## Deploying: GitHub + Vercel

1. **Create a GitHub repo** (on github.com: New repository → give it a
   name like `mentographs-site` → Create).
2. **Push this folder to it.** From inside this folder:
   ```
   git init
   git add .
   git commit -m "Mentographs site"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. **Import it on Vercel:**
   - Go to vercel.com → Add New → Project → Import your GitHub repo.
   - Framework preset: choose **"Other"** (this is a static site, no build
     command needed).
   - Leave Build Command and Output Directory blank, or if Vercel insists
     on a value, set Output Directory to `.` (this folder).
   - Deploy. You'll get a `your-project.vercel.app` URL immediately.
4. Optional: add a custom domain in Vercel's project settings once you
   have one.

Every time you `git push` again, Vercel redeploys automatically.

## Testing locally before you push

Double-clicking `index.html` works, but shows placeholder (unminted) data
for everything, because browsers block ES modules — and therefore the
real chain adapter — under `file://`. To preview it exactly as it'll
behave live:

```
cd this-folder
python3 -m http.server 8000
```

Then open `http://localhost:8000` — this runs the real
`viem-blockchain-adapter.js` against the live contract, same as
production.

## What to double check on mint day

- Nothing needs to be redeployed for minting itself to show up — the "X /
  222 minted" counter and each fragment's owner/mint date update live,
  automatically, straight from the contract.
- When you're ready for real artwork to appear, hit **Reveal** in OpenSea
  Studio. The site picks it up automatically, per token, the next time
  each one is viewed — no redeploy needed here either.
- If you ever change the contract's base URI, mint stages, or (not
  expected, but just in case) deploy a *different* contract, the only file
  you'd need to touch is `contract-config.js`.

## Optional assets you can drop in (not required)

- `trait-chart.png` — if you save an image with this exact name next to
  `index.html`, it appears automatically in the About section. If it's
  missing, that slot just stays hidden — nothing breaks.
- `wtf-source.jpg` — the original hand-made "Source" image referenced by
  the code. If it's not present, the Source's detail view falls back to
  its abstract particle rendering, which already looks intentional on its
  own — this is optional polish, not a requirement.
