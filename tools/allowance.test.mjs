// Unit tests for the credit-allowance period maths in page-aura.html (classic block id="aura-allowance").
// Spec: docs/credit-allowance.md. Run from anywhere:  node --test tools/allowance.test.mjs
// No installs: Node's built-in test runner. The block is read out of the HTML and evaluated with a fake `module`.
// The file pins TZ to Europe/London so the non-DST cases are the same on every machine. The DST suites switch
// process.env.TZ at runtime (Node re-reads the zone on assignment; the sanity tests prove it took effect).
// All expected times are built with local-time constructors, so they follow whatever zone is in force.
process.env.TZ = "Europe/London";

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPEN = '<script id="aura-allowance">';
const html = readFileSync(path.join(ROOT, "page-aura.html"), "utf8");
const openAt = html.indexOf(OPEN);
assert.notEqual(openAt, -1, `no ${OPEN} in page-aura.html`);
const from = openAt + OPEN.length;
const end = html.indexOf("</script>", from);
assert.notEqual(end, -1, "unterminated aura-allowance block");
const mod = { exports: {} };
new Function("module", html.slice(from, end))(mod);
const A = mod.exports;

const DAY = 864e5;
const HOUR = 36e5;

/* ---------- helpers ---------- */

/** Local time. Months are 1-based here (Nov = 11). */
const at = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();
const cfgMonth = (day, extra = {}) => ({ kind: "month", amount: 200, day, setAt: 0, ...extra });
const cfgWeek = (weekday, extra = {}) => ({ kind: "week", amount: 100, weekday, setAt: 0, ...extra });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `expected ${a} to be within ${eps} of ${b}`);
/** Checks a timestamp by its local calendar fields, so a failure message reads as a date. */
const eqLocal = (ts, y, mo, d, h = 0, mi = 0) => {
  const x = new Date(ts);
  assert.deepEqual([x.getFullYear(), x.getMonth() + 1, x.getDate(), x.getHours(), x.getMinutes()], [y, mo, d, h, mi]);
};
const fieldOf = (r) => (r.ok ? null : r.field);

/* ---------- normalize ---------- */

describe("normalize", () => {
  test("a balance with no kind is a one-off, keeping its amount and setAt", () => {
    const n = A.normalize({ amount: 150, setAt: at(2026, 11, 1) });
    assert.equal(n.kind, "once");
    assert.equal(n.amount, 150);
    assert.equal(n.setAt, at(2026, 11, 1));
  });

  test("an unknown kind is read as a one-off", () => {
    assert.equal(A.normalize({ kind: "year", amount: 10, setAt: 5 }).kind, "once");
  });

  test("a one-off with no setAt gets 0", () => {
    assert.equal(A.normalize({ kind: "once", amount: 10 }).setAt, 0);
  });

  test("a recurring balance gets adjust 0, askWhenOut true and periodStart/setAt 0 when missing", () => {
    const n = A.normalize({ kind: "month", amount: 200, day: 12 });
    assert.equal(n.adjust, 0);
    assert.equal(n.askWhenOut, true);
    assert.equal(n.periodStart, 0);
    assert.equal(n.setAt, 0);
    assert.equal(n.day, 12);
  });

  test("askWhenOut false is kept as false", () => {
    assert.equal(A.normalize({ kind: "week", amount: 5, weekday: 2, askWhenOut: false }).askWhenOut, false);
  });

  test("returns null for a missing object, a negative amount, a NaN amount or a missing amount", () => {
    assert.equal(A.normalize(null), null);
    assert.equal(A.normalize(undefined), null);
    assert.equal(A.normalize({ kind: "once", amount: -1 }), null);
    assert.equal(A.normalize({ kind: "month", amount: -0.01, day: 1 }), null);
    assert.equal(A.normalize({ kind: "once", amount: "abc" }), null);
    assert.equal(A.normalize({ kind: "month", amount: NaN, day: 1 }), null);
    assert.equal(A.normalize({ kind: "once" }), null);
  });

  test("a monthly balance needs a day from 1 to 31", () => {
    assert.equal(A.normalize({ kind: "month", amount: 1, day: 0 }), null);
    assert.equal(A.normalize({ kind: "month", amount: 1, day: 32 }), null);
    assert.equal(A.normalize({ kind: "month", amount: 1 }), null);
    assert.equal(A.normalize({ kind: "month", amount: 1, day: "soon" }), null);
    assert.equal(A.normalize({ kind: "month", amount: 1, day: 1 }).day, 1);
    assert.equal(A.normalize({ kind: "month", amount: 1, day: 31 }).day, 31);
  });

  test("a weekly balance needs a weekday from 0 (Sunday) to 6 (Saturday)", () => {
    assert.equal(A.normalize({ kind: "week", amount: 1, weekday: -1 }), null);
    assert.equal(A.normalize({ kind: "week", amount: 1, weekday: 7 }), null);
    assert.equal(A.normalize({ kind: "week", amount: 1 }), null);
    assert.equal(A.normalize({ kind: "week", amount: 1, weekday: 0 }).weekday, 0);
    assert.equal(A.normalize({ kind: "week", amount: 1, weekday: 6 }).weekday, 6);
  });

  test("a weekly balance with weekday null is rejected, not read as Sunday", () => {
    // Number(null) is 0, so the 0..6 check lets a missing weekday through as Sunday.
    assert.equal(A.normalize({ kind: "week", amount: 100, weekday: null }), null);
  });

  test("a weekly balance with weekday \"\" is rejected, not read as Sunday", () => {
    assert.equal(A.normalize({ kind: "week", amount: 100, weekday: "" }), null);
  });

  test("isRecurring is true only for month and week", () => {
    assert.equal(A.isRecurring({ kind: "month" }), true);
    assert.equal(A.isRecurring({ kind: "week" }), true);
    assert.equal(A.isRecurring({ kind: "once" }), false);
    assert.equal(A.isRecurring({}), false);
    assert.equal(A.isRecurring(null), false);
  });
});

/* ---------- monthly periods: the user's own case ($200 renewing on the 12th) ---------- */

describe("monthly, day 12 (the user's case)", () => {
  const c = cfgMonth(12);

  test("on 16 Nov 2026 the period started 12 Nov 00:00 and renews 12 Dec 00:00", () => {
    const now = at(2026, 11, 16, 15, 20);
    eqLocal(A.periodStart(c, now), 2026, 11, 12);
    eqLocal(A.nextRenewal(c, now), 2026, 12, 12);
  });

  test("exactly 12 Dec 00:00 a new period starts, and the next renewal is 12 Jan", () => {
    const now = at(2026, 12, 12);
    assert.equal(A.periodStart(c, now), now);
    eqLocal(A.nextRenewal(c, now), 2027, 1, 12);
  });

  test("at 11 Dec 23:59:59.999 the old period (from 12 Nov) is still current", () => {
    const now = at(2026, 12, 11, 23, 59, 59, 999);
    eqLocal(A.periodStart(c, now), 2026, 11, 12);
    eqLocal(A.nextRenewal(c, now), 2026, 12, 12);
  });

  test("exactly 12 Nov 00:00 starts the period, so the old one ends on 12 Nov", () => {
    const now = at(2026, 11, 12);
    assert.equal(A.periodStart(c, now), now);
    assert.equal(A.nextRenewal(c, now), at(2026, 12, 12));
  });

  test("on 11 Nov 23:59:59 the period started 12 Oct", () => {
    eqLocal(A.periodStart(c, at(2026, 11, 11, 23, 59, 59)), 2026, 10, 12);
  });

  test("year wrap: on 5 Jan 2027 the period started 12 Dec 2026", () => {
    const now = at(2027, 1, 5, 8);
    eqLocal(A.periodStart(c, now), 2026, 12, 12);
    eqLocal(A.nextRenewal(c, now), 2027, 1, 12);
  });

  test("year wrap: on 12 Dec 2026 exactly the period starts that day, not in the previous year", () => {
    eqLocal(A.periodStart(c, at(2026, 12, 12)), 2026, 12, 12);
  });
});

/* ---------- monthly periods: edge days ---------- */

describe("monthly: day 31 and short months", () => {
  const c = cfgMonth(31);

  test("in November (30 days) the period starts on 30 Nov and renews on the last day", () => {
    eqLocal(A.periodStart(c, at(2026, 11, 30, 12)), 2026, 11, 30);
    eqLocal(A.nextRenewal(c, at(2026, 11, 30, 12)), 2026, 12, 31);
  });

  test("on 29 Nov the period is the one that started 31 Oct", () => {
    eqLocal(A.periodStart(c, at(2026, 11, 29, 12)), 2026, 10, 31);
    eqLocal(A.nextRenewal(c, at(2026, 11, 29, 12)), 2026, 11, 30);
  });

  test("in April (30 days) the period starts 30 Apr; before that it started 31 Mar", () => {
    eqLocal(A.periodStart(c, at(2026, 4, 30, 9)), 2026, 4, 30);
    eqLocal(A.periodStart(c, at(2026, 4, 29, 23)), 2026, 3, 31);
    eqLocal(A.nextRenewal(c, at(2026, 4, 29, 23)), 2026, 4, 30);
    eqLocal(A.nextRenewal(c, at(2026, 4, 30, 9)), 2026, 5, 31);
  });

  test("February 2027 (28 days): the period starts 28 Feb; the renewal is 31 Mar", () => {
    eqLocal(A.periodStart(c, at(2027, 2, 28, 12)), 2027, 2, 28);
    eqLocal(A.nextRenewal(c, at(2027, 2, 28, 12)), 2027, 3, 31);
  });

  test("February 2027: on 27 Feb the period is the one from 31 Jan", () => {
    eqLocal(A.periodStart(c, at(2027, 2, 27, 12)), 2027, 1, 31);
  });

  test("year wrap: on 15 Jan 2027 with day 31 the period started 31 Dec 2026", () => {
    eqLocal(A.periodStart(c, at(2027, 1, 15)), 2026, 12, 31);
    eqLocal(A.nextRenewal(c, at(2027, 1, 15)), 2027, 1, 31);
  });

  test("31 Dec is a normal start day, and 31 Mar 2027 is too", () => {
    eqLocal(A.periodStart(c, at(2026, 12, 31, 3)), 2026, 12, 31);
    eqLocal(A.periodStart(c, at(2027, 3, 31, 3)), 2027, 3, 31);
  });
});

describe("monthly: day 29, 30 and 31 around February, leap and non-leap", () => {
  test("day 29 in leap February 2028: starts on 29 Feb", () => {
    eqLocal(A.periodStart(cfgMonth(29), at(2028, 2, 29, 12)), 2028, 2, 29);
    eqLocal(A.periodStart(cfgMonth(29), at(2028, 2, 28, 12)), 2028, 1, 29);
  });

  test("day 29 in non-leap February 2027: the period starts on 28 Feb (the last day)", () => {
    eqLocal(A.periodStart(cfgMonth(29), at(2027, 2, 28, 12)), 2027, 2, 28);
    eqLocal(A.periodStart(cfgMonth(29), at(2027, 3, 1, 12)), 2027, 2, 28);
    eqLocal(A.nextRenewal(cfgMonth(29), at(2027, 2, 28, 12)), 2027, 3, 29);
  });

  test("day 30 in leap February 2028: the period starts on 29 Feb", () => {
    eqLocal(A.periodStart(cfgMonth(30), at(2028, 2, 29, 12)), 2028, 2, 29);
    eqLocal(A.nextRenewal(cfgMonth(30), at(2028, 2, 29, 12)), 2028, 3, 30);
  });

  test("day 30 in non-leap February 2027: the period starts on 28 Feb", () => {
    eqLocal(A.periodStart(cfgMonth(30), at(2027, 2, 28, 12)), 2027, 2, 28);
    eqLocal(A.periodStart(cfgMonth(30), at(2027, 2, 27, 12)), 2027, 1, 30);
  });

  test("day 31 in leap February 2028: starts on 29 Feb, and on 28 Feb the period is from 31 Jan", () => {
    eqLocal(A.periodStart(cfgMonth(31), at(2028, 2, 29, 12)), 2028, 2, 29);
    eqLocal(A.periodStart(cfgMonth(31), at(2028, 2, 28, 12)), 2028, 1, 31);
    eqLocal(A.nextRenewal(cfgMonth(31), at(2028, 2, 28, 12)), 2028, 2, 29);
  });

  test("day 31 in non-leap February 2027: the renewal from 28 Feb is 31 Mar", () => {
    eqLocal(A.nextRenewal(cfgMonth(31), at(2027, 2, 28, 12)), 2027, 3, 31);
  });
});

describe("monthly: day 1", () => {
  test("the period starts on the 1st at 00:00", () => {
    eqLocal(A.periodStart(cfgMonth(1), at(2027, 3, 1, 0, 0)), 2027, 3, 1);
    eqLocal(A.periodStart(cfgMonth(1), at(2027, 3, 15, 9)), 2027, 3, 1);
    eqLocal(A.periodStart(cfgMonth(1), at(2027, 2, 28, 23, 59)), 2027, 2, 1);
  });

  test("the renewal from 1 Dec 00:00 is 1 Jan, strictly after now", () => {
    const now = at(2026, 12, 1);
    assert.equal(A.periodStart(cfgMonth(1), now), now);
    eqLocal(A.nextRenewal(cfgMonth(1), now), 2027, 1, 1);
  });

  test("year wrap: on 1 Jan 2027 00:00 it starts that day, and on 31 Dec 2026 it is the 1 Dec period", () => {
    eqLocal(A.periodStart(cfgMonth(1), at(2027, 1, 1)), 2027, 1, 1);
    eqLocal(A.periodStart(cfgMonth(1), at(2026, 12, 31, 23)), 2026, 12, 1);
  });
});

describe("nextRenewal and periodStart agree for monthly periods", () => {
  test("the renewal is always after now and the period before it contains now, for a year of days", () => {
    for (const day of [1, 12, 28, 29, 30, 31]) {
      const c = cfgMonth(day);
      for (let i = 0; i < 400; i++) {
        const now = at(2026, 1, 1, 13) + i * DAY;
        const s = A.periodStart(c, now);
        const n = A.nextRenewal(c, now);
        assert.ok(s <= now, `start after now for day ${day}, i=${i}`);
        assert.ok(n > now, `renewal not after now for day ${day}, i=${i}`);
        assert.equal(A.nextRenewal(c, s - 1), s, `renewal before start for day ${day}, i=${i}`);
      }
    }
  });
});

/* ---------- weekly periods ---------- */

describe("weekly", () => {
  // 16 Nov 2026 is a Monday.
  test("on Monday 16 Nov 12:00 with weekday Monday the period started 16 Nov 00:00 and renews 23 Nov", () => {
    const now = at(2026, 11, 16, 12);
    eqLocal(A.periodStart(cfgWeek(1), now), 2026, 11, 16);
    eqLocal(A.nextRenewal(cfgWeek(1), now), 2026, 11, 23);
  });

  test("Sunday (0): on Monday 16 Nov the period started Sunday 15 Nov and renews Sunday 22 Nov", () => {
    const now = at(2026, 11, 16, 12);
    eqLocal(A.periodStart(cfgWeek(0), now), 2026, 11, 15);
    eqLocal(A.nextRenewal(cfgWeek(0), now), 2026, 11, 22);
  });

  test("Saturday (6): on Monday 16 Nov the period started Saturday 14 Nov and renews Saturday 21 Nov", () => {
    const now = at(2026, 11, 16, 12);
    eqLocal(A.periodStart(cfgWeek(6), now), 2026, 11, 14);
    eqLocal(A.nextRenewal(cfgWeek(6), now), 2026, 11, 21);
  });

  test("boundary: exactly Monday 16 Nov 00:00 with weekday Monday starts the period; the next is 23 Nov", () => {
    const now = at(2026, 11, 16);
    assert.equal(A.periodStart(cfgWeek(1), now), now);
    eqLocal(A.nextRenewal(cfgWeek(1), now), 2026, 11, 23);
  });

  test("boundary: exactly Sunday 15 Nov 00:00 with weekday Sunday starts the period; renews 22 Nov", () => {
    const now = at(2026, 11, 15);
    assert.equal(A.periodStart(cfgWeek(0), now), now);
    eqLocal(A.nextRenewal(cfgWeek(0), now), 2026, 11, 22);
  });

  test("boundary: at Sunday 15 Nov 23:59:59.999 with weekday Monday the period started Monday 9 Nov", () => {
    const now = at(2026, 11, 15, 23, 59, 59, 999);
    eqLocal(A.periodStart(cfgWeek(1), now), 2026, 11, 9);
    eqLocal(A.nextRenewal(cfgWeek(1), now), 2026, 11, 16);
  });

  test("every weekday 0..6: the period starts on that weekday at 00:00 and is exactly 7 calendar days long", () => {
    const now = at(2026, 11, 18, 12); // Wednesday
    for (let w = 0; w <= 6; w++) {
      const expectStart = new Date(2026, 10, 18);
      while (expectStart.getDay() !== w) expectStart.setDate(expectStart.getDate() - 1);
      const expectNext = new Date(expectStart.getFullYear(), expectStart.getMonth(), expectStart.getDate() + 7).getTime();
      const s = A.periodStart(cfgWeek(w), now);
      assert.equal(s, expectStart.getTime(), `start for weekday ${w}`);
      assert.equal(new Date(s).getDay(), w, `start weekday for ${w}`);
      assert.equal(A.nextRenewal(cfgWeek(w), now), expectNext, `renewal for weekday ${w}`);
    }
  });

  test("every weekday 0..6 at its own start day: now equals the start, renewal is the following week", () => {
    for (let w = 0; w <= 6; w++) {
      const start = new Date(2026, 10, 15 + w); // 15 Nov is Sunday, so day 15+w has getDay() === w
      assert.equal(start.getDay(), w);
      const s = start.getTime();
      assert.equal(A.periodStart(cfgWeek(w), s), s, `start itself for ${w}`);
      eqLocal(A.nextRenewal(cfgWeek(w), s), 2026, 11, 22 + w);
    }
  });

  test("year wrap: Friday 2 Jan 2026 with weekday Thursday started Thursday 1 Jan 2026", () => {
    eqLocal(A.periodStart(cfgWeek(4), at(2026, 1, 2, 9)), 2026, 1, 1);
    eqLocal(A.nextRenewal(cfgWeek(4), at(2026, 1, 2, 9)), 2026, 1, 8);
  });

  test("year wrap: Tuesday 5 Jan 2027 with weekday Saturday started Saturday 2 Jan 2027", () => {
    eqLocal(A.periodStart(cfgWeek(6), at(2027, 1, 5, 9)), 2027, 1, 2);
  });
});

/* ---------- daysUntil ---------- */

describe("daysUntil", () => {
  test("the same calendar day is 0, even at 23:59 vs 00:00", () => {
    assert.equal(A.daysUntil(at(2026, 11, 16, 23, 59), at(2026, 11, 16, 0, 0)), 0);
    assert.equal(A.daysUntil(at(2026, 11, 16, 0, 0), at(2026, 11, 16, 23, 59)), 0);
  });

  test("a minute either side of midnight is one calendar day", () => {
    assert.equal(A.daysUntil(at(2026, 11, 17, 0, 1), at(2026, 11, 16, 23, 59)), 1);
  });

  test("16 Nov to 12 Dec 2026 is 26 days (the card's 'in 26 days')", () => {
    assert.equal(A.daysUntil(at(2026, 12, 12), at(2026, 11, 16, 15)), 26);
  });

  test("a past date gives a negative count", () => {
    assert.equal(A.daysUntil(at(2026, 11, 16), at(2026, 12, 12)), -26);
  });

  test("accepts Date objects as well as milliseconds", () => {
    assert.equal(A.daysUntil(new Date(2026, 11, 12), new Date(2026, 10, 16, 9)), 26);
  });

  test("across a year end", () => {
    assert.equal(A.daysUntil(at(2027, 1, 1, 6), at(2026, 12, 31, 18)), 1);
  });
});

/* ---------- spendSince ---------- */

describe("spendSince", () => {
  const ledger = [[at(2026, 11, 9, 23, 59), 4], [at(2026, 11, 10), 6], [at(2026, 11, 15, 12), 2.5]];

  test("sums entries at or after the timestamp, inclusive of the boundary", () => {
    near(A.spendSince(ledger, at(2026, 11, 10)), 8.5);
    near(A.spendSince(ledger, at(2026, 11, 9, 23, 59)), 12.5);
  });

  test("an empty or missing ledger is 0", () => {
    assert.equal(A.spendSince([], 0), 0);
    assert.equal(A.spendSince(undefined, 0), 0);
  });

  test("a timestamp after everything is 0", () => {
    assert.equal(A.spendSince(ledger, at(2027, 1, 1)), 0);
  });
});

/* ---------- allowanceLeft ---------- */

describe("allowanceLeft", () => {
  test("the user's case: $200 monthly from 12 Nov, $36.60 spent since, on 16 Nov", () => {
    const ledger = [[at(2026, 11, 10, 9), 10], [at(2026, 11, 13, 15), 36.6]];
    const cfg = cfgMonth(12, { periodStart: at(2026, 11, 12), adjust: 0 });
    const r = A.allowanceLeft(cfg, ledger, at(2026, 11, 16, 9));
    assert.equal(r.kind, "month");
    assert.equal(r.amount, 200);
    near(r.used, 36.6);
    near(r.left, 163.4);
    near(r.pct, 0.183);
    assert.equal(r.start, at(2026, 11, 12));
    assert.equal(r.next, at(2026, 12, 12));
  });

  test("a ledger spanning two periods: only the current period's spend counts", () => {
    // Period from 12 Dec 2026. The 20 Nov spend belongs to the previous period.
    const ledger = [[at(2026, 11, 20), 30], [at(2026, 12, 13), 10]];
    const cfg = cfgMonth(12, { periodStart: at(2026, 12, 12), adjust: 0 });
    const r = A.allowanceLeft(cfg, ledger, at(2026, 12, 20));
    near(r.used, 10);
    near(r.left, 190);
    assert.equal(r.start, at(2026, 12, 12));
  });

  test("a ledger spanning two periods, with now still in the earlier one", () => {
    const ledger = [[at(2026, 10, 20), 50], [at(2026, 11, 20), 30]];
    const r = A.allowanceLeft(cfgMonth(12, { periodStart: at(2026, 11, 12) }), ledger, at(2026, 11, 25));
    near(r.used, 30);
  });

  test("the adjustment counts in its own period", () => {
    const ledger = [[at(2026, 11, 13, 15), 36.6]];
    const cfg = cfgMonth(12, { periodStart: at(2026, 11, 12), adjust: 25 });
    const r = A.allowanceLeft(cfg, ledger, at(2026, 11, 16));
    near(r.used, 61.6);
    near(r.left, 138.4);
  });

  test("the adjustment is ignored once the period has renewed (periodStart is older than the current start)", () => {
    const ledger = [[at(2026, 12, 12, 10), 5]];
    const cfg = cfgMonth(12, { periodStart: at(2026, 11, 12), adjust: 25 });
    const r = A.allowanceLeft(cfg, ledger, at(2026, 12, 13, 9));
    near(r.used, 5);
    near(r.left, 195);
  });

  test("the adjustment is ignored after renewal even with no spend in the new period", () => {
    const cfg = cfgMonth(12, { periodStart: at(2026, 11, 12), adjust: 80 });
    const r = A.allowanceLeft(cfg, [], at(2026, 12, 12, 0, 1));
    assert.equal(r.used, 0);
    assert.equal(r.left, 200);
  });

  test("spend from before the period start is not counted", () => {
    const r = A.allowanceLeft(cfgMonth(12, { periodStart: at(2026, 11, 12) }), [[at(2026, 11, 11, 23, 59), 99]], at(2026, 11, 16));
    assert.equal(r.used, 0);
  });

  test("weekly: the spend since Monday plus the adjustment", () => {
    const cfg = cfgWeek(1, { amount: 100, periodStart: at(2026, 11, 9), adjust: 15 });
    const ledger = [[at(2026, 11, 8, 20), 50], [at(2026, 11, 9), 6], [at(2026, 11, 10, 12), 4]];
    const r = A.allowanceLeft(cfg, ledger, at(2026, 11, 11, 12));
    assert.equal(r.kind, "week");
    near(r.used, 25);
    near(r.left, 75);
    assert.equal(r.start, at(2026, 11, 9));
    assert.equal(r.next, at(2026, 11, 16));
  });

  test("one-off: amount minus spend since setAt; start and next are null", () => {
    const cfg = { kind: "once", amount: 50, setAt: at(2026, 11, 10) };
    const ledger = [[at(2026, 11, 9), 100], [at(2026, 11, 11), 12], [at(2026, 11, 15), 8]];
    const r = A.allowanceLeft(cfg, ledger, at(2026, 11, 16));
    assert.equal(r.kind, "once");
    near(r.used, 20);
    near(r.left, 30);
    near(r.pct, 0.4);
    assert.equal(r.start, null);
    assert.equal(r.next, null);
  });

  test("a legacy balance {amount, setAt} with no kind reads as a one-off", () => {
    const r = A.allowanceLeft({ amount: 50, setAt: at(2026, 11, 10) }, [[at(2026, 11, 11), 12]], at(2026, 11, 16));
    assert.equal(r.kind, "once");
    near(r.left, 38);
    assert.equal(r.start, null);
  });

  test("over-spent: left goes negative and pct is clamped to 1", () => {
    const r = A.allowanceLeft(cfgMonth(12, { periodStart: at(2026, 11, 12) }), [[at(2026, 11, 13), 230]], at(2026, 11, 16));
    near(r.left, -30);
    assert.equal(r.pct, 1);
  });

  test("over-spent one-off: pct clamped to 1", () => {
    const r = A.allowanceLeft({ kind: "once", amount: 10, setAt: 0 }, [[at(2026, 11, 13), 25]], at(2026, 11, 16));
    assert.equal(r.pct, 1);
  });

  test("a negative adjustment that makes used negative: pct clamped to 0, left above the amount", () => {
    const r = A.allowanceLeft(cfgMonth(12, { periodStart: at(2026, 11, 12), adjust: -10 }), [], at(2026, 11, 16));
    near(r.used, -10);
    near(r.left, 210);
    assert.equal(r.pct, 0);
  });

  test("a recurring allowance with amount 0 gives a finite pct, not NaN", () => {
    // normalize() accepts amount 0 for recurring balances (buildBalance does not), and 0/0 gives NaN here.
    const r = A.allowanceLeft(cfgMonth(12, { amount: 0, periodStart: at(2026, 11, 12) }), [], at(2026, 11, 16));
    assert.ok(Number.isFinite(r.pct), `pct is ${r.pct}`);
  });

  test("null or invalid config gives null", () => {
    assert.equal(A.allowanceLeft(null, [], 0), null);
    assert.equal(A.allowanceLeft({ kind: "once", amount: -1 }, [], 0), null);
    assert.equal(A.allowanceLeft({ kind: "month", amount: 10, day: 40 }, [], 0), null);
  });

  test("a recurring stored balance without periodStart counts from the current period start", () => {
    // periodStart 0 is older than any period, so the adjustment (0) is ignored and only the ledger counts.
    const r = A.allowanceLeft(cfgMonth(12), [[at(2026, 11, 13), 7]], at(2026, 11, 16));
    near(r.used, 7);
  });
});

/* ---------- settle ---------- */

describe("settle", () => {
  test("a stale period rolls over: periodStart moves on, adjust drops to 0, changed and renewed are true", () => {
    const cfg = { kind: "month", amount: 200, day: 12, setAt: 1, periodStart: at(2026, 11, 12), adjust: 25, askWhenOut: true };
    const s = A.settle(cfg, at(2026, 12, 13, 9));
    assert.equal(s.changed, true);
    assert.equal(s.renewed, true);
    assert.equal(s.cfg.periodStart, at(2026, 12, 12));
    assert.equal(s.cfg.adjust, 0);
  });

  test("settle does not mutate the balance it was given", () => {
    const cfg = { kind: "month", amount: 200, day: 12, setAt: 1, periodStart: at(2026, 11, 12), adjust: 25 };
    A.settle(cfg, at(2026, 12, 13));
    assert.equal(cfg.periodStart, at(2026, 11, 12));
    assert.equal(cfg.adjust, 25);
  });

  test("once the toast is recorded for the new start, renewed is false and nothing changes", () => {
    const first = A.settle({ kind: "month", amount: 200, day: 12, setAt: 1, periodStart: at(2026, 11, 12), adjust: 25 }, at(2026, 12, 13));
    const second = A.settle({ ...first.cfg, toastedFor: first.cfg.periodStart }, at(2026, 12, 14));
    assert.equal(second.renewed, false);
    assert.equal(second.changed, false);
  });

  test("several missed periods: one rollover to the latest start, renewed true once", () => {
    const cfg = { kind: "month", amount: 200, day: 12, setAt: 1, periodStart: at(2026, 9, 12), adjust: 40, toastedFor: at(2026, 9, 12) };
    const s = A.settle(cfg, at(2026, 11, 16));
    assert.equal(s.changed, true);
    assert.equal(s.renewed, true);
    assert.equal(s.cfg.periodStart, at(2026, 11, 12));
    assert.equal(s.cfg.adjust, 0);
    const again = A.settle({ ...s.cfg, toastedFor: s.cfg.periodStart }, at(2026, 11, 16));
    assert.equal(again.renewed, false);
  });

  test("an old toast with several missed periods still reports renewed", () => {
    const cfg = { kind: "week", amount: 100, weekday: 0, setAt: 1, periodStart: at(2026, 10, 1), toastedFor: at(2026, 10, 1) };
    const s = A.settle(cfg, at(2026, 11, 16));
    assert.equal(s.renewed, true);
    assert.equal(s.cfg.periodStart, at(2026, 11, 15));
  });

  test("a balance set this period (no toastedFor) is not reported as renewed", () => {
    const s = A.settle({ kind: "month", amount: 200, day: 12, setAt: 1, periodStart: at(2026, 11, 12), adjust: 5 }, at(2026, 11, 16));
    assert.equal(s.changed, false);
    assert.equal(s.renewed, false);
    assert.equal(s.cfg.adjust, 5);
  });

  test("a weekly rollover: periodStart moves to the Sunday on or before now", () => {
    const s = A.settle({ kind: "week", amount: 100, weekday: 0, setAt: 1, periodStart: at(2026, 11, 8), adjust: 3, toastedFor: at(2026, 11, 8) }, at(2026, 11, 16));
    assert.equal(s.renewed, true);
    assert.equal(s.changed, true);
    eqLocal(s.cfg.periodStart, 2026, 11, 15);
    assert.equal(s.cfg.adjust, 0);
  });

  test("a one-off comes back unchanged with both flags false", () => {
    const cfg = { kind: "once", amount: 50, setAt: at(2026, 11, 1) };
    const s = A.settle(cfg, at(2026, 11, 16));
    assert.deepEqual(s.cfg, cfg);
    assert.equal(s.changed, false);
    assert.equal(s.renewed, false);
  });

  test("a legacy balance with no kind comes back as a one-off, unchanged", () => {
    const s = A.settle({ amount: 50, setAt: at(2026, 11, 1) }, at(2026, 11, 16));
    assert.equal(s.cfg.kind, "once");
    assert.equal(s.cfg.amount, 50);
    assert.equal(s.changed, false);
    assert.equal(s.renewed, false);
  });

  test("null gives null with both flags false", () => {
    assert.deepEqual(A.settle(null, 0), { cfg: null, changed: false, renewed: false });
  });
});

/* ---------- ledgerCutoff ---------- */

describe("ledgerCutoff", () => {
  const now = at(2026, 11, 16, 9);
  const back400 = now - 400 * DAY;

  test("one-off with a recent setAt: 400 days back (the setAt is newer)", () => {
    assert.equal(A.ledgerCutoff({ kind: "once", amount: 1, setAt: at(2026, 11, 10) }, now), back400);
  });

  test("one-off with a setAt older than 400 days: the setAt is kept", () => {
    const setAt = now - 500 * DAY;
    assert.equal(A.ledgerCutoff({ kind: "once", amount: 1, setAt }, now), setAt);
  });

  test("a legacy one-off with setAt older than 400 days uses that setAt", () => {
    const setAt = now - 450 * DAY;
    assert.equal(A.ledgerCutoff({ amount: 1, setAt }, now), setAt);
  });

  test("monthly: 400 days back (the current period start is always more recent)", () => {
    const cfg = cfgMonth(12, { periodStart: at(2026, 11, 12) });
    assert.equal(A.ledgerCutoff(cfg, now), back400);
    assert.ok(A.ledgerCutoff(cfg, now) <= A.periodStart(cfg, now));
  });

  test("weekly: 400 days back, and no later than the current period start", () => {
    const cfg = cfgWeek(1, { periodStart: at(2026, 11, 16) });
    assert.equal(A.ledgerCutoff(cfg, now), back400);
    assert.ok(A.ledgerCutoff(cfg, now) <= A.periodStart(cfg, now));
  });

  test("no balance: 400 days back", () => {
    assert.equal(A.ledgerCutoff(null, now), back400);
  });
});

/* ---------- buildBalance ---------- */

describe("buildBalance", () => {
  const now = at(2026, 11, 16, 9);

  describe("one-off", () => {
    test("stores kind, amount and setAt = now", () => {
      const r = A.buildBalance({ kind: "once", amount: 150 }, [], now);
      assert.deepEqual(r, { ok: true, balance: { kind: "once", amount: 150, setAt: now } });
    });

    test("an amount of 0 is allowed", () => {
      assert.equal(A.buildBalance({ kind: "once", amount: 0 }, [], now).ok, true);
    });

    test("a negative, non-numeric or missing amount is rejected on 'amount'", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "once", amount: -1 }, [], now)), "amount");
      assert.equal(fieldOf(A.buildBalance({ kind: "once", amount: "abc" }, [], now)), "amount");
      assert.equal(fieldOf(A.buildBalance({ kind: "once" }, [], now)), "amount");
    });
  });

  describe("validation", () => {
    test("a missing or unknown kind is rejected on 'kind'", () => {
      assert.equal(fieldOf(A.buildBalance({ amount: 10 }, [], now)), "kind");
      assert.equal(fieldOf(A.buildBalance({ kind: "year", amount: 10, day: 1 }, [], now)), "kind");
    });

    test("monthly amount must be above 0", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 0, day: 12 }, [], now)), "amount");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: "", day: 12 }, [], now)), "amount");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: -5, day: 12 }, [], now)), "amount");
    });

    test("weekly amount must be above 0", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 0, weekday: 1 }, [], now)), "amount");
    });

    test("monthly day must be an integer from 1 to 31 ('12' as a string is fine)", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: 0 }, [], now)), "day");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: 32 }, [], now)), "day");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: 1.5 }, [], now)), "day");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10 }, [], now)), "day");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: null }, [], now)), "day");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: "abc" }, [], now)), "day");
      const ok = A.buildBalance({ kind: "month", amount: 10, day: "12" }, [], now);
      assert.equal(ok.ok, true);
      assert.equal(ok.balance.day, 12);
    });

    test("weekly weekday must be an integer from 0 to 6", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 10, weekday: 7 }, [], now)), "weekday");
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 10, weekday: -1 }, [], now)), "weekday");
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 10, weekday: 2.5 }, [], now)), "weekday");
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 10 }, [], now)), "weekday");
    });

    test("weekly weekday null is rejected on 'weekday', not stored as Sunday", () => {
      // Number(null) is 0, which is a valid weekday, so the check passes and Sunday is saved.
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 10, weekday: null }, [], now)), "weekday");
    });

    test("weekly weekday \"\" is rejected on 'weekday', not stored as Sunday", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "week", amount: 10, weekday: "" }, [], now)), "weekday");
    });

    test("'used' must be 0 or more when given", () => {
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: 1, used: -5 }, [], now)), "used");
      assert.equal(fieldOf(A.buildBalance({ kind: "month", amount: 10, day: 1, used: "abc" }, [], now)), "used");
      assert.equal(A.buildBalance({ kind: "month", amount: 10, day: 1, used: 0 }, [], now).ok, true);
    });
  });

  describe("'used' and the adjustment", () => {
    // The ledger has $20 since the 12th; now is 16 Nov.
    const ledger = [[at(2026, 11, 13, 15), 20]];

    test("'used' left empty (\"\" or null) defaults to Aura's own count, so adjust is 0", () => {
      for (const used of ["", null, undefined]) {
        const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used }, ledger, now);
        assert.equal(r.ok, true);
        assert.equal(r.balance.adjust, 0);
      }
    });

    test("'used' above Aura's count gives a positive adjustment", () => {
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used: "35" }, ledger, now);
      assert.equal(r.balance.adjust, 15);
    });

    test("'used' below Aura's count gives a negative adjustment", () => {
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used: 10 }, ledger, now);
      assert.equal(r.balance.adjust, -10);
    });

    test("the adjustment is rounded to 6 decimal places", () => {
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used: 12.3456789 }, [], now);
      assert.equal(r.balance.adjust, 12.345679);
    });

    test("with the adjustment saved, allowanceLeft reads 'used' as entered", () => {
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used: 35 }, ledger, now);
      const left = A.allowanceLeft(r.balance, ledger, now);
      near(left.used, 35);
      near(left.left, 165);
    });

    test("the user's own setup: 'used' is 36.60 on 16 Nov with the 12 Nov period, and renders as 163.40 left", () => {
      const l = [[at(2026, 11, 13, 15), 36.6]];
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used: "36.60" }, l, now);
      assert.equal(r.ok, true);
      near(r.balance.adjust, 0);
      near(A.allowanceLeft(r.balance, l, now).left, 163.4);
    });
  });

  describe("stored fields", () => {
    test("monthly: periodStart is the current period start, toastedFor matches it, setAt is now, askWhenOut defaults true", () => {
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12 }, [], now);
      const b = r.balance;
      assert.equal(b.kind, "month");
      assert.equal(b.amount, 200);
      assert.equal(b.day, 12);
      assert.equal(b.setAt, now);
      assert.equal(b.periodStart, at(2026, 11, 12));
      assert.equal(b.toastedFor, at(2026, 11, 12));
      assert.equal(b.askWhenOut, true);
    });

    test("weekly: a Monday with weekday Monday starts that morning at 00:00", () => {
      const r = A.buildBalance({ kind: "week", amount: 100, weekday: 1 }, [], at(2026, 11, 16, 12));
      assert.equal(r.balance.weekday, 1);
      assert.equal(r.balance.periodStart, at(2026, 11, 16));
    });

    test("askWhenOut false is kept", () => {
      const r = A.buildBalance({ kind: "week", amount: 100, weekday: 1, askWhenOut: false }, [], now);
      assert.equal(r.balance.askWhenOut, false);
    });

    test("the stored balance passes normalize unchanged in its meaningful fields", () => {
      const r = A.buildBalance({ kind: "month", amount: 200, day: 12, used: 30 }, [[at(2026, 11, 13), 20]], now);
      const n = A.normalize(r.balance);
      assert.equal(n.kind, "month");
      assert.equal(n.day, 12);
      assert.equal(n.periodStart, at(2026, 11, 12));
      assert.equal(n.adjust, 10);
      assert.equal(n.toastedFor, at(2026, 11, 12));
    });
  });
});

/* ---------- ordinal and daysIn ---------- */

describe("ordinal", () => {
  test("ordinary suffixes", () => {
    const cases = [[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [10, "10th"], [21, "21st"], [22, "22nd"], [23, "23rd"], [24, "24th"], [31, "31st"]];
    for (const [n, s] of cases) assert.equal(A.ordinal(n), s, `ordinal(${n})`);
  });

  test("11, 12 and 13 are 'th' (teens), including after 100", () => {
    assert.equal(A.ordinal(11), "11th");
    assert.equal(A.ordinal(12), "12th");
    assert.equal(A.ordinal(13), "13th");
    assert.equal(A.ordinal(111), "111th");
    assert.equal(A.ordinal(112), "112th");
    assert.equal(A.ordinal(113), "113th");
  });

  test("hundreds follow the last two digits", () => {
    assert.equal(A.ordinal(101), "101st");
    assert.equal(A.ordinal(102), "102nd");
    assert.equal(A.ordinal(103), "103rd");
    assert.equal(A.ordinal(121), "121st");
  });

  test("0 is 0th", () => {
    assert.equal(A.ordinal(0), "0th");
  });
});

describe("daysIn (month is 0-based)", () => {
  test("ordinary months", () => {
    assert.equal(A.daysIn(2026, 0), 31);
    assert.equal(A.daysIn(2026, 3), 30); // April
    assert.equal(A.daysIn(2026, 10), 30); // November
    assert.equal(A.daysIn(2026, 11), 31); // December
  });

  test("February: 28 in 2027, 29 in leap 2028", () => {
    assert.equal(A.daysIn(2027, 1), 28);
    assert.equal(A.daysIn(2028, 1), 29);
  });

  test("century rules: 2000 is leap, 2100 is not", () => {
    assert.equal(A.daysIn(2000, 1), 29);
    assert.equal(A.daysIn(2100, 1), 28);
  });
});

/* ---------- DST (London and New York; the file's TZ is restored after each suite) ---------- */

describe("DST: Europe/London (clocks forward 29 Mar 2026, back 25 Oct 2026)", () => {
  before(() => { process.env.TZ = "Europe/London"; });

  test("sanity: the zone is in effect (BST in summer, GMT in winter)", () => {
    assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), -60);
    assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), 0);
  });

  test("spring forward: a monthly period starts at local 00:00 and renews at local 00:00", () => {
    const c = cfgMonth(29);
    const now = at(2026, 3, 30, 10);
    eqLocal(A.periodStart(c, now), 2026, 3, 29, 0, 0);
    eqLocal(A.nextRenewal(c, now), 2026, 4, 29, 0, 0);
  });

  test("spring forward: a weekly period over the change is 7 days minus one hour, and still starts at 00:00", () => {
    const c = cfgWeek(0); // Sunday
    const now = at(2026, 3, 30, 12);
    const s = A.periodStart(c, now), n = A.nextRenewal(c, now);
    eqLocal(s, 2026, 3, 29, 0, 0);
    eqLocal(n, 2026, 4, 5, 0, 0);
    assert.equal(n - s, 7 * DAY - HOUR);
  });

  test("spring forward: daysUntil counts calendar days across the 23-hour day", () => {
    assert.equal(A.daysUntil(at(2026, 3, 29, 0, 30), at(2026, 3, 28, 23, 30)), 1); // only 1 hour apart
    assert.equal(A.daysUntil(at(2026, 3, 29, 0, 1), at(2026, 3, 28, 23, 59)), 1);
    assert.equal(A.daysUntil(at(2026, 4, 5), at(2026, 3, 28, 12)), 8);
  });

  test("fall back: a weekly period over 25 Oct (a 25-hour day) is 7 days plus one hour and starts at 00:00", () => {
    const c = cfgWeek(0);
    const now = at(2026, 10, 26, 12); // Monday
    const s = A.periodStart(c, now), n = A.nextRenewal(c, now);
    eqLocal(s, 2026, 10, 25, 0, 0);
    eqLocal(n, 2026, 11, 1, 0, 0);
    assert.equal(n - s, 7 * DAY + HOUR);
  });

  test("fall back: exactly 25 Oct 00:00 starts a weekly Sunday period", () => {
    const now = at(2026, 10, 25);
    assert.equal(A.periodStart(cfgWeek(0), now), now);
  });

  test("fall back: a monthly period on the 25th starts 25 Oct 00:00 and renews 25 Nov 00:00", () => {
    const c = cfgMonth(25);
    const now = at(2026, 10, 26, 8);
    eqLocal(A.periodStart(c, now), 2026, 10, 25, 0, 0);
    eqLocal(A.nextRenewal(c, now), 2026, 11, 25, 0, 0);
  });

  test("fall back: daysUntil across the 25-hour day counts calendar days", () => {
    assert.equal(A.daysUntil(at(2026, 10, 26, 0, 30), at(2026, 10, 25, 23, 30)), 1);
    assert.equal(A.daysUntil(at(2026, 11, 1, 0, 30), at(2026, 10, 25, 12)), 7);
  });
});

describe("DST: America/New_York (clocks forward 8 Mar 2026, back 1 Nov 2026)", () => {
  before(() => { process.env.TZ = "America/New_York"; });

  test("sanity: the zone is in effect (EDT in summer, EST in winter)", () => {
    assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), 240);
    assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), 300);
  });

  test("spring forward: a monthly period on the 8th starts at local 00:00 and renews 8 Apr 00:00", () => {
    const c = cfgMonth(8);
    const now = at(2026, 3, 9, 9);
    const s = A.periodStart(c, now), n = A.nextRenewal(c, now);
    eqLocal(s, 2026, 3, 8, 0, 0);
    eqLocal(n, 2026, 4, 8, 0, 0);
    assert.equal(n - s, 31 * DAY - HOUR);
  });

  test("spring forward: a weekly Sunday period from 8 Mar is 7 days minus one hour", () => {
    const c = cfgWeek(0);
    const now = at(2026, 3, 11, 12); // Wednesday
    const s = A.periodStart(c, now), n = A.nextRenewal(c, now);
    eqLocal(s, 2026, 3, 8, 0, 0);
    eqLocal(n, 2026, 3, 15, 0, 0);
    assert.equal(n - s, 7 * DAY - HOUR);
  });

  test("spring forward: daysUntil counts calendar days across the 23-hour day", () => {
    assert.equal(A.daysUntil(at(2026, 3, 9, 0, 30), at(2026, 3, 7, 23, 30)), 2); // two calendar days, about 25 hours
    assert.equal(A.daysUntil(at(2026, 3, 9, 8), at(2026, 3, 7, 12)), 2);
    assert.equal(A.daysUntil(at(2026, 3, 8, 23), at(2026, 3, 8, 0, 30)), 0);
  });

  test("fall back: a weekly Sunday period from 1 Nov is 7 days plus one hour, starting at 00:00", () => {
    const c = cfgWeek(0);
    const now = at(2026, 11, 3, 12); // Tuesday
    const s = A.periodStart(c, now), n = A.nextRenewal(c, now);
    eqLocal(s, 2026, 11, 1, 0, 0);
    eqLocal(n, 2026, 11, 8, 0, 0);
    assert.equal(n - s, 7 * DAY + HOUR);
  });

  test("fall back: a monthly period on the 1st starts at local 00:00 on 1 Nov", () => {
    eqLocal(A.periodStart(cfgMonth(1), at(2026, 11, 1, 0, 30)), 2026, 11, 1, 0, 0);
    eqLocal(A.nextRenewal(cfgMonth(1), at(2026, 11, 1, 0, 30)), 2026, 12, 1, 0, 0);
  });

  test("fall back: daysUntil across the 25-hour day counts calendar days", () => {
    assert.equal(A.daysUntil(at(2026, 11, 1, 12), at(2026, 10, 31, 12)), 1);
  });
});
