# Kindoku (React + TypeScript)

Vite + React + TypeScript scaffold of Kindoku. This is step 1 of an incremental
migration from the original vanilla JS/HTML/CSS version.

## What's converted

- Project scaffold (Vite, TypeScript, build config)
- Shared types (`src/types.ts`) matching exactly what `api/recommend.js` returns
- Particle background + ink blobs (`src/components/Background.tsx`)
- Nav with install-prompt logic (`src/components/Nav.tsx`, `src/hooks/useInstallPrompt.ts`)
- Footer (`src/components/Footer.tsx`)
- **Landing view — fully converted** (`src/components/views/LandingView.tsx`)
- App shell with view routing via React state, mirroring the original
  `switchView()` pattern (`src/App.tsx`)

## What's still a placeholder

Search, Discover, and Results views currently render `PlaceholderView` — the
app runs end-to-end, you can click Search/Discover from Landing and see a
stub, but the real forms/logic haven't been ported yet. These (plus the
in-app reader overlay) are next.

## Not touched

`api/recommend.js` is copied over completely unchanged — it's a Vercel
serverless function, it doesn't care what frontend calls it. No TypeScript
conversion needed there yet either; if you want it typed later that's a
separate, easy step (rename to `.ts`, add types, Vercel handles `.ts`
functions natively).

## Running locally

You need two things running at once, since the frontend and the API are
separate concerns:

```bash
npm install

# Terminal 1 — serves api/recommend.js on port 3000
npx vercel dev

# Terminal 2 — serves the React app, proxies /api to port 3000
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Known follow-up items

- `public/sw.js` was ported as-is but its precache list hardcodes filenames
  that won't match Vite's hashed build output. See the comment at the top of
  that file for two ways to fix it (swap in `vite-plugin-pwa`, or drop the
  static list and rely on the runtime cache-as-you-go logic that's already
  in there). Not a blocker for local dev.
- You'll need the actual icon/favicon image files
  (`favicon.ico`, `icon-192.png`, `icon-512.png`, etc.) copied into `public/`
  — those weren't available to port automatically since only your CSS/HTML/JS
  source, not the binary image assets, were part of this conversation.
