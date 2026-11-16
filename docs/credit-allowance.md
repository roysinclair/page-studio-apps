# Page Aura: credit that renews every month or week

## What the user asked (2026-11-16)

> "I get API tokens from Anthropic and I get them monthly. So my tokens renew on the 12th of November as an example. And on the 12th of November, I get $200 worth of tokens for until the next 12th of the month. So I want to code something like that in there. So either people can just give their standard tokens, right? Like an amount, or you can have it monthly or weekly, like kind of resets."

## Today

The sidebar card (`#spend`, `renderSpend`, `openBalance`) holds one fixed balance, `aura.balance` =
`{amount, setAt}`. It counts that down using the spend ledger `aura.ledger` (`[[ms, usd], …]`, 400 days),
and shows "Today" and "This month" (calendar month).

## The change

The dialog, now called **"Your API credit"**, has three kinds, picked with the existing `.seg` control:

| Kind | Fields | What the card counts |
|---|---|---|
| **One-off amount** (today's behaviour) | Current balance | `amount − spend since setAt` |
| **Every month** | Amount each month; renews on day *D* (1–31) | `amount − (used at setup + spend since setup)` within the current period |
| **Every week** | Amount each week; renews every *weekday* | the same, with a week-long period |

**Periods**
- Monthly: a period starts on day *D* at 00:00 local time. In a month without day *D* (for example the 31st
  in November), it starts on that month's last day.
- Weekly: a period starts on the chosen weekday at 00:00 local time.
- Unused credit doesn't carry over.

**Already used this period**
- When a period-based allowance is set up, the dialog asks **"Already used since <period start>"**.
- The field is prefilled with Page Aura's own count since the period start, and you can raise it to what the
  Console shows.
- The difference is kept as an adjustment for that period only. Spend from other apps or devices is otherwise
  invisible.

**At renewal** the count starts again at the full amount, and the adjustment is dropped. The next time a page is
open, it shows one toast: "Your monthly credit renewed: $200 until 12 Jan."

**Stored as** `aura.balance`:
- one-off: `{kind:"once", amount, setAt}`;
- recurring: `{kind:"month"|"week", amount, day|weekday, setAt, periodStart, adjust, askWhenOut}`.
- A stored value with no `kind` is read as one-off, so existing balances keep working.

### Card

- **First line:** `≈ $163.40 left of $200`.
- **Gauge.**
- **Renewal:** a dot, then `Renews 12 Dec · in 26 days`, or `Renews Monday · in 4 days`.
- **Last line:** `Today $1.20` and `Since 12 Nov $36.60` (weekly: `This week $12.40`).
- **Amber** once 80% is used. **Red** at zero, with `used up · $200 a month`.
- One-off keeps today's card (amber below 10% or $2).

### Ask before sending once it's used up

- This is a toggle in the dialog, on by default for recurring allowances.
- When the allowance is used up and you press Send, a red line appears above the box: "Your monthly allowance is
  used up until 12 Dec. This reply would spend credit beyond it." It offers **Cancel** and **Send anyway**.
- **Send anyway** covers that one message only.
- Page Aura can't stop Anthropic from billing. This is a reminder, and the dialog says so.

## Decision (2026-11-16)

The user approved the design as rendered. When a recurring allowance is used up, Aura asks before each reply (**Ask first**), and the dialog toggle can turn this off. Other choices offered and not taken: just show it, or block sending.

## Renders

The approved renders are in the session scratchpad `allowance/`:
- cards: month, low, used up, week, light;
- the composer line;
- the dialog: month, week, one-off, light.

## Build plan

1. **Sonnet:** the dialog, card, period maths, toast and ask line in page-aura.html. Then `update-csp.py`.
   Orbit is unchanged: it doesn't use this card.
2. **Haiku:** node tests for the period maths:
   - day 31 in short months;
   - leap years;
   - DST changes;
   - the weekday rollover;
   - the adjustment dropping at renewal;
   - reading an old balance with no `kind`.
3. **Opus:**
   - renders against the board;
   - a run in the browser with a faked clock across a renewal;
   - the guide (docs/aura/README.md "The balance gauge") and a fresh balance.png.
