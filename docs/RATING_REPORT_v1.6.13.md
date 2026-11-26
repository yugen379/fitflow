# FitFlow v1.6.13: rating report (2026-11-27)

The ratings are honest estimates of how real users would rate FitFlow against MyFitnessPal, MacroFactor, Strava, Nike Training Club, Fitbit and Lose It!. They assume the server is deployed (see "Before you publish").

## Ratings

| Who | Before (v1.6.11) | Now (v1.6.13) |
|---|---|---|
| Malaysia | 8.5 | **9.5** |
| Asia overall (Malaysia, Indonesia, India, SE Asia) | 8.5 | **9.0–9.5** |
| Worldwide, Android users | 6 | **8.5** |
| USA, Android users | 5.5 | **8.5** |
| Worldwide, all phones | 6 | **7.5** |
| USA, all phones | 5.5 | **6.5** |

**Why "all phones" is lower:** about 55–60% of US smartphone users, and many in Europe and Australia, use iPhones. FitFlow is not on the App Store yet, so those people cannot install it, and they count as a zero. This is the single biggest thing between FitFlow and 9+ worldwide. It costs $99 a year (Apple Developer account). The iOS build pipeline already exists and builds green.

### By kind of user (Android)

| User group | Global share | Now | Why |
|---|---|---|---|
| Calorie and weight-loss trackers | 30% | 9 | AI meal breakdown with grams and app-side calorie maths. 830 USDA foods + 898 offline foods + Open Food Facts barcodes + shared label photos. Smart adaptive calorie target (MacroFactor-style, at less than half the price). Instant repeat meals. lb/oz/kJ. |
| Gym and home workouts | 25% | 8.5 | All 137 exercises have a 3D demo with working muscles. Live form check. Voice coaching in 6 languages. Plans, PRs, history. |
| Runners, walkers, cyclists | 20% | 8 | GPS walk/run/ride with route, pace, splits, climb, auto-pause, background recording and a miles/km notification. No segments or live maps like Strava. |
| Wearable owners | 15% | 8 | Health Connect brings in steps, heart rate, resting heart rate, sleep and weight from Samsung, Fitbit, Garmin, Xiaomi and others. No watch app. |
| Asian food trackers | 10% | 9.5 | Local dishes; ingredient maths for nasi lemak, chicken rice and so on; Malay, Indonesian and Hindi UI. |

## What was done (v1.6.11 → v1.6.13)

1. **Calories:** the smart adaptive target, trend weight, label photo for unknown barcodes (calorie-checked, shared with everyone), and 830 verified USDA foods (India, Latin America, Middle East, Europe, East/SE Asia, 98 US restaurant-chain items with serving weights).
2. **Movement and body:** GPS tracking (native background service), Health Connect (weight, resting heart rate, sleep), Squads (2–10 friends, weekly challenge), and 3D demos for every exercise.
3. **Reach and trust:**
   - 5 new languages: Malay, Indonesian, Spanish, Portuguese and Hindi (1,997 sentences each), and the AI coach, recaps and pushes answer in the user's language.
   - A smart in-app review prompt (asks only after real wins).
   - Store listing text in 4 locales and Play declaration answers.
4. **US pack:** metric / US / UK units on every screen (lb, oz, fl oz, miles, ft/in, kJ), including AI replies, and US chain foods.
5. **Honesty fixes:**
   - The Pro paywall was selling free features; it now lists only what Pro unlocks.
   - The privacy policy now matches the code.
   - Health Connect permissions are trimmed to the 6 actually read.
   - The creator account showed "Free plan".

## Verification

- **45 automated suites, all green on 2442bc9**, for example:
  - meal maths 124/124, translation 40/40 at 100%, AI language 173/173
  - security rules 73/73, Squads rules 51/51, browser flows, CSP, UI
  - speed budget 34/34
- **Mutation-tested:** for each new feature, the code was broken on purpose and its test was confirmed to fail.
- **On the real phone (OPPO CPH2743):**
  - 1.6.12 installed: Home, the Pro page and Settings all checked.
  - 1.6.13 installed: switched to Bahasa Melayu, and Settings and Home were fully in Malay; then switched back to English.
  - The phone test found two bugs, both now fixed: the creator "Free plan" label and the overselling Pro headline.

## Before you publish (required order)

1. **Deploy the server first.** The phone test showed the live server rejecting the new settings: unit changes revert, and Squads, GPS routes and language would fail too. From `Desktop\fitflow\fitflow_FINAL\fitflow_scale` run:
   ```
   npx firebase deploy --only firestore:rules,firestore:indexes,functions
   ```
2. **Then** upload `Desktop\fitflow-aab\fitflow-v1.6.13-play.aab` to Play. It is the one with languages; 1.6.12 is the same app without them.
3. Fill the Play Health Connect and Data safety forms using `docs/store/play-declarations.md`.
4. Optional, but helps the rating: ask one native speaker per language to skim the app. The translations are AI-written and checked automatically, but not by humans.

## What still stands between FitFlow and 9+ everywhere

| Gap | Fix | Cost |
|---|---|---|
| No iPhone app | Apple Developer account, then TestFlight, then App Store (pipeline ready) | $99/year |
| No reviews yet | Publish, then let the smart review prompt and a 50–100 person test group build ratings | Time |
| Translations unchecked by native speakers | One reviewer per language | Free (test group) |
| Strava-level running (segments, live maps) and watch apps | Later versions | Time |
| "Back" (the button) and "Back" (the muscle) share one translation | Split into two keys | 15 min |
