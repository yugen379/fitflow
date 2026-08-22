// Boot preloader proof harness.
//
//   npm run proof:preload
//
// Covers the two things a preloader can get catastrophically wrong:
//   Part A — PROGRESS: the bar is monotonic, clamped, weighted by real work,
//            and always finishes at exactly 100.
//   Part B — NEVER TRAPS THE USER: a task that rejects, hangs, or throws
//            synchronously cannot stall boot; the deadline always fires.
//   Part C — PLAN SHAPE: a signed-out visitor is never handed a Firestore task,
//            and a metered connection is never handed speculative route loads.
//
// Firebase-free and DOM-free, like the other harnesses — which is exactly why
// `runPreload` takes its tasks as an argument instead of building them itself.

const { runPreload, planIds, PRELOAD_DEADLINE_MS } = await import('../src/lib/preload.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

let passCount = 0, failCount = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passCount++; console.log(`  ${PASS} ${name}`); }
  else { failCount++; console.log(`  ${FAIL} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`); }
};

const task = (id, weight, run = () => Promise.resolve()) => ({ id, weight, run });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a plan and capture every progress value it reported. */
const capture = async (tasks, deadline) => {
  const seen = [];
  const result = await runPreload(tasks, (p) => seen.push(p.percent), deadline);
  return { seen, result };
};

// ─── Part A: progress ────────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part A — progress reporting${C.x}\n`);

{
  const { seen, result } = await capture([
    task('a', 1), task('b', 1), task('c', 1), task('d', 1),
  ]);

  check('progress ends at exactly 100', seen[seen.length - 1] === 100, `${seen[seen.length - 1]}`);
  check('progress never exceeds 100', seen.every((p) => p <= 100), `max ${Math.max(...seen)}`);
  check('progress never goes negative', seen.every((p) => p >= 0));
  check('progress is monotonic — a bar that jumps back reads as a bug',
    seen.every((p, i) => i === 0 || p >= seen[i - 1]), seen.join(','));
  check('every task is reported completed', result.completed.length === 4, `${result.completed.length}`);
  check('nothing failed', result.failed.length === 0);
  check('it did not time out', result.timedOut === false);
}

{
  // Weighting: the bar must spend its travel in proportion to real work, so a
  // heavy task cannot leave the user at 20% for most of the wait.
  const order = [];
  const { seen } = await capture([
    task('light', 1, async () => { await delay(10); order.push('light'); }),
    task('heavy', 9, async () => { await delay(40); order.push('heavy'); }),
  ]);
  const afterLight = seen[0];
  check('a weight-1 task among 10 total moves the bar ~10%', afterLight === 10, `${afterLight}`);
  check('the heavy task carries the rest', seen[seen.length - 1] === 100);
}

{
  const { seen, result } = await capture([]);
  check('an empty plan completes immediately at 100', seen.length === 1 && seen[0] === 100);
  check('an empty plan is not a timeout', result.timedOut === false);
}

{
  const { seen } = await capture([task('only', 3)]);
  check('a single task still reaches 100', seen[seen.length - 1] === 100);
}

// ─── Part B: it can never trap the user ──────────────────────────────────────
console.log(`\n${C.b}${C.c}Part B — never traps the user behind the splash${C.x}\n`);

{
  const { seen, result } = await capture([
    task('ok', 1),
    task('rejects', 1, () => Promise.reject(new Error('network down'))),
    task('ok2', 1),
  ]);
  check('a rejecting task does not stall the run', seen[seen.length - 1] === 100);
  check('the rejection is recorded, not swallowed silently',
    result.failed.includes('rejects'), result.failed.join(','));
  check('the other tasks still count as completed', result.completed.length === 2);
}

{
  const { seen, result } = await capture([
    task('throws', 1, () => { throw new Error('synchronous boom'); }),
    task('fine', 1),
  ]);
  check('a task that throws SYNCHRONOUSLY is contained', seen[seen.length - 1] === 100);
  check('the throwing task is marked failed', result.failed.includes('throws'));
}

{
  // The important one: a task that never settles must not hold the splash.
  const started = Date.now();
  const { seen, result } = await capture([
    task('hangs', 1, () => new Promise(() => {})),
    task('quick', 1),
  ], 300);
  const elapsed = Date.now() - started;

  check('a hanging task cannot hold boot open', elapsed < 1200, `${elapsed}ms`);
  check('the deadline is reported honestly', result.timedOut === true);
  check('the bar is still driven to 100 on timeout', seen[seen.length - 1] === 100);
  check('work that DID finish before the deadline is kept',
    result.completed.includes('quick'), result.completed.join(','));
}

{
  const { result } = await capture([task('slow', 1, () => delay(50))], 400);
  check('a plan that finishes early does not wait for the deadline',
    result.durationMs < 300, `${result.durationMs}ms`);
}

{
  check('the shipped deadline is bounded and sane',
    PRELOAD_DEADLINE_MS > 1000 && PRELOAD_DEADLINE_MS <= 10000, `${PRELOAD_DEADLINE_MS}ms`);
}

// ─── Part C: plan shape ──────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part C — plan shape${C.x}\n`);

{
  const signedOut = planIds({ hasSession: false, allowSpeculative: true });
  check('a SIGNED-OUT visitor is never given a Firestore task',
    !signedOut.includes('data'), signedOut.join(','));
  check('a signed-out visitor still gets the shell', signedOut.includes('shell'));
  // Every app page statically imports lib/firestore, so route preloading is
  // itself a Firestore download in disguise. perf-proof caught this.
  check('a signed-out visitor gets no route preloading either',
    !signedOut.includes('routes'), signedOut.join(','));

  const returning = planIds({ hasSession: true, allowSpeculative: true });
  check('a returning user preloads the data layer', returning.includes('data'));

  const metered = planIds({ hasSession: true, allowSpeculative: false });
  check('a metered connection gets no speculative route loads',
    !metered.includes('routes'), metered.join(','));
  check('a metered connection still preloads what it needs',
    metered.includes('shell') && metered.includes('data'));

  const minimal = planIds({ hasSession: false, allowSpeculative: false });
  check('the smallest plan is still non-empty', minimal.length >= 2, minimal.join(','));
}

// ─── Part D: fuzz ────────────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part D — fuzz${C.x}\n`);

{
  let seed = 20260822;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let throws = 0, bad = 0;

  for (let i = 0; i < 200; i++) {
    const count = Math.floor(rnd() * 6);
    const tasks = Array.from({ length: count }, (_, j) => {
      const roll = rnd();
      // Hostile weights included: zero, negative and absurd.
      const weight = roll < 0.2 ? 0 : roll < 0.3 ? -5 : Math.floor(rnd() * 9) + 1;
      const run =
        roll < 0.15 ? () => Promise.reject(new Error('x'))
        : roll < 0.2 ? () => { throw new Error('y'); }
        : () => delay(Math.floor(rnd() * 8));
      return task(`t${j}`, weight, run);
    });
    try {
      const seen = [];
      const result = await runPreload(tasks, (p) => seen.push(p.percent), 200);
      if (seen[seen.length - 1] !== 100) { bad++; continue; }
      if (seen.some((p) => p < 0 || p > 100 || !Number.isFinite(p))) { bad++; continue; }
      if (seen.some((p, k) => k > 0 && p < seen[k - 1])) { bad++; continue; }
      if (!Number.isFinite(result.durationMs)) { bad++; }
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} preload fuzz #${i} threw: ${error.message}`);
    }
  }
  check('200 hostile plans: zero throws', throws === 0, `${throws}`);
  check('200 hostile plans: always monotonic, clamped, and finished at 100',
    bad === 0, `${bad} violations`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passCount + failCount;
console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
if (failCount > 0) { console.log(`${C.r}${C.b}PROOF FAILED${C.x}`); process.exit(1); }
console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
