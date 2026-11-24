# FitFlow v1.6.10 (version code 34)

Everything below is what is in the build. Nothing is live until the release is
pushed (the tag deploys hosting, functions and rules) and the AAB is uploaded.

## Google Play — "What's new" (en-US, under 500 characters)

```
Big quality update from real-device testing:
• Edit or delete any logged meal.
• AI logging shows what it found before saving, and is much faster.
• Try the AI Coach free: 3 messages a day. It now knows what you ate today.
• Safer, more sensible macro targets.
• Back button no longer closes the app mid-workout.
• Level-up celebrations, clearer workout names, a shorter Home screen.
• Fixes: invisible fields in light mode, Pro status for some accounts.
```

## What changed (for the team)

From an on-device customer review on an OPPO CPH2743 (2026-11-24/25):

| Area | Fix |
|---|---|
| Nutrition safety | Macro targets are bounded: fat ≥ 20% of calories, protein ≤ 2.5 g/kg and ≤ 50% of calories; carbs absorb the difference. No carb floor (keto stays possible). Explicit workout/rest-day carbs are never rebalanced. A stored 90/5/5 split had produced 416 g protein / 10 g fat. |
| Android Back | `@capacitor/app` added. Back closes sheets, steps back through routes, then Home; it minimises (never kills) the app. During a workout it arms "Tap again to discard". |
| Meal log | Tap a logged meal to edit name/kcal/macros or delete it (two-tap confirm). Firestore rules already allowed both. |
| AI logging | Review list before anything is saved (remove items, edit text). Progress text while it works. Meal type from the clock instead of always "snack". 8 s app-side AI budget, then the offline food resolver answers. |
| Coach | Free users: 3 messages a day (server-enforced). Today's meals, totals and targets are sent with each question. Accuracy rules in the prompt. |
| Workouts | AI prose parsed into clean names + sets/reps; bodyweight and cardio moves open at 0 kg; readable type labels; "+N more" on the plan card; sessions saved with a real title. |
| Home | Order is Mission → Coach → Quick actions → Steps; streak message no longer repeated three times; coach protein target matches Fuel. |
| Level up | App-wide celebration (confetti + card) wherever the level is reached. |
| UI | `.btn-primary`/`.btn-ghost` self-contained (were square, unaligned boxes); dock hides while typing; portrait lock; light-mode Account info fields visible; kcal/plural labels. |
| Pro status | Creator unlock keys on the verified sign-in email, like the server (app said "trial ended" while the server still served Pro). |

## Server changes (need the deploy)

- `quickAdd` uses lite models first with a 6 s per-model cap (2.5-flash was returning 429 and flash-latest 503, making one log take ~25 s).
- Free coach allowance: `AI_FREE_COACH_PER_DAY` (default 3), `coach` counter in `users/{uid}/private/ai_usage`, 402 `coach_trial_used` when spent.
- Coach prompt accuracy rules.

## Gates

lint, build, check:legal, typecheck (app + functions), proof:review 32/32 (each probe has a control that fails with the fix reverted), proof:subscription, proof:csp, test:rules, test:rules:security, proof:backend, proof:flows, and the logic proofs (mission, briefing, badges, quickadd, coach, features, library, catalog, retention, engagement, steps, privacy, telemetry, offline, regressions, biomechanics).
