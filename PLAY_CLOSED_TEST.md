# FitFlow — Closed Test Kit (the 12-testers × 14-days gate)

Google requires **new personal developer accounts** to run a **closed test with ≥12 testers
who stay opted in for 14 consecutive days** before you can apply for production access.

**Key rules (don't lose 14 days to a mistake):**
- Testers must be **12+ distinct, real Google accounts** (Gmail or any Google-account email).
- They must **opt in** (via your test link) **and keep the app effectively installed**. Google
  counts "opted-in testers," so they should not leave the test for the 14 days.
- The **14-day clock** is continuous. If you drop below 12 opted-in testers, it can reset/stall.
- You (the developer account email) **can't count yourself** — recruit 12 *others*.

---

## 1) Tester list — fill in 12+ real Google-account emails

Easiest path = make a **Google Group** and add these, then attach the group to the track.
(You can also paste emails directly into the Play track, but a Group is reusable + cleaner.)

| #  | Tester name | Google account email | Source | Opted in? |
|----|-------------|----------------------|--------|-----------|
| 1  |             |                      |        | ☐ |
| 2  |             |                      |        | ☐ |
| 3  |             |                      |        | ☐ |
| 4  |             |                      |        | ☐ |
| 5  |             |                      |        | ☐ |
| 6  |             |                      |        | ☐ |
| 7  |             |                      |        | ☐ |
| 8  |             |                      |        | ☐ |
| 9  |             |                      |        | ☐ |
| 10 |             |                      |        | ☐ |
| 11 |             |                      |        | ☐ |
| 12 |             |                      |        | ☐ |
| 13 |             |                      |        | ☐ (spare — aim for 14+ so a dropout doesn't break the count) |
| 14 |             |                      |        | ☐ (spare) |

### Where to find 12 testers
- **Friends & family** with Android phones (most reliable — they'll actually keep it installed).
- **Your own secondary Google accounts** — allowed, but each must be a real, separate account
  on a real device or emulator that stays opted in. Don't rely only on these.
- **Tester-exchange communities** (mutual "I'll test yours if you test mine"):
  - Google Group: *"Closed Testing Google Play"* style groups
  - Reddit: r/androiddev, r/AndroidAppTesters
  - Discord/Telegram Play-testing exchange servers
  Be honest about the app and reciprocate.

---

## 2) Recruitment email — send this to candidates to ask them to join

> **Subject:** Quick favor — be a founding tester for my app FitFlow 🏋️
>
> Hi [Name],
>
> I'm launching **FitFlow**, an all-in-one AI fitness app (workouts, nutrition, recovery,
> and a coach that actually adapts to you). Before Google lets me publish it publicly, I need
> **12 testers for 14 days** — and I'd love for you to be one of them.
>
> **What it takes (≈2 minutes):**
> 1. Reply with the **Google account email** (Gmail) on your Android phone.
> 2. I'll send you a link — tap **Become a tester**, then **install FitFlow from Google Play**.
> 3. Just keep it installed for ~2 weeks and open it now and then. That's it.
>
> It's free, no payment, and you can leave after the test. Your feedback would mean a lot.
>
> Thanks so much,
> [Your name]

---

## 3) Opt-in email — send AFTER you've added testers and have the opt-in link

> **Subject:** You're in! Your FitFlow test link (1-tap to join) 🎉
>
> Hi [Name],
>
> Thanks for testing FitFlow! Here's how to get it (2 steps):
>
> 1. **On your Android phone**, tap this link and choose **"Become a tester"**:
>    👉 [PASTE YOUR OPT-IN LINK HERE]
> 2. Then tap **"Download it on Google Play"** and install like any normal app.
>
> *(If Play says the app isn't available, give it a few minutes after opting in, then refresh.)*
>
> Please keep FitFlow installed for the next **14 days** and open it a few times — that's what
> Google needs to see. Tell me anything that feels off; I read every message.
>
> 🙏 [Your name]
>
> **Sign in tip:** Use **Google sign-in** or email/password — both work.

---

## 4) Console steps (do these in order)

1. **Create the app** (you're on this screen): name `FitFlow`, package `com.fitflow.fitness`,
   English (US), App, Free → **Create app**.
2. **Testing → Closed testing** → manage the default **"Alpha"** track (or create one).
3. **Testers tab** → either:
   - **Create a Google Group** (e.g. `fitflow-testers@googlegroups.com`), add the 12+ emails
     above, then paste the group address here; **or**
   - choose **"Create email list"** and paste the emails directly.
4. **Releases tab** → **Create new release** → upload **`fitflow-v1.2.4.aab`** (from the
   GitHub v1.2.4 release) → roll out to the Closed track.
   ⚠️ **Do NOT upload v1.2.0–v1.2.3** — those builds crash instantly on open
   (`ClassNotFoundException: com.fitflow.app.MainActivity`, wrong package case in the dex).
   v1.2.4 is the first working build; verified clean on an API-34 emulator 2026-07-04.
5. Copy the **opt-in URL** ("How testers join") and send email #3 above.
6. Keep ≥12 opted in for **14 continuous days** → the **"Apply for production"** button unlocks.

---

## 5) Optional: pre-made Google Group setup
- Go to **groups.google.com → Create group**.
- Name: `FitFlow Testers`, email: `fitflow-testers@googlegroups.com` (or similar).
- Who can join: **Invited only**; add the 12+ tester emails as members.
- Back in Play Console, attach `fitflow-testers@googlegroups.com` to the Closed track.
- Reusable for every future test — you never re-type the list.
