# Cold-start performance — scope record

Measure before changing anything:

```bash
npm run build
npm run perf            # 4x CPU throttle, ~1.6 Mbps, cold cache, gzip
npm run perf -- --fast  # unthrottled
npm run perf -- --json  # machine-readable, for before/after diffs
npm run proof:perf      # 30 assertions — the regression gate (run after build)
```

`proof:perf` is the thing that keeps this from rotting. It asserts the *shape*
of the build, because every regression here was invisible at runtime: the app
worked perfectly, it was just slow. It fails the build if the entry chunk ever
statically imports Firestore, Sentry, recharts, Redux, three.js, motion, the
Gemini SDK or the QR scanner; if the HTML stops painting without JS; if fonts go
back to blocking; if prefetching ever duplicates a route chunk; or if a
signed-out boot starts downloading Firestore again.

`scripts/perf-probe.mjs` serves `dist/` gzipped (every real host does; serving it
raw inflates every timing ~3x), blocks third-party origins so the number measures
our bundle, and reports FCP, LCP, load and the gzipped wire size.

---

## Results

Same harness, same machine, throttled mid-range Android:

| Metric | Before | After | Change |
|---|---|---|---|
| First Contentful Paint | 5,816 ms | 1,316 ms | **4.4x faster** |
| Largest Contentful Paint | 5,816 ms | 1,316 ms | **4.4x faster** |
| load event | 4,749 ms | 2,048 ms | 2.3x faster |
| JS transferred | 641 kB | 171 kB | **3.8x less** |
| Requests | 16 | 12 | −4 |

Live, over the real network with real fonts and real Google widgets:

| Metric | Production (old) | Preview (new) |
|---|---|---|
| First Contentful Paint | 4,656 ms | 1,160 ms |
| Largest Contentful Paint | 6,992 ms | 1,160 ms |
| Hero visible | 6,228 ms | 1,713 ms |
| Sign-in button usable | 7,510 ms | 6,338 ms |

Live numbers vary run to run by several hundred milliseconds (third-party
widgets, CDN warmth); the local harness is the one to compare against between
changes because it holds everything else constant.

---

## What was actually wrong

### 1. The entire Sentry SDK was welded to the critical path (~165 kB gzipped)

`manualChunks` matched with `id.includes('react/')`. `@sentry/react/` contains
the substring `react/`, so every Sentry module — including 257 kB of session
replay — was assigned to the `react` chunk, which the entry statically imports.

`lib/telemetry.ts` only ever imports Sentry *dynamically*, and only when
`VITE_SENTRY_DSN` is set. So on a build with no DSN this was ~165 kB gzipped of
code that downloaded and parsed on every cold start and then never executed.

Chunk rules now match on a real package boundary (`packageOf`), never substrings.

### 2. `clsx` dragged 377 kB of recharts onto the login screen

`clsx` is ~500 bytes, used by `lib/utils.ts` and also by recharts. It had no
chunk assignment, so Rollup was free to file it wherever it liked — and it chose
the `charts` chunk. The entry needed `cn()`, so it statically imported `charts`,
which pulled recharts *and* (because recharts 3.x uses Redux internally) the
`redux` chunk. Neither is used by anything on the boot path.

Small utilities shared between app code and heavyweight vendor libraries are now
pinned explicitly (`SHARED_RUNTIME`). The same bug had a second instance:
`@capacitor/core` was filed inside the App Check chunk.

### 3. Nothing could paint until Firebase finished downloading

`main.tsx` → `App` → `useAuth` → `lib/firebase` was a fully static chain, so the
browser had to fetch and parse ~1.5 MB before the first pixel.

`index.html` now carries an inline, inline-styled splash — real branding, no
webfont, no JS. It paints on the first response; `main.tsx` fades it out once
React commits.

### 4. Boot-path imports that nothing on the boot path needed

| Removed from critical path | Cost | How |
|---|---|---|
| `@sentry/*` | ~165 kB gz | chunk rule fix |
| `recharts` + `redux` | ~130 kB gz | chunk rule fix |
| `firebase/messaging` | ~25 kB gz | lazy; also stopped running `isSupported()` during boot |
| `firebase/app-check` | ~19 kB gz | lazy, loaded only after the site-key check |
| `@google/genai` | ~16 kB gz | `lib/authToken.ts` broke the `firebase.ts → geminiService` edge |
| `motion` | ~42 kB gz | login hero and skeletons use CSS keyframes; toast viewport is lazy |
| `lucide-react` | ~9 kB gz | followed `motion` off the path |
| `pages/Onboarding` | chunk | lazy — it renders only for incomplete profiles |

`components/ToastViewport.tsx` exists purely so the toast provider — mounted at
the app root — does not statically import the animation library for a component
that by definition is not on screen at boot. Enter *and* exit animations are
unchanged.

### 5. Fonts blocked the render tree

The Google Fonts stylesheet was a plain `<link rel="stylesheet">` to a
third-party origin, so first paint waited on someone else's DNS, TLS and
response. It now loads as `media="print"` and flips to `all` on load, with a
`<noscript>` fallback. `font-display: swap` was already in the URL.

---

## Preloading

`src/lib/prefetch.ts`. Three rules:

1. **Never compete with the first paint.** Warming waits for auth to resolve and
   then for `requestIdleCallback`, one chunk at a time.
2. **Respect the connection.** Save-Data, 2g and slow-2g get nothing
   speculative.
3. **Heavy routes need intent.** The 3D Lab pulls ~120 kB of three.js and is
   fetched only when a pointer lands on its entry card — never on a hunch.

Wired into the bottom nav (`pointerenter` / `pointerdown` / `focus` per tab), the
Workout screen's Lab card, and an idle warm of the five bottom-nav destinations
after sign-in.

The import specifiers in `prefetch.ts` must stay byte-identical to the ones in
`App.tsx` — that string is what Vite matches to decide they are the same chunk.
Verified: one chunk per page, no duplicates.

---

## Google Identity: the trade that had to be re-made

GSI was a `<script async defer>` in `index.html`: every cold start, including
every already-signed-in one, paid for a third-party connection, ~80 kB and script
execution during boot.

Moving it to load on demand fixed that but made the sign-in button **440 ms
later** — GSI needs three chained round trips (client → style → button iframe)
and now started only after auth resolved. Paint got faster; the only actionable
control on the login screen got slower. `preconnect` alone did not recover it,
because the bottleneck was when the chain *started*, not the handshake.

`lib/gsi.ts` resolves it: start GSI at boot, but only when
`localStorage` has no `firebase:authUser:*` key — a cheap synchronous signal that
the user is probably signed out, available long before the auth SDK has loaded.
Signed-out users get GSI warming from the first frame; signed-in users never
download it at all.

---

## Firestore: the 80 kB that used to boot with everyone

`firebase/firestore` is the heaviest dependency in the app and it used to load on
every cold start, including the signed-out ones that never query anything. Two
things pinned it there:

1. `lib/firebase.ts` created `db` at module scope, so *anything* that imported
   auth also imported Firestore.
2. A module-scope `testConnection()` fired `getDocFromServer(doc(db, 'test',
   'connection'))` on every boot — a real network round trip whose only effect
   was a `console.error` hint on failure. Deleted; `handleFirestoreError` already
   reports connectivity problems on the paths that matter.

`db` now lives in `lib/firestore.ts`, which `lib/firebase.ts` never imports
statically. The 29 modules that use `db` import it from there instead; all of
them are inside lazy route chunks, so they pull Firestore when their route loads,
which is correct. The two that sit on the boot path — `hooks/useAuth.tsx` and
`lib/pushPermission.ts` — use `await import()` at the point of use.

**The deferral had to not punish returning users.** Left purely on demand, a
signed-in user would serialise: download auth → resolve the user → *then* start
downloading Firestore. So `warmDataLayer()` in `lib/prefetch.ts` kicks the fetch
off from the first frame, gated on `hasPersistedAuthSession()` — a synchronous
localStorage probe for Firebase's `firebase:authUser:*` key, available long
before the SDK has loaded. Signed-out users still download nothing; signed-in
users have it in hand before `useAuth` asks.

The same probe drives the Google sign-in widget in the opposite direction
(`lib/gsi.ts`). The two are mutually exclusive in practice: whichever kind of
user you are, you warm the thing you are about to need and never the other.

### Safety

`useAuth` now `await`s inside the `onAuthStateChanged` callback, which introduces
two races that did not exist before. Both are handled explicitly:

- **Stale listener.** A `generation` counter is bumped on every auth event; a
  listener whose generation is no longer current is discarded rather than
  attached.
- **Unmount during import.** A `disposed` flag is checked after the await, and
  any listener that did attach is torn down immediately.

The invariant that matters for correctness is unchanged: `loading` stays `true`
until the profile snapshot resolves, so `ProtectedRoute` never evaluates
`isProfileIncomplete` against a null profile. That is what stops a returning user
from seeing a flash of the onboarding flow.

`proof:perf` Part D verifies both boot paths in a real browser: a signed-out boot
must never request the Firestore chunk, a seeded persisted session must request
it from the first frame, and neither may throw.

## Still on the table

Nothing large. The remaining critical-path JS is React, React DOM, Firebase
core + auth, the router and Capacitor's runtime — all genuinely needed before the
app can decide what to show. The slowest thing on the sign-in screen is now the
Google Identity widget's own chained requests, which is third-party.
