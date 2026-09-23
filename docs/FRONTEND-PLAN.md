# TAKEOVER — Frontend Implementation Plan (OpenCode)

**Companion to:** `design.md` (source of truth for all visual
decisions).
**Scope:** Every phase required to redesign `apps/web` from its
current state to the language defined in `design.md`.
**Method:** Section by section. Build → audit in browser → fix →
next. Never batch.

**Owner-locked decisions:**
- **D1** — Dark-only. No light mode. No theme toggle. (Per
  `design.md`.)
- **D2** — Floating pill bottom nav. (Per `design.md` §7.)
- **D6** — Brand mark tile: dark tile, lime tab, light cradle.
  (Per `design.md` §3.7.)
- D3, D4, D5 — defaults from `design.md` apply (see §4.1).

---

## 0. OpenCode-specific setup (do this once, before Phase 1)

OpenCode handles rules and memory differently than Cline. This
section establishes the project structure OpenCode will use.

### 0.1 Skill directory

OpenCode reads project skills from `.opencode/skills/<name>/SKILL.md`.
Create a skill for this redesign:

```
.opencode/skills/takeover-frontend/
  SKILL.md                 # the primary skill file
  references/
    design-system.md       # condensed from design.md §3
    component-patterns.md  # pill CTA, card, chip, nav, header
    motion.md              # durations, easings, what animates
    copy-tone.md           # voice rules, good/bad examples
    browser-audit.md       # the audit checklist (from §2)
    mistakes-to-avoid.md   # populated from CORRECTIONS.md
    preferred-patterns.md  # populated from DECISIONS.md
```

**Important:** this repo has a documented issue where OpenCode's
skill tool does not auto-discover project skills (recorded in
`AI_HANDOFF.md` residuals from an earlier phase). The primary
`SKILL.md` must explicitly instruct the reader to open the
`references/` files directly. Do not rely on the skill tool.

Populate the skill files in **Phase 0** and refine them at
**Phase 12**.

### 0.2 Memory Bank

Running state lives under `docs/redesign/`:

```
docs/redesign/
  PREFLIGHT.md         # D1–D6 answers, verbatim
  CORRECTIONS.md       # running log of every correction
  DECISIONS.md         # running log of every non-obvious choice
  PROGRESS.md          # which phase is done, what's next
  BROWSER-AUDIT.md     # per-phase audit results
```

**OpenCode updates these continuously, not at the end.** When a
new session starts, it reads these to know where things stand.

### 0.3 Browser audit — Playwright scripts

OpenCode does not have native browser use. To perform the
per-phase audit (open the app, screenshot, measure contrast,
inspect states), the project needs a small scripted tool.

**Owner decision — new dev dependency required.**

Add **Playwright** as a dev dependency (root `package.json`):

```
npm.cmd install -D playwright
npx playwright install chromium
```

Playwright is the industry standard for scripted browser
automation, has no runtime cost, and is dev-only. It is the only
practical way to do a programmatic audit from within an OpenCode
session.

**Create a reusable audit script** at `scripts/audit/audit.mjs`
(Phase 0). It accepts:
- A route path (e.g., `/`, `/slot/abc`, `/claim/xyz`)
- A list of viewport sizes
- A list of states to force (via query params, localStorage seeds,
  or API interception)
- An output directory

It returns:
- Screenshots at each viewport × state
- A JSON report of computed colors, contrast ratios, and any
  detected overflow

The script is invoked per phase:

```
node scripts/audit/audit.mjs --route / --viewports 320,375,768,1280 --states default,empty,loading,error --out docs/redesign/audits/phase-3
```

**Fallback if Playwright is not approved:** the owner runs the app
manually and screenshots at each viewport. The agent then reviews
the screenshots. This is slower and less reliable but requires no
dependency. Flag which approach is approved in Phase 0.

### 0.4 Reference image

Place the design reference at `design/reference.png`. OpenCode
reads `design.md` for the rules and glances at the reference when
a specific visual choice is ambiguous. Keep it in the repo — it
costs nothing and catches proportions, density, and feel that
prose can't fully carry.

---

## 1. How this plan works

Each phase is:

1. **Bounded** — one surface group, one or a few files.
2. **Auditable in browser** — via the Playwright audit script
   (§0.3). The agent opens the app, walks the flow, checks every
   state, captures screenshots, measures contrast, and reports
   what it actually saw.
3. **Independently shippable** — the app works after every phase.
4. **Gated** — a phase is not done until the browser audit passes.

The agent does **not** proceed to the next phase automatically.
After each phase: report, STOP, wait for owner confirmation.

---

## 2. Browser audit method (scripted)

Every phase ends with this loop. The audit script (§0.3) automates
the mechanics; the agent still interprets what the screenshots
show.

### 2.1 Setup per audit

- Dev server running: `npm.cmd run dev --workspace takeover-web`
  (Vite on `http://localhost:5173`).
- The audit script navigates, screenshots, and measures.
- Viewport presets (in order):
  - **320 × 568** — smallest mobile
  - **375 × 812** — iPhone standard
  - **768 × 1024** — tablet
  - **1280 × 800** — desktop
- Every screen, every phase, all four.

### 2.2 What the script captures

**Screenshots** at each viewport × state. States to force, where
applicable:
- Default
- Loading (throttle via route or API interception)
- Empty (mock empty response)
- Error (block API or mock a 500)
- Focus (tab through, capture focus rings)
- Disabled (where relevant)
- Modal / drawer open
- Active / pressed (capture during interaction)

**Computed values** (JSON report):
- Every text node's computed color + its background color →
  measured contrast ratio
- Every interactive element's bounding box → size check (44px
  minimum)
- Document scroll width vs. viewport width → overflow detection
- Every focus ring's color + contrast

### 2.3 What the agent checks (by inspecting the output)

**Visual states** — from screenshots:
- Does the layout match `design.md`?
- Does spacing feel right (compare against the reference)?
- Is the accent used sparingly?

**Contrast report** — from the JSON:
- Any pair below 4.5:1 (text) or 3:1 (UI) → FAIL.
- Record every measured pair in the phase report.

**Touch targets** — from the JSON:
- Any interactive element below 44×44px → FAIL.

**Overflow** — from the JSON:
- Any scrollWidth > viewport width → horizontal scroll → FAIL.

**Interaction truth** — the agent walks these manually (the script
screenshots, the agent describes):
- Every button does what it says.
- Every link navigates.
- Every form validates.
- Every async action shows feedback.
- Escape closes overlays. Tab cycles.
- Back button behaves.

### 2.4 How the agent reports a phase

For each phase, the report includes:
- Files changed
- Screenshots attached (paths under `docs/redesign/audits/`)
- Every state checked
- Every issue found and how it was fixed
- Any issue left unresolved (and why)
- Battery results (typecheck, lint, tests, build, a11y)
- Confirm: "Phase X passes browser audit."

If a screenshot shows something wrong that code review would miss
(spacing, alignment, contrast, copy that reads badly), it goes in
the report. That is the point of the browser loop.

---

## 3. Phase list

| Phase | Surface | Size |
|---|---|---|
| 0 | Pre-flight: skill setup, decisions locked, audit script | M |
| 1 | Design token foundation (config + CSS, no screens) | S |
| 2 | Chrome + pill nav + brand mark | M |
| 3 | Feed / Home | M |
| 4 | Slot detail | M |
| 5 | Claim + escrow surfaces (highest priority) | L |
| 6 | Sell flow + publish | M |
| 7 | Profile / Claims / Notifications | M |
| 8 | Homepage sections | S |
| 9 | Dialogs + state components | M |
| 10 | Boring-things pass | M |
| 11 | Admin (inherit tokens only) | S |
| 12 | Final sweep + refine the skill | S |

---

## 4. Phase 0 — Pre-flight + OpenCode setup

**Objective:** Lock every decision, set up the skill and memory
bank, write the audit script. No application code yet.

### 4.1 Confirm owner decisions

The following are locked by the owner:

- **D1** — Dark-only. No light mode. No theme toggle.
- **D2** — Floating pill bottom nav.
- **D6** — Brand mark tile: dark tile, lime tab, light cradle.

The following defaults from `design.md` apply (confirm in the
report):
- **D3** — Lime accent = `#C4F135` (sampled from the reference).
- **D4** — Admin inherits tokens only; no redesign.
- **D5** — No photography. Category icons per slot type.

If any of D3–D5 needs to change, the owner flags it in Phase 0.
Otherwise they proceed as documented.

### 4.2 Read

1. `design.md` in full.
2. `design/reference.png` — study it.
3. Current `apps/web/tailwind.config.js` — the token layer being
   replaced.
4. Current `apps/web/src/index.css`.

### 4.3 Create `.opencode/skills/takeover-frontend/`

Populate the skill files with condensed versions of `design.md`:

- `SKILL.md` — a router. States that the redesign uses
  `design.md` as source of truth and lists the reference files
  below with instructions to read them directly (do not rely on
  the skill tool).
- `references/design-system.md` — condensed §3
- `references/component-patterns.md` — condensed §7
- `references/motion.md` — condensed §4
- `references/copy-tone.md` — condensed §5
- `references/browser-audit.md` — from §2 of this plan
- `references/mistakes-to-avoid.md` — empty (populated from
  `CORRECTIONS.md` at Phase 12)
- `references/preferred-patterns.md` — empty (populated from
  `DECISIONS.md` at Phase 12)

### 4.4 Create `docs/redesign/` (memory bank)

- `PREFLIGHT.md` — D1–D6 answers, verbatim
- `CORRECTIONS.md` — empty (header only)
- `DECISIONS.md` — empty (header only)
- `PROGRESS.md` — with the 13 phases listed, all marked "pending"
- `BROWSER-AUDIT.md` — empty

### 4.5 Build the audit script

**Owner decision required:**

**Option A (recommended):** Add Playwright as a dev dependency and
build the audit script. Two commands:
```
npm.cmd install -D playwright
npx playwright install chromium
```
Then create `scripts/audit/audit.mjs` — see §0.3 for the interface.

**Option B:** No new dependency. The owner runs the app in a
browser manually and screenshots each state. The agent reviews the
screenshots. Slower but zero-dependency.

**The agent must ask the owner which option applies before
proceeding.** Do not add Playwright without explicit approval.

If Option A: the script is written now. Test it against the current
app (before any redesign) to confirm it works.

If Option B: document the manual audit procedure in
`docs/redesign/MANUAL-AUDIT.md` and proceed.

### 4.6 Continuous logging (start here, never stop)

**Every time the owner corrects a decision** — during any phase —
the agent appends to `docs/redesign/CORRECTIONS.md`:

```
## Phase X — [surface]
- Corrected: [what the agent did]
- To: [what the owner wanted]
- Why: [the reasoning]
```

**Every time the agent makes a non-obvious choice**, it appends to
`docs/redesign/DECISIONS.md`:

```
## Phase X — [surface]
- Chose: [what was chosen]
- Because: [the principle from design.md §8 or a cited rule]
- Alternative considered: [what was rejected]
```

These two files are the primary input to the refined skill at
Phase 12. Do not wait until the end to write them.

### Deliverable

- `.opencode/skills/takeover-frontend/` populated
- `docs/redesign/` memory bank created
- Audit script built (or manual procedure documented)
- `PROGRESS.md` reflecting the state

### STOP conditions

- Any D1–D6 unanswered → STOP.
- `design.md` missing → STOP.
- `design/reference.png` missing → STOP.
- Audit option not confirmed → STOP.

---

## 5. Phase 1 — Design token foundation

**Objective:** Rewrite the token layer. No screen changes yet.

### Files

- `apps/web/tailwind.config.js`
- `apps/web/src/index.css`
- `apps/web/public/favicon.svg` + `apple-touch-icon.png` +
  `icon-192.png` + `icon-512.png` + `og-image.png`

### Build steps

1. Rewrite the token layer with values from `design.md` §3, §4.
   Preserve semantic token names (bg, surface, surface-2, border,
   text, text-muted, text-faint, accent, accent-hover, accent-ink,
   danger, warning) so existing components pick up new values
   automatically.
2. Add radii: `radius-card`, `radius-control`, `radius-chip`,
   `radius-pill`.
3. Add motion: `duration-press`, `duration-ui`, `duration-panel`,
   `ease-out-strong`, `ease-in-out`, `ease-drawer`.
4. Rewrite `index.css`:
   - Body `bg`
   - Focus ring: 2px lime at 2px offset
   - Reduced-motion block extended
   - Remove any light-mode / theme-toggle CSS
5. Regenerate the icon suite. Mark shape unchanged; colors only.

### Browser audit

1. Run the audit script (or manual) on `/`.
2. Resize through all four widths.
3. Verify nothing is broken (nothing should look final yet, but
   nothing should fail).
4. Inspect 3–4 text elements — confirm computed colors match the
   new palette.
5. Screenshot the favicon tab.

### Acceptance

- Token layer matches `design.md` §3, §4.
- Every existing screen renders without visual breakage.
- AA passes everywhere it passed before.
- Favicon shows correctly.
- typecheck, lint, tests, build green.

---

## 6. Phase 2 — Chrome + pill nav + brand mark

**Objective:** Header, pill bottom nav, brand mark — the elements
present on every screen.

### Files

- `apps/web/src/components/TopBar.tsx`
- New: `apps/web/src/components/BottomNav.tsx`
- Delete: `apps/web/src/components/NavDrawer.tsx` (replaced by the
  pill nav)
- `apps/web/src/components/BrandMark.tsx` (color treatment only)
- `apps/web/src/components/WalletStatus.tsx`

### Build steps

Per `design.md` §7:

1. **Header** — brand mark + wordmark left, wallet right. 56px
   tall. `bg` background; hairline border on scroll.
2. **Pill bottom nav** — floating pill, four items: Sell, Claims,
   Notifications (with unread dot), Profile.
   - Position: fixed at the bottom, centered, with margin from
     the safe area.
   - Active item: lime pill indicator behind the icon.
   - Unread badge: small lime dot on the Notifications icon.
   - Height ~64px; icons 24px; labels optional under each icon.
3. **Brand mark** — dark tile, lime tab, light cradle. Mark shape
   unchanged.
4. **Wallet status** — restyle to match chrome (no shadow, tokens
   from `design.md`).
5. **Remove the hamburger drawer** and the drawer references from
   `TopBar.tsx`. The drawer is superseded by the pill nav.

### Browser audit

1. Header + pill nav appear on every route.
2. Every nav item navigates to the correct route.
3. Active item visually distinct.
4. Brand mark legible at 16px (favicon), 32px (nav chip), header
   size.
5. At 320px: pill nav fits; no overflow; safe-area handling
   correct.
6. Keyboard: Tab reaches every nav item; Enter activates; focus
   ring visible.
7. Screenshots: all widths, pill nav with each item active.

### Acceptance

- Chrome + pill nav + brand mark match `design.md` §7.
- Every route shows correctly.
- Brand mark legible at all sizes.
- No 320px overflow.
- a11y: zero critical/serious; nav suite green.

---

## 7. Phase 3 — Feed / Home

**Objective:** The first screen. The demo's money shot after the
chrome.

### Files

`Home.tsx`, `SlotCard.tsx`, `SlotList.tsx`, `SearchFilters.tsx`,
`PriceDisplay.tsx`, `TimeBadge.tsx`, `AvailabilityBadge.tsx`,
`EmptyState.tsx`, `LoadingSkeleton.tsx`, `ErrorState.tsx`.

### Build steps

Per `design.md` §7:

1. Card: `surface`, `radius-card`, 16px padding. Title in `h2`.
   Category icon in circular chip.
2. Filter chips: pill, `surface-2`. Active: lime + `accent-ink`.
3. Price: `mono` + `tabular-nums`. Prominent.
4. Time badge: `small`, muted.
5. Availability: chip, muted.
6. Empty state: one line, neutral.
7. Loading: skeleton matching card layout.
8. Error: one line + "Try again" pill.

### Browser audit

1. Feed with 1, 3, 10 items.
2. Scroll behavior + stagger (capped at 8 cards).
3. Filter interaction — URL updates, state feels right.
4. Force empty state (mock empty response).
5. Force loading (throttle).
6. Force error (block API).
7. Tap targets ≥ 44px.
8. At 320px: fit, wrap, no scroll.
9. Contrast: every text pair measured.
10. Screenshots: all widths × all states.

### Acceptance

- Matches `design.md` §3, §7.
- All states render correctly.
- Prices/times/counts use `mono` + `tabular-nums`.
- AA everywhere.
- a11y green.

---

## 8. Phase 4 — Slot detail

**Files:** `SlotDetailPage.tsx`, `SlotDetail.tsx`, `ClaimButton.tsx`.

### Build steps

1. Hero: category chip, `h1` title, time, location.
2. Price block: large, `mono`, `tabular-nums`, on `surface`.
3. Details grid: WHEN / WHERE / HOW MANY.
4. Provider block: display name, small avatar.
5. Claim button: primary pill, full width, **sticky above the pill
   nav** so it stays reachable while scrolling.
6. Own-slot state: button replaced by "This is your opening."

### Browser audit

1. Default state (real slot).
2. Owner view (own slot).
3. Claim button press → scale → navigate.
4. Long title → wraps.
5. Long location → wraps.
6. Long provider → truncates.
7. At 320px: sticky button does not collide with the pill nav.
8. Keyboard: Tab, Enter activates.
9. Contrast measured.

### Acceptance

- Matches `design.md` §7.
- Claim flow starts correctly.
- No 320px overflow; no collision with pill nav.
- a11y green.

---

## 9. Phase 5 — Claim + escrow surfaces (highest priority)

**Objective:** The money moment. Take the most time here.

**Files:** `ClaimDetailPage.tsx`, `EscrowPanel.tsx`,
`VerifyDepositBox.tsx`, `ConfirmReceiptBox.tsx`,
`HoldCountdown.tsx`.

### Build steps

Per `design.md` §8 (escrow state visual language):

1. Panel: `surface`, `radius-card`. State, amount (`mono`), next
   action.
2. Deposit instruction: "Pay 1.5 USDT to hold this slot."
   Primary CTA pill.
3. Hold countdown: prominent, `mono`, `tabular-nums`.
4. Verify-deposit polling: subtle progress, not obscuring. Copy:
   "Confirming payment…"
5. Funded: lime. "Your payment is held until delivery."
6. Delivered: lime. "Confirm receipt" primary + "Dispute"
   secondary.
7. Released / refunded: terminal, calm.
8. Disputed: warning accent. Clear.

### Browser audit — every state in the browser

Force each of the eight states (via test slot + local backend, or
mocked responses):

`created`, `funded`, `delivered`, `disputed`, `releasing`,
`released`, `refunding`, `refunded`.

For each state:
- Amount shows correctly?
- Color distinct enough to be un-mistakable?
- Next action obvious?
- Countdown persists where relevant?

Additional:
- Long amounts ("1234.56 USDT") don't break layout.
- Short amounts ("0.01 USDT") look right.
- Every state at 320px.
- Keyboard: Tab reaches every action.
- Contrast: every text/color pair measured.

### Acceptance

- All eight states visually distinct per `design.md` §8.
- Amounts legible, `mono`, `tabular-nums` throughout.
- Every action clear, every outcome reassuring.
- No state looks unfinished. If a transitional state feels like a
  placeholder, it is not done.

---

## 10. Phase 6 — Sell flow + publish

**Files:** `Sell.tsx`, `SellNew.tsx`, `SellDetail.tsx`,
`SlotForm.tsx`, `PublishButton.tsx`, `MarkDeliveredForm.tsx`,
`ContactNoteForm.tsx`.

### Build steps

1. Sell list: cards matching feed style. Status pills.
2. Form: inputs `surface-2`, `radius-control`. Labels above,
   helper text below. Inline validation.
3. Publish: primary pill. Fee prompt when required.
4. Fee prompt: "Publish costs 400 NIM." Amount in `mono`.
   Primary CTA "Approve & publish."
5. Sell detail demand: buyer (truncated), status, "Mark
   delivered" pill.
6. Mark delivered: address input, inline validation.
7. Contact note: textarea, char count, save/clear.

### Browser audit

1. Empty sell list.
2. Sell list with 1, 3, 10 slots.
3. Create slot — validation fires (empty fields, bad dates, bad
   prices).
4. Publish without fee → plain publish.
5. Publish with fee → fee prompt, correct amount + copy.
6. Publish success → appears in list, status updated.
7. Demand rows per claim state.
8. Mark delivered — validation + success.
9. Contact note — save, clear, char count.
10. At 320px: forms fit, buttons reachable, pill nav not
    colliding.
11. Focus rings visible.
12. Loading + error states per async action.

### Acceptance

- Matches `design.md` §7.
- Every form validates inline.
- Fee prompt plain language, `mono` amount.
- a11y green.

---

## 11. Phase 7 — Profile / Claims / Notifications

**Files:** `Profile.tsx`, `ClaimsPage.tsx`,
`NotificationsPage.tsx`, `NotificationsSection.tsx`.

### Build steps

1. Profile: wallet, display name, logout. **No theme toggle**
   (dark-only, per D1).
2. Claims list: buyer's holds grouped by state. Slot, amount,
   state badge per row.
3. Notifications: newest first, unread indicator, "Mark all read".

### Browser audit

1. Profile with/without display name.
2. Claims list empty / 1 / 5 holds in different states.
3. Notifications empty / 1 / 5 / 20.
4. Mark all read → badge clears.
5. Tap notification → navigates + marks read.
6. All widths.
7. a11y.

### Acceptance

- All three surfaces match `design.md`.
- Empty states clear (not sad).
- Badge behavior consistent with pill nav.
- No theme toggle remains anywhere.

---

## 12. Phase 8 — Homepage sections

**Files:** `home/HowItWorks.tsx`, `home/Faq.tsx`,
`home/Contact.tsx`.

### Build steps

1. Sections below the feed on `/`.
2. Typography consistent.
3. FAQ uses native `<details>`.
4. Contact is mailto, no form.

### Browser audit

1. Feed → How it works → FAQ → Contact.
2. FAQ expand/collapse.
3. Contact mailto works.
4. At 320px: sections stack cleanly.
5. Contrast.

### Acceptance

- Matches `design.md`.
- No emojis, no marketing slop.
- a11y green.

---

## 13. Phase 9 — Dialogs + state components

**Files:** `ReportDialog.tsx`, `ResolveDialog.tsx`,
`DisableDialog.tsx`, `CancelConfirmDialog.tsx`, `EmptyState.tsx`,
`LoadingSkeleton.tsx`, `ErrorState.tsx`.

### Build steps

1. Dialogs: `surface`, `radius-card`, scrim `bg/80`. Motion per
   `design.md` §4. Focus trap via existing `useDialogFocus`.
2. Empty / Loading / Error: consistent across all uses.

### Browser audit

1. Open each dialog. Every state (empty, filled, error,
   submitting, success).
2. Escape closes. Focus returns. Tab cycles.
3. Every empty, loading, error state across the app.
4. Screenshots.

### Acceptance

- Every dialog consistent.
- Every state primitive consistent.
- a11y green.

---

## 14. Phase 10 — Boring-things pass

**Objective:** The pass that separates "AI-generated" from
"finished." Not a redesign — a systematic audit of everything that
isn't the happy path.

### What the agent audits (all surfaces)

1. **Loading states** — every async action, forced slow.
2. **Empty states** — every list, forced empty.
3. **Error states** — every async action, forced error.
4. **Validation** — every form, bad input.
5. **Mobile responsiveness** — every screen at 320px.
6. **Navigation** — every link, back button round-trip.
7. **Feedback after actions** — every mutation (claim, deposit,
   publish, mark delivered, confirm) shows clear success/fail.
8. **Accessibility** — full keyboard pass, screen reader labels.
9. **Consistency** — same button, spacing, tone across screens.
   The agent puts two screens side by side and compares.

### Deliverable

`docs/redesign/BORING-THINGS-AUDIT.md` — checklist, each item
pass/fail/fixed, with a screenshot or observation.

### Acceptance

- Every item accounted for.
- Every fail fixed (or flagged with a reason).
- a11y suite 40/40.
- No screen looks unfinished.

---

## 15. Phase 11 — Admin (inherit only)

**Files:** `routes/admin/*.tsx`, `AdminTable.tsx`, `AdminTile.tsx`.

### Build steps

1. Confirm all admin surfaces render with the new tokens.
2. Fix only what's broken (e.g., a chip that no longer contrasts).

### Browser audit

Every admin screen at all four widths. Every table, tile, form,
dialog.

### Acceptance

- Admin renders cleanly.
- No new colors/patterns.
- a11y green.

---

## 16. Phase 12 — Final sweep + refine the skill

**Objective:** Confirm the app is finished, then consolidate
everything learned into the skill's reference files for future
work.

### Final sweep

1. Walk every route in the app, in order. Screenshot each.
2. Full flow: provider publishes → 400 NIM → slot live → buyer
   browses → claims → deposits → provider delivers → buyer
   confirms → released.
3. Functional behavior unchanged.
4. Full battery: typecheck, lint, tests, build, a11y.

### Refine the skill

Read:
- `design.md` (the design system)
- `docs/redesign/CORRECTIONS.md` (every correction made during
  build)
- `docs/redesign/DECISIONS.md` (every non-obvious choice)

Then update the skill's reference files:

**`.opencode/skills/takeover-frontend/references/design-system.md`**
— sharpen with anything corrected during the build. Do not
restate `design.md`; reference it. Add only the rules that emerged.

**`.opencode/skills/takeover-frontend/references/mistakes-to-avoid.md`**
— the most valuable file. Distill `CORRECTIONS.md` into a list:

```
- Do not put the lime accent on more than one primary element per
  screen.
- Do not use marketing voice ("Discover your next..."). Use plain
  statements ("Find a slot").
- Do not let the primary CTA sit at the card edge — always 16px
  breathing room.
- ...
```

**`.opencode/skills/takeover-frontend/references/preferred-patterns.md`**
— distill `DECISIONS.md` into patterns:

```
- Multi-state surfaces use the state table in design.md §8.
- Numerals always use mono + tabular-nums. No exceptions.
- Circular icon chips are reserved for category + brand + nav.
  Never for decorative use.
- ...
```

**`.opencode/skills/takeover-frontend/references/workflows/build-section.md`**
(NEW) — the reusable workflow:

```
1. Read design.md and the skill's reference files.
2. Read the surface's current implementation.
3. Build/redesign following component-patterns.md.
4. Run the audit script on the surface.
5. Walk every state (default, loading, empty, error, focus,
   disabled, success).
6. Screenshot at 320/375/768/1280.
7. Measure contrast (from the audit JSON).
8. Fix issues found.
9. Re-audit.
10. Report + STOP.
```

**`.opencode/skills/takeover-frontend/references/workflows/browser-audit.md`**
(NEW) — the audit checklist itself, so any future session can
invoke it.

### Acceptance

- Full flow works end-to-end.
- Battery green.
- Skill's reference files updated with the distilled learnings.
- Final commit.

---

## 17. Global rules for every phase

1. **Never batch phases.** One at a time. Report, STOP, wait.
2. **Always audit in browser** — via the audit script (or manual
   procedure). Screenshots are part of the deliverable.
3. **Never declare a phase done without visual confirmation.**
4. **`design.md` wins every disagreement.** If a decision isn't
   covered, extend it first, then code.
5. **Log corrections continuously** — `CORRECTIONS.md` and
   `DECISIONS.md` are updated during the phase, not at the end.
6. **AA contrast non-negotiable.** Adjust values, never rules.
7. **Motion under 300ms.** Always.
8. **`prefers-reduced-motion` respected.** Always.
9. **No new dependencies** beyond what Phase 0 approves
   (Playwright). No new icons beyond budget without justification.
10. **No business-logic changes.** Visual redesign only.
11. **The plan is a living document.** If a phase reveals
    something the plan missed, update the plan — don't improvise.

---

## 18. Report format (every phase)

```
PHASE X — [name]

FILES CHANGED
- path (new / modified)
- ...

BROWSER AUDIT
- Viewport 320: [observation]
- Viewport 375: [observation]
- Viewport 768: [observation]
- Viewport 1280: [observation]
- States checked: [list every state]
- Interactions exercised: [list]
- Issues found and fixed: [list]
- Issues found and NOT fixed: [list + reason]
- Contrast: [measured ratios for any new pairs]
- Screenshots: [paths under docs/redesign/audits/]

CORRECTIONS LOGGED
- [link to docs/redesign/CORRECTIONS.md entries added this phase]

DECISIONS LOGGED
- [link to docs/redesign/DECISIONS.md entries added this phase]

BATTERY
- typecheck: exit 0
- lint: exit 0
- tests: [counts]
- build: exit 0
- a11y: [count]

DEVIATIONS
- ...

RESIDUALS
- ...

CONFIRM: Phase X passes browser audit.
STOP.
```

---

## 19. How to use this plan with OpenCode

1. **Setup once** — Phase 0 creates
   `.opencode/skills/takeover-frontend/` and `docs/redesign/`.
2. **Give OpenCode `design.md` and this plan** at the start of
   each session.
3. **OpenCode reads the skill's reference files directly** (do not
   rely on the skill tool — auto-discovery is broken here).
4. **OpenCode does Phase 0.** Reports. Waits.
5. **You confirm** and tell it to proceed to Phase 1.
6. **Repeat per phase.** After each: read the report, look at the
   screenshots, look at the app yourself, confirm or correct.
7. **OpenCode logs every correction** to `CORRECTIONS.md` as it
   happens.
8. **At Phase 12**, OpenCode consolidates into the skill's
   reference files.

The skill becomes the persistent design memory. Any future
OpenCode session in this repo reads it and starts with the right
instincts — no re-learning required.

---

## 20. Why this structure works

- **`design.md` is the "what"** — the vision, rules, tokens.
- **This plan is the "how"** — the phase breakdown and audit
  method.
- **`.opencode/skills/takeover-frontend/` is the "memory"** —
  what OpenCode reads (via the reference files, since auto-
  discovery is broken) to stay on-brand.
- **`CORRECTIONS.md` is the "taste log"** — what you actually
  corrected, distilled into rules.
- **`DECISIONS.md` is the "pattern log"** — every non-obvious
  choice and its rationale.

Each file has one job. Together they make the redesign repeatable,
auditable, and — most importantly — **improvable**. The next
frontend change starts from a documented system, not from zero.