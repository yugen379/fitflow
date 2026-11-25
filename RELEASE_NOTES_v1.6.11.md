# FitFlow v1.6.11 (version code 35)

Nothing is live until the release is pushed (the tag deploys hosting, functions
and rules) and the AAB is uploaded. **The itemised meal pipeline needs the
functions deploy** (`decomposeMeal`); until then the app falls back to the
v1.6.10 per-serving review, so this build is safe to ship before or after it.

## Google Play — "What's new" (en-US, under 500 characters)

```
Calories you can check:
• Describe or photograph a meal and see every item with its grams.
• Calories are worked out from real nutrition data, not guessed by AI.
• Change any portion, add or remove items before saving.
• One tap for cooking oil: none, light or heavy.
• If part of the meal is hidden, add a few words and it checks again.
• Photos are now reviewed before logging, like typed meals.
```

## What changed (for the team)

| Stage | Change |
|---|---|
| 1. AI decomposition | New proxy action `decomposeMeal` (text: fast lite cascade; photo: accurate cascade). The model returns only `{ingredient_name, estimated_grams, confidence, method, per_100g}`; it is told not to total anything, and any calorie field it adds is discarded by `sanitizeDecomposition`. |
| 1. Deterministic math | `src/lib/mealMath.ts`: `(grams / 100) * per_100g`, summed only after each lookup. Lookup order: `src/data/ingredients100g.ts` (~120 per-100 g references incl. Malaysian staples) → bundled foods whose serving states grams → USDA FDC (per 100 g, 3 s budget, main word must match) → the model's generic density (labelled "estimate") → "not found" (user types the kcal). Shortened-name fallbacks match only exact names and never drop a food word ("chicken curry" can't become gravy). |
| 1. Review | Every row shows grams, kcal/100 g and its source; −/+ and typed grams recompute instantly; "Add item" (e.g. "egg 50g"); remove. Photos now go through the same review instead of logging straight away. Diary rows are named with grams ("white rice (225 g)"). |
| 2. Cooking oil | none / light / heavy, shown only when something was fried, stir-fried or saucy and its reference doesn't already include fat. light = 2.5 % of that food's weight (min 3 g), heavy = 7.5 % (min 8 g), cap 60 g, at 884 kcal/100 g; logged as its own row. Pre-set: ≥100 g fried → heavy, otherwise light. |
| 3. Low confidence | Ask once per meal for a 2–4 word hint when the model says the food is obscured, finds nothing, the grams-weighted plate confidence is < 0.5, or an item ≥ 50 g is < 0.35. The hint re-runs decomposition + lookup. |
| Fallbacks | Old server (no `decomposeMeal`) → the v1.6.10 quick-add parse; slow/failed AI → offline resolver without a second AI wait. |
| Boot speed | `LevelUpWatcher` is lazy again: v1.6.10 had put `motion` on the boot path (caught by proof:perf). |
| Test harness | The Firestore emulator is connected synchronously in `lib/firestore.ts`; a cold load straight into /community used to talk to PRODUCTION Firestore and fail the flows gate. proof:flows now fails if any request reaches a production Firebase host. |

## Tests

- `npm run proof:mealmath` — 69 unit tests: the formula, sum-after-lookup, AI totals ignored, sanitising, lookup (incl. the two live misses), oil amounts and double-count guard, hint rules, 3,000-case fuzz. Mutation-checked: each re-injected bug fails it.
- `npm run proof:flows` — new section drives the real UI with a fixed `decomposeMeal` answer: 260 + 98 + 35 oil = 393, +25 g rice → 426, oil none → 391, Firestore rows 293/98, hint retry → rendang 300 kcal, no oil choice.
- `npm run proof:mealpipeline` — live model check (not a gate). 4/4 meals itemised, e.g. nasi lemak = coconut rice 150 g + fried chicken 120 g + sambal + anchovies + peanuts + teh tarik = 1,082 kcal.

## Env vars / keys

No new ones. Uses the existing `GEMINI_API_KEY` secret (functions) and `VITE_USDA_API_KEY` (falls back to USDA's rate-limited `DEMO_KEY` if unset — set a real free key from api.data.gov for production volume).

## Gates

lint, build (+ secret scan), check:legal, typecheck app + functions, proof:mealmath 69/69, proof:review 32/32, quickadd, foodsearch, catalog, mission, briefing, badges, features, library, retention, engagement, steps, privacy, telemetry, offline, regressions, biomechanics, perf 30/30, subscription, test:rules, test:rules:security 34/34, proof:backend 159/159, proof:csp 12/12, proof:ui 24/24, proof:flows 39/39 (twice).
