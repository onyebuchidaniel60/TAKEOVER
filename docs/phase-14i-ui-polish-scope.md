# Phase 14i — UI polish: scope

Status: PROPOSED (scoping phase — no code changed, no tests run).
Date: 2026-09-18.
Base: `6b93bf0` (origin/main).

## 0. Premise

Functional work is complete (both payment rails on mainnet, 14j-1;
owner runs the Mini App E2E next). The UI is functional-first:
Phase 11 shipped accessibility and state coverage, and the visual
design was deliberately left minimal. This phase is visual polish
only — no features, no layout restructuring, no behavior change
beyond ARCHITECTURE.md §20 (UX rules) and §21 (accessibility).

Craft authority: the Emil Kowalski skills under
`.opencode/skills/` (installed this phase). `emil-design-eng` is
the primary reference and governs execution quality for every
direction below; `apple-design` informs motion/material/type
choices; `find-animation-opportunities` supplies the motion gate
(applied in §4); `improve-animations` / `review-animations`
supply the audit and review passes at the end of each
implementation phase. A direction picks the aesthetic; the skills
govern whether it is well executed. No direction below violates
them.

(Note on skill loading: the environment's skill tool only
registers OpenCode's own configuration skills, so the repo skills
cannot be invoked through it here. They were loaded by reading
`.opencode/skills/*/SKILL.md` directly — same content, same
rules. A future agent with a working skill tool should prefer it.)

## 1. Current state assessment

The app is a coherent, mobile-first (`max-w-3xl`, `px-4 sm:px-6`)
slate/white marketplace with zero visual identity of its own:
stock Tailwind palette (slate surfaces, emerald available/paid,
amber pending/review, red destructive, orange low-stock), one
card pattern (`rounded-xl border-slate-200 bg-white p-4`,
`shadow-sm` on some cards), one pill pattern (`rounded-full`,
color varies), one primary button (`bg-slate-900`, `min-h-touch`),
and a global 3px `:focus-visible` ring (`apps/web/src/index.css`).
Phase 11 left real foundations: `min-h-touch` / `min-h-area` /
`min-w-admintable` tokens, a documented palette/type scale (in
`apps/web/tailwind.config.js` comments), keyboard-trapped dialogs,
threshold-announced countdowns, and blanket `prefers-reduced-motion`
handling. Where it feels unfinished: no iconography anywhere (a
`●` glyph in `TimeBadge.tsx:19` and `←` back links stand in for
icons); feed cards carry bare category/location text and no media
(`SlotCard.tsx:25-28`); payment waits are ticking text counters
with no progress affordance (`VerifyDepositBox.tsx:131-134`,
`ConfirmReceiptBox.tsx:190-195`); four radii and three red text
shades drift across files; admin pages are debug-grade (raw UUID
textboxes in `AdminUsers.tsx:130-159`, raw JSON in a 224px column
in `AdminAudit.tsx:182-184`); dialogs mount with zero transition;
and the TopBar is 8px misaligned with page content on mobile
(`TopBar.tsx:10` uses `px-6`, pages use `px-4 sm:px-6`).

## 2. Design directions

Shared execution rules (all directions, from `emil-design-eng`):
custom easing curves (never bare `ease`/`ease-in` — `ease-in` on UI
is a block), UI motion under 300ms, `transform`/`opacity` only,
press feedback (`scale(0.97)`, 100–160ms) on every pressable,
no `scale(0)` entrances (start `0.95` + opacity), hover motion
gated behind `@media (hover: hover) and (pointer: fine)`,
reduced-motion keeps opacity/color but drops movement, stagger
capped at 30–80ms and never blocking interaction, review-table
format for every polish diff.

### Direction A — "Warm marketplace" (consumer, tactile)

Aesthetic: warm neutrals (stone-tinted surfaces, one warm accent
for urgency/availability, deep slate-ink text), generous spacing
(feed gap 3→4, card padding 4→5/6), large radii (`rounded-2xl`
cards, full pills), display type with tight tracking (`-0.02em`)
on slot titles and prices, tabular numerals on times/countdowns.
Motion character: gentle and physical — ease-out entrances,
30–50ms feed stagger, press-scale everywhere, a thin progress
treatment on payment waits. Reference apps: Resy (density of
time-slots, urgency without alarm), Tock (warm card presentation),
Airbnb (rounded imagery-first cards — adapted without photos:
color-block/category headers instead). Per surface: feed gets
category pills + urgency hierarchy + stagger; detail gets a
stronger title/price block and a friendlier claim CTA;
forms keep structure, gain warmer inputs, focus warmth, and inline
character; payment keeps copy, gains progress + calmer
pending states; admin untouched (P2, likely out). Does NOT change:
information architecture, route structure, status state machine,
copy voice, admin. Effort: **M** — touches every P0 surface but
reuses the existing component tree; the work is tokens + class
changes + a progress component, not new components.

### Direction B — "Precision tool" (utility, dense)

Aesthetic: keep the slate system, sharpen it — one accent
(emerald) reserved strictly for available/confirmed, tighter
spacing (feed gap 3→2, card padding 4), small radii (`rounded-lg`
everywhere, pills become `rounded-md` chips), uppercase
micro-labels, tabular numerals throughout, hairline dividers
instead of card borders on the feed. Motion character: minimal —
press feedback only, zero stagger, zero entrances; speed is the
luxury. Reference apps: Linear (density, micro-type, restraint),
Vercel dashboard (monochrome + one accent), Stripe Dashboard
(data clarity, tabular figures). Per surface: feed becomes a dense
row list with right-aligned prices; detail compresses the facts
grid; forms go single-column compact with quieter labels; payment
states become terse status lines with a hairline progress bar;
admin gets the same tightening for free. Does NOT change:
routes, state machine, copy, admin structure. Effort: **M** —
similar file count to A but each edit is smaller; the risk is
over-densifying a consumer flow (buyers skim; density must not
become sterility).

### Direction C — "Calm system" (Apple restraint, least change)

Aesthetic: today's slate system, refined in place — radius
unified to `rounded-xl`/`rounded-lg`, red scale collapsed to one
pair, TopBar misalignment fixed, type scale tightened per the
apple skill (negative tracking on `text-2xl` titles, body leading
relaxed), sticky translucent TopBar (`backdrop-filter` blur +
translucency, content scrolling under — never stacked
translucency). Motion character: near-zero — press feedback and
dialog fade/scale only; everything else static. Reference apps:
Apple system UI (restraint, materials), Vercel marketing restraint
(applied to product chrome). Per surface: chrome + cards + badges
+ buttons unified; payment text waits gain a quiet indeterminate
treatment; forms gain input warmth only. Does NOT change: feed
structure, admin, any layout, any new component. Effort: **S** —
a token-cleanup pass plus a handful of class edits; the safe
fallback if the demo clock is short.

Recommendation: **A**. TAKEOVER's product identity
(PROJECT_SPEC.md §7) is a consumer marketplace competing on feel
("Something valuable just became available. Claim it before it's
gone."), and the competition demo is judged on first impression
inside Nimiq Pay. B risks reading cold for a tonight-booking
product; C is safe but leaves the "unfinished" impression the
sweep documented. A directly addresses the five unfinished spots
(media-less cards, text-only waits, glyph placeholders, snapping
disclosures, radius drift) while the skill guardrails prevent it
from becoming decoration.

## 3. Surface inventory with priority

### P0 — demo path

| Surface | File | Visual change | Size |
| --- | --- | --- | --- |
| App chrome | `apps/web/src/App.tsx`, `components/TopBar.tsx`, `components/WalletStatus.tsx` | Fix TopBar `px-6`→`px-4 sm:px-6`; sticky translucent bar (A/C) or tightened bar (B); connect-button warmth; pill/button wrap fix at 360px | S |
| Feed | `routes/Home.tsx`, `components/SearchFilters.tsx`, `components/SlotList.tsx`, `components/SlotCard.tsx`, `components/PriceDisplay.tsx`, `components/TimeBadge.tsx`, `components/AvailabilityBadge.tsx` | Card restyle (A: category pills, media-color header, stagger; B: dense rows; C: unify only); badge radius/color consolidation; filter form warmth; `●` glyph → icon | M |
| Slot detail | `routes/SlotDetailPage.tsx`, `components/SlotDetail.tsx` | Title/price block hierarchy; facts-grid refinement; back-link icon; claim CTA emphasis; report-link quieting | S |
| Claim + payment | `routes/ClaimDetailPage.tsx`, `components/EscrowPanel.tsx`, `components/VerifyDepositBox.tsx`, `components/ConfirmReceiptBox.tsx`, `components/ClaimStatusBadge.tsx`, `components/ClaimCard.tsx`, `components/HoldCountdown.tsx`, `components/ClaimButton.tsx` | Progress treatment replacing ticking counters (A) or hairline bar (B); pending-state calm-down; status-badge palette lock; countdown width-lock (`tabular-nums` + fixed `H:MM:SS` shape to kill the hour-boundary jump); press feedback on CTAs | M |
| Sell flow | `routes/Sell.tsx`, `routes/SellNew.tsx`, `routes/SellDetail.tsx`, `components/SlotForm.tsx`, `components/PublishButton.tsx`, `components/MarkDeliveredForm.tsx`, `components/ContactNoteForm.tsx` | Form input/label/error unification; fee-state warmth; box the floating `MarkDeliveredForm`; publish-button state polish; remove duplicated cancel trigger (pre-existing) | M |

### P1 — supporting

| Surface | File | Visual change | Size |
| --- | --- | --- | --- |
| Profile | `routes/Profile.tsx` | Card unification; copy-button feedback; shortcut row polish | S |
| Holds list | `routes/ClaimsPage.tsx` | Bucket headers; collapse-all-but-first on load (behavior-neutral default change — owner call); disclosure animation (height, interruptible, reduced-motion-safe) or leave native snap | S |
| Dialogs | `components/ResolveDialog.tsx`, `components/DisableDialog.tsx`, `components/ReportDialog.tsx`, `components/CancelConfirmDialog.tsx` | Radius lock to card language; overlay fade + panel scale-from-`0.95` (200–250ms ease-out, centered origin — modals exempt from trigger-origin); add missing `min-h-touch` | S |
| States | `components/EmptyState.tsx`, `components/LoadingSkeleton.tsx`, `components/ErrorState.tsx`, `components/ErrorBoundary.tsx`, `routes/NotFound.tsx` | Skeleton aria-label per route (currently always "Loading available slots"); empty-state warmth (A only); error-card ring consistency | S |

### P2 — admin (likely out of demo scope)

`routes/admin/*.tsx` + `components/AdminTable.tsx` + `components/AdminTile.tsx`:
token inheritance only (radius/color/button unification rides the
P0 token pass for free). No admin-specific redesign: the UUID-box
directories and raw-JSON audit column stay as-is unless the owner
puts P2 in scope — they are operator surfaces, and redesigning
them risks the Phase 15 clock for zero demo value.

## 4. Design system decisions

**D1 — Tokens: extend, don't layer.** Add to
`apps/web/tailwind.config.js` (the Phase 11 pattern): `--ease-out`
`cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out`
`cubic-bezier(0.77, 0, 0.175, 1)`, duration scale
(`press 120ms`, `ui 200ms`, `panel 280ms` — all < 300ms),
one radius decision (direction-dependent), one red pair, one
shadow pair (`shadow-sm` + modal `shadow-xl`, applied
consistently). No parallel token system; the motion gate
(§4-motion) references these tokens by name.

**D2 — Component library: no.** The dialogs already trap focus,
close on Escape, and restore focus (proven by
`keyboard-focus.test.tsx`); Radix/Base UI buys origin-aware
popovers the app doesn't have (no menus, no popovers, no
tooltips — the only overlay is centered modals, which stay
centered per the skill). A dependency adds WebView bundle weight
and a new audit surface for zero needed primitives.
Revisit only if a future phase adds menus/popovers.

**D3 — Icons: one small set, owner-approved.** Today: zero icons
(`●`, `←` glyphs). Recommend `lucide-react` (tree-shaken,
~1KB/icon, `currentColor` strokes that inherit the text palette):
back chevron, clock, location pin, tag/category, wallet, copy,
check, alert, close. Cap at ~10 icons, stroke `1.5–2px`, sizes
14–18px. Alternative (zero-dep): hand-rolled inline SVG set —
cheaper in bytes, costlier in consistency. Either way the glyphs
die in this phase.

**D4 — Typography: system stack, real scale.** No webfont:
Nimiq Pay WebView load cost + offline risk outweigh brand value
for a utility flow, and the system stack already ships optical
sizing (apple skill §15). Instead: size-specific tracking
(`text-2xl` titles `-0.02em`, body `0`), relaxed body leading,
`tabular-nums` on every time/money/count figure, `font-optical-sizing: auto`.

**D5 — Motion budget.** Minimal core (press feedback everywhere,
dialog fade/scale, progress on waits) + one direction-flavored
extra (A: 30–50ms feed stagger; B: none; C: none). Full motion
gate, applied with `find-animation-opportunities` severity:

| # | Location | Purpose | Frequency | Motion (exact) |
| --- | --- | --- | --- | --- |
| 1 | All primary CTAs (`ClaimButton`, `PublishButton`, `Approve & Deposit`, `Confirm receipt`, `Mark delivered`) | Feedback | Tens/day | `:active scale(0.97)`, `transform 120ms ease-out` token |
| 2 | Dialogs (`ResolveDialog`, `DisableDialog`, `ReportDialog`) | Preventing a jarring change | Occasional | Overlay opacity 200ms ease-out; panel `scale(0.95)`+opacity 220ms ease-out token, centered origin |
| 3 | Payment waits (`VerifyDepositBox`, `ConfirmReceiptBox`) | State indication | Occasional | Determinate hairline bar (poll fraction N/60, N/24) or quiet indeterminate; attempt counts de-emphasized to `text-xs` |
| 4 | Feed list (`SlotList`/`SlotCard`, direction A only) | Delight (bounded) | Occasional | Enter `opacity 0 → 1`, `translateY(8px) → 0`, 200ms ease-out token, 40ms stagger, cap first 8 cards, never block interaction |
| 5 | Claims buckets (`ClaimsPage` disclosures) | Preventing a jarring change | Occasional | Height transition via grid-rows or WAAPI, 250ms ease-out token; keep native `<details>` semantics; static under reduced-motion |

Rejected (gate kills, recorded per the skill): countdown tick
animation (tens of observations per hold — text update only, plus
width-lock fix); hover lift on cards (touch-first WebView; hover
gated at most); skeleton shimmer upgrade (decorative on a
functional surface); stagger on admin tables (operator surface);
any spring/gesture work (no draggable surfaces exist); success
celebration (no rare high-emotion moment warrants it yet).

## 5. Phase breakdown

**14i-1 — Tokens, chrome, feed (S/M).** Objective: the design
language lands. Files: `tailwind.config.js` (D1 tokens),
`index.css` (easing application, hover gating, reduced-motion
extension), `App.tsx`/`TopBar.tsx`/`WalletStatus.tsx`,
`Home`/`SearchFilters`/`SlotList`/`SlotCard`/`PriceDisplay`/
`TimeBadge`/`AvailabilityBadge`, icon set install + glyph
replacement. Acceptance: feed renders in the chosen direction;
axe suite green; contrast math re-run for every new/changed color
pair; no `transition: all`, no `ease-in`, no layout-property
motion (review-table in the checkpoint). Depends on: owner picks
direction + D1/D3/D4. Ends with a `review-animations` pass.

**14i-2 — Detail, payment, forms (M).** Objective: the money
moments feel trustworthy. Files: `SlotDetailPage`/`SlotDetail`,
`ClaimDetailPage`/`EscrowPanel`/`VerifyDepositBox`/
`ConfirmReceiptBox`/`ClaimStatusBadge`/`ClaimCard`/
`HoldCountdown`/`ClaimButton`, `Sell*`/`SlotForm`/
`PublishButton`/`MarkDeliveredForm`/`ContactNoteForm`. Acceptance:
full buyer + provider flows click through with new states;
polling copy calm (counts de-emphasized, progress present);
a11y suite green (aria-live regions intact, countdown thresholds
intact). Depends on: 14i-1 tokens. Ends with a
`review-animations` pass.

**14i-3 — Dialogs, states, sweep (S).** Objective: consistency
lock. Files: all four dialogs, `EmptyState`/`LoadingSkeleton`/
`ErrorState`/`ErrorBoundary`/`NotFound`, `Profile`,
`ClaimsPage`, plus the cross-cutting fixes (radius lock, red-pair
collapse, skeleton labels, `min-h-touch` gaps, TopBar alignment
if missed). Acceptance: full battery green (typecheck, lint,
unit, integration, a11y incl. keyboard-focus, build); a
`find-animation-opportunities` re-sweep yields nothing unrated;
before/after screenshot set attached to the checkpoint. Depends
on: 14i-2. Ends with a `review-animations` pass. Admin P2 rides
here only if the owner scoped it in.

## 6. Test and a11y implications

The Phase 11 suite (`a11y-routes.test.tsx` axe zero
critical/serious, `keyboard-focus.test.tsx`, contrast math) must
pass after every implementation phase — it is the acceptance gate,
not a chore. Likely updates: any new/changed color pair needs a
contrast-math entry (the suite measures palette math separately
because jsdom cannot compute styles); dialog enter animations
must not break focus-trap timing assertions (keep durations ≤
250ms and assert post-transition state, per the Phase 13 MutationObserver precedent — never sleep-fixed waits);
`LoadingSkeleton` label-per-route changes its aria-label
assertions if any test pins the current string; stagger must not
delay interactivity assertions (animation is decorative;
interaction enabled at mount). Reduced-motion behavior extends:
new motion inherits the existing blanket rule, with opacity/color
retained per the skills (gentler, not zero).

## 7. Owner decisions

**Q1 — Which design direction?** Options: (a) A Warm marketplace;
(b) B Precision tool; (c) C Calm system. Trade-offs: A wins demo
warmth at M effort; B wins density at the risk of sterility; C is
cheapest (S) but leaves the unfinished impression in place.
RECOMMENDED: (a) — matches the consumer-marketplace identity and
the competition demo; skills keep it disciplined.

**Q2 — Scope?** Options: (a) P0 only; (b) P0+P1; (c) P0+P1+P2.
Trade-offs: (a) fastest, leaves dialogs/states inconsistent;
(b) coherent consumer app, +1 phase cost already budgeted in §5;
(c) polishes operator surfaces nobody demos. RECOMMENDED: (b).

**Q3 — Tokens: extend vs new layer?** Options: (a) extend
`tailwind.config.js` per D1; (b) new CSS-variable layer.
Trade-offs: (a) follows the Phase 11 pattern, zero migration;
(b) more expressive, parallel system to maintain.
RECOMMENDED: (a).

**Q4 — Component library?** Options: (a) no (hand-rolled stays);
(b) Radix/Base UI. Trade-offs: (a) zero weight, proven a11y;
(b) origin-aware primitives the app has no use for.
RECOMMENDED: (a); revisit if menus/popovers ever appear.

**Q5 — Typography: system vs webfont?** Options: (a) system stack
+ real scale; (b) webfont (e.g. Inter). Trade-offs: (a) zero load
cost, WebView-safe; (b) brand voice, FOUT/weight cost on every
cold open. RECOMMENDED: (a).

**Q6 — Motion budget?** Options: (a) minimal (press + dialogs +
progress); (b) moderate (+ feed stagger, A-flavored). Trade-offs:
(a) safest, slightly flatter; (b) warmer feed, one more thing to
regression-test. RECOMMENDED: (b) if direction A wins, else (a) —
motion follows the direction, never leads.

**Q7 — Admin pages in scope?** Options: (a) no (token inheritance
only); (b) yes (full P2). Trade-offs: (a) protects the Phase 15
clock; (b) coherent product, real cost on debug-grade surfaces
that may be rebuilt anyway. RECOMMENDED: (a).

**Q8 — Dark mode in scope?** Options: (a) no; (b) yes.
Trade-offs: (b) doubles every contrast pair and the entire review
surface for a Mini App shown in daylight contexts.
RECOMMENDED: (a) — non-goal unless the owner overrides.

**Q9 — Demo walkthrough recording after polish?** Options:
(a) yes; (b) no. Trade-offs: (a) locks the polish win into the
submission artifact; (b) saves an hour. RECOMMENDED: (a),
recorded inside Nimiq Pay on the polished build.

## 8. Risks

- **Polish introduces a11y regressions** (new color pair fails
  contrast; animation breaks focus timing; stagger delays
  interaction). Likelihood: medium. Impact: high (Phase 11 equity
  lost). Mitigation: a11y suite is the per-phase gate, contrast
  math re-run per pair, durations ≤ 250ms, decorative-only motion.
- **Over-scoping delays Phase 15** (P2/admin creep, motion
  wishlist growth). Likelihood: medium. Impact: high.
  Mitigation: P0+P1 default, P2 explicitly out; motion capped at
  the §4 table; each phase independently shippable.
- **WebView performance** (`backdrop-filter`, blur, many
  concurrent transitions on low-end Android). Likelihood: low–
  medium. Impact: medium (jank in the demo). Mitigation:
  transform/opacity only, no blur over scrolling content except
  the TopBar, real-device check in 14i-1 acceptance.
- **Taste drift without a designer** (three directions blur into
  an inconsistent middle). Likelihood: medium. Impact: medium.
  Mitigation: one direction picked up front; `review-animations`
  pass ends every phase; Before/After tables in checkpoints.
- **Mini App viewport surprises** (Nimiq Pay WebView widths,
  safe-areas, keyboard overlap on forms). Likelihood: low.
  Impact: medium. Mitigation: 360px check per phase (the
  WalletStatus wrap bug is the known specimen), owner E2E runs in
  the real shell.

## 9. Explicit non-goals

No new features. No route or information-architecture changes. No
copy-voice changes (SPEC §7 stands). No dark mode (unless Q8
overrides). No animation for its own sake (the §4 rejected list
is binding). No icon-library overhaul beyond the approved ~10
(Q D3). No admin redesign (unless Q7 overrides). No webfont
(unless Q5 overrides). No gesture/spring work (no draggable
surfaces). No contract, backend, or DB changes of any kind.
