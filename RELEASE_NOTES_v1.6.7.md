# FitFlow v1.6.7 (version code 31)

Three texts for three places. Everything below describes what is in the build;
nothing here is live until the release is pushed and the files are uploaded.

## Google Play — "What's new" (en-US, 458 of 500 characters)

```
Food logging got a lot better:
• Search 900 everyday foods offline, including Malaysian dishes, kuih and mamak drinks. Typos are fine.
• Search millions of packaged products by name, with one-tap serving sizes.
• "3 eggs" and "200g chicken" now log the right amount.
Also fixed: editing a community post, likes that could be faked, sheets cut off on small phones, a "can't reach your data" screen after a quick reload, and steps over-counting on some phones.
```

## Tester invite (WhatsApp / email)

```
Hi! I'm testing my fitness app, FitFlow, before it goes public on Google Play, and I need
12 people to keep it installed for 14 days. It tracks food, workouts and steps, with an AI coach.

1. Send me the Gmail address you use on your Android phone.
2. I'll add you, then send a link. Open it on the phone and tap "Become a tester".
3. Install FitFlow from the Play Store page that opens.
4. Use it however you like. Even opening it once a day helps. Please don't uninstall for 14 days.

It is free during the test. If anything looks wrong, a screenshot sent to me is the most
useful thing you can do. Things I'd especially like you to try:
• Search for what you actually eat (nasi lemak, teh tarik kurang manis, Milo...)
• Scan a barcode on something from your kitchen
• Check the step count against your phone's own counter at the end of a day
Thank you!
```

Add each Gmail address under Play Console → Testing → Closed testing → Testers.
The 14 days count from when the twelfth tester has opted in, and they must run
without a gap. See `PLAY_CLOSED_TEST.md`.

## GitHub release notes

### Food
- Offline search over 898 foods (was 88), with other names for the same food,
  typo tolerance, plurals and half-typed words. 665 foods added, most of them
  Malaysian: lauk by the scoop, rice and noodle plates, mamak and kopitiam
  breakfasts, kuih, drinks as ordered (kosong, kurang manis), local chains.
- Packaged products: searches Open Food Facts (3 million+) through a new
  `searchFoods` function that filters untrustworthy rows and caches answers.
  A product opens the entry sheet with an amount field and, when its pack
  states one, a one-tap serving.
- Amounts are honoured: "3 eggs", "two bananas", "200g chicken breast".
- The results list scrolls into view instead of opening behind the dock.

### Security
- Rules: profile creation, posts, comments, likes and the food catalog accept
  only what the app writes; names on posts must be the author's own.
- The free trial can no longer be restarted by re-creating a profile.
- Like and comment totals are recounted on the server, so they cannot be forged.
- A full Content-Security-Policy ships in Report-Only mode, reporting to Sentry.

### Fixes
- Editing a community post was refused by the rules. It works.
- A reload moments after signing in or saving could strand the app on
  "Can't reach your data". The profile is now re-requested automatically.
- Eight bottom sheets ran off the top of short screens (or with the keyboard
  open). They now stay on screen and scroll.
- The fonts no longer depend on an inline event handler.
- Today's Mission no longer shortens "Calories" to "C…" on narrow phones.
- Settings and Achievements paint their first screen before the rest.

### Build and release
- Release builds fail if `android/app/google-services.json` is missing.
  v1.6.5 and v1.6.6 were built without it and had no Google sign-in or push.
- `scripts/verify-android-artifact.mjs` inspects an APK or AAB before upload.
- New gates: `proof:flows`, `proof:foodsearch`, `proof:csp`, `test:rules:security`.

### Needs doing after the push
1. `node scripts/backfill-push-fields.mjs --dry`, then without `--dry`.
2. `node scripts/seed-catalog.mjs` to load the 872-food seed into production.
3. Grant `fitflow-play-publisher@gen-lang-client-0893216108.iam.gserviceaccount.com`
   "Release apps to testing tracks" in Play Console, or upload the AAB by hand.
