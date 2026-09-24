# TAKEOVER — Design

**Status:** Source of truth for the frontend.
**Scope:** Every visual, interactive, and copy decision in `apps/web`.
**Rule:** If a design decision isn't covered here, the answer is
"make it match the spirit of what's here." If a decision here
conflicts with a decision elsewhere, this file wins.

---

## 1. North star

TAKEOVER should feel **confident and premium** — the kind of app you
trust with your money on the first use. Not loud. Not decorative.
Not a casino, not a SaaS dashboard, not a crypto product. A person
opens it because something they need just became available, and
they're about to pay real money for it. The app's job is to feel
like the fastest, cleanest, most certain path from "I want this" to
"I have it."

Dark by default. High contrast. One accent color used with
discipline. Rounded, tactile, calm. The interface is a tool, not a
showcase — but it should look like a tool that costs money and is
worth it.

Two feelings must land on first open:
1. **"This is serious."** — the money, the escrow, the provider.
2. **"This is easy."** — claim it, pay it, done.

Everything in this document serves those two feelings.

---

## 2. Audience

**The buyer.** Someone who needs something *now* — a table tonight,
a court this evening, a seat in the next hour. They're on a phone,
in a hurry, and about to spend real money on an uncertain purchase.
They need to feel the app is on their side: clear price, protected
payment, refund if it goes wrong. They do not care about
blockchain. They care about "will I get what I paid for."

**The provider.** Someone with a slot to release — a restaurant
with an empty table, an instructor with a last-minute cancellation.
They're on a phone, they want to list fast, and they want to know
someone's coming. They care about "did anyone claim it" and "am I
getting paid."

Both are on **mobile, inside the Nimiq Pay WebView**. Both are
authenticated by a Nimiq wallet. Neither should ever see the word
"blockchain," "smart contract," "on-chain," or "crypto" in the
primary UI.

---

## 3. Visual language

### 3.1 Palette

A near-black base, a single electric-lime accent, a disciplined
neutral ramp. Nothing else, unless semantic (danger, warning).

| Token | Value | Use |
|---|---|---|
| `bg` | `#0A0A0A` | App background (the deep base) |
| `surface` | `#141414` | Cards, panels, list items |
| `surface-2` | `#1C1C1C` | Elevated / nested surfaces, inputs, chips |
| `border` | `#262626` | Hairlines between surfaces |
| `border-strong` | `#333333` | Focus outlines, active borders |
| `text` | `#FAFAFA` | Primary text (not pure white — softer on the eyes) |
| `text-muted` | `#A3A3A3` | Secondary text, metadata, timestamps |
| `text-faint` | `#6B6B6B` | Tertiary, placeholders, disabled |
| `accent` | `#C4F135` | The signature lime — CTAs, active states, the brand |
| `accent-hover` | `#B5E52C` | Hover / pressed variants of the lime |
| `accent-ink` | `#0A0A0A` | Text and icons sitting **on** the lime |
| `danger` | `#F87171` | Errors, destructive actions, dispute states |
| `warning` | `#FBBF24` | Caution, in-review, timeout states |

**Rules:**
- The lime accent is a **highlight**, not a background. It appears
  on ≤10% of any given screen. A screen bathed in lime loses its
  power. When in doubt, use less.
- Every text/background pair must pass **WCAG AA** (4.5:1 for text,
  3:1 for UI). The lime on near-black passes easily. Lime-on-cream
  would not — see §9 if a light mode is ever added.
- Never use pure black (`#000`) or pure white (`#FFF`).
- Do not introduce a second hue. Status colors (danger, warning)
  are functional, not decorative.

### 3.2 Surface hierarchy

Depth is built by **surface value shifts and hairlines**, not by
shadows. The reference app is almost shadow-free — elevation reads
through lighter surfaces, not blurred shadows.

Three layers, and only three:

1. **Base** (`bg`) — the page itself.
2. **Card** (`surface`) — slots, panels, list rows, modals.
3. **Inset** (`surface-2`) — inputs, chips, badges, nested surfaces
   inside cards.

Borders (`border`, `border-strong`) separate surfaces where the
value shift alone isn't enough — e.g., between two stacked cards,
or around an input on a card.

**No drop shadows** except for floating overlays (modals,
drawers, the nav pill). Those get a single soft shadow — dark,
wide, low-opacity — used only to separate the overlay from the
page beneath.

### 3.3 Typography

**Family:** Poppins (body) + Big Shoulders Display (display steps),
self-hosted as latin-subset woff2 (Phase 3b, SIL OFL) — no runtime
CDN. The system stack remains the fallback under both faces and the
sole mono stack. (The system-only rule stood through Phase 3; the
reference's typefaces required real faces, so the owner locked D7/D8.)

```
--font-sans: Poppins, ui-sans-serif, system-ui, -apple-system,
              "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-display: "Big Shoulders Display", Poppins, ui-sans-serif,
              system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

`display`, `h1`, and `h2` render in the display face; `h3`, `body`,
and `small` in Poppins; every figure stays system mono. The
mono rule below is load-bearing: Poppins numerals are proportional,
so any number set in a display/body face would shift width.

**Scale** (mobile-first, all values in `rem`):

| Token | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 1.875rem / 30px | 700 | -0.02em | Marketing headlines, end-cards |
| `h1` | 1.5rem / 24px | 700 | -0.02em | Screen titles, slot titles |
| `h2` | 1.25rem / 20px | 600 | -0.01em | Section headers, card titles |
| `h3` | 1rem / 16px | 600 | -0.01em | Subsection titles |
| `body` | 0.875rem / 14px | 400 | 0 | Default text |
| `small` | 0.75rem / 12px | 500 | 0.01em | Metadata, timestamps, helper text |
| `mono` | 0.875rem / 14px | 500 | 0 | All numbers — prices, amounts, counts |

**Rules:**
- **All numeric content uses `mono` with `tabular-nums`.** Prices,
  USDT amounts, NIM fees, countdowns, counts, dates. This is
  non-negotiable — money must never shift width.
- Headings tighten with size (negative tracking at `display`/`h1`,
  neutral at `body`). This is the difference between a template
  and a designed system.
- Never use more than three sizes on a single screen.
- Line height: 1.15–1.2 for display/h1, 1.3 for h2/h3, 1.5 for
  body/small.

### 3.4 Spacing

Base unit: **4px**. All spacing is a multiple.

```
0.5 =  2px   (hairline padding, rare)
1   =  4px
1.5 =  6px
2   =  8px   (icon gaps, chip padding)
3   = 12px   (input padding, small gaps)
4   = 16px   (card inner padding, screen gutters)
5   = 20px
6   = 24px   (section gaps)
8   = 32px   (major section breaks)
12  = 48px   (screen bottom padding above nav)
```

**Screen gutters:** 16px on mobile, 24px on tablet+. Never edge-to-
edge content on a phone.

**Vertical rhythm:** 16px between related elements, 24px between
sections, 32px between major blocks.

### 3.5 Radii

The reference's shape language is the biggest visual signal. Three
radii, and they map to element class:

| Token | Value | Use |
|---|---|---|
| `radius-card` | `24px` | Cards, panels, modals, the bottom-nav pill |
| `radius-control` | `16px` | Buttons (non-pill), inputs, larger chips |
| `radius-chip` | `12px` | Tags, badges, small chips |
| `radius-pill` | `9999px` | Primary CTAs, the nav bar, active indicators |

**Rules:**
- **Primary buttons are pills.** Full radius. This is the reference's
  strongest signature and it should carry.
- **Cards are 24px**, not pills — they need room for content.
- **Inputs are 16px.** Rounded, not pill, not square.
- The border radius of a child should never exceed the radius of
  its parent card.

### 3.6 Iconography

- **Library:** `lucide-react` (already a dependency). Do not add
  another.
- **Style:** thin stroke (default 1.5–2px), rounded caps, no fills
  except for the active state.
- **Size:** 16px inline, 20px in buttons, 24px in the nav.
- **Container:** icons that act as buttons sit inside a circular
  chip (32px or 40px diameter) with either a `surface-2` fill or
  the lime accent — see §7.
- **Budget:** 12 icons total across the app. Reuse before adding.
  Any new icon needs justification.

### 3.7 Imagery

TAKEOVER slots have no images today (no schema field). The
redesign must **not** depend on photography.

Instead:
- **Category icons** carry visual identity per slot type
  (restaurant, class, court, appointment). One icon per category,
  rendered in a circular chip on the slot card.
- **Provider avatars** are initial-based circles (first letter of
  the provider display name), no photos.
- If photography is added later (separate phase), cards should
  support an image slot without redesigning the layout — the
  header area of a slot card is where it would go.

---

## 4. Motion

Motion is **functional**, not decorative. Every animation exists to
clarify a change of state. If it doesn't clarify, remove it.

**Tokens:**

```
duration-press:  120ms
duration-ui:     200ms
duration-panel:  280ms

ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)   // entrances
ease-in-out:     cubic-bezier(0.77, 0, 0.175, 1)  // exits, modals
ease-drawer:     cubic-bezier(0.32, 0.72, 0, 1)   // the nav drawer
```

**What animates:**
- Button press: `scale(0.97)`, 120ms, ease-out. All CTAs.
- Card entrance: `opacity 0→1` + `translateY(8px→0)`, 200ms,
  ease-out. Staggered 40ms per card, capped at 8 cards.
- Drawer open/close: `translateX(-100%→0)`, 280ms, ease-drawer.
- Modal open/close: `opacity` + `scale(0.96→1)`, 200ms, ease-out.
- Focus rings: instant appearance, no transition.

**What does NOT animate:**
- Never `transition: all`.
- No fade-to-black between screens.
- No page-level route transitions.
- No hover-lift on cards.
- No shimmer beyond the existing skeleton loader.
- No scroll-linked animations.
- No animation on the theme toggle (if a light mode ever exists).
- No scale-from-zero entrances.

**Reduced motion:** every animation respects
`prefers-reduced-motion: reduce`, which collapses durations to 0
and disables transform-based motion.

---

## 5. Copy tone

**The voice:** direct, clear, respectful. Explains how things work
without patronizing. Never exclaims. Never markets. Every line
earns its place.

**Rules:**
- Short sentences. One idea per sentence.
- No jargon. No "escrow" in the primary UX — use "held safely" or
  "held until delivery." No "smart contract," "on-chain,"
  "blockchain," "crypto."
- No exclamation marks.
- No emojis in UI copy.
- No "Congrats!" or "Awesome!" — the user did a transaction, not a
  level-up.
- Numbers are stated plainly: **"1.5 USDT"**, not **"1.50 USDT"**,
  not **"1.5 USDT"**. Same format everywhere.
- Time is always local and unambiguous: **"Today, 6:00 PM"**, not
  **"in 4 hours"**.

**Example lines (good):**

| Context | Copy |
|---|---|
| Empty feed | "Nothing available right now. Check back soon." |
| Loading | *(skeleton, no text)* |
| Claim button | "Claim this slot" |
| Hold countdown | "Held for 9:42" |
| Deposit step | "Pay 1.5 USDT to hold this slot" |
| Escrow funded | "Your payment is held until delivery." |
| Delivered, buyer view | "The provider marked this delivered." |
| Confirm button | "Confirm receipt" |
| Released | "Payment released." |
| Refunded | "Refunded to your wallet." |
| Fee prompt | "Publish costs 15 NIM." |
| Error (network) | "Couldn't reach the server. Try again." |
| Error (wallet) | "Open Nimiq Pay to continue." |

**Example lines (bad — do not write these):**
- "🎉 Your slot is ready!"
- "Revolutionizing last-minute bookings"
- "Smart contract escrow protects your funds"
- "Oops! Something went wrong 😅"

---

## 6. Flows

**Buyer:**
1. Feed → browse slots
2. Slot detail → read time, price, availability
3. Claim → hold starts, countdown visible
4. Deposit → pay USDT, held safely
5. Wait → provider delivers
6. Confirm → funds release
7. (or) Dispute → admin resolves

**Provider:**
1. Sell → create a slot
2. Publish → pay 15 NIM fee
3. Manage → see who claimed
4. Mark delivered → hand off
5. Get paid → funds release on buyer confirmation

Every screen in these flows must answer two questions in under two
seconds: **"What is happening?"** and **"What do I do next?"**

---

## 7. Component patterns

**The primary button.** Pill. Lime background, near-black text.
Pressed: `scale(0.97)`. Disabled: `surface-2` background,
`text-faint` text, no scale. Full-width on mobile forms.

**The secondary button.** Pill outline. Transparent background,
`border-strong` border, `text` text. Same motion.

**The card.** `surface` background, `radius-card`, 16px padding,
no shadow. Children sit inside with 12–16px gaps. No nested cards
within cards.

**The chip / tag.** `radius-chip` or pill, `surface-2` fill,
`text-muted` text, 6–8px vertical padding. Used for status, filter
state, and metadata.

**The circular icon chip.** 32 or 40px circle. Used for the brand
mark tile, category icons, and actionable icons in a header.
Lime fill is reserved for **active** or **primary** states.

**The input.** `surface-2` fill, `radius-control`, 12px padding,
`text` text, `text-faint` placeholder. Focused: `border-strong`
ring, no color shift.

**The nav.** Floating pill at the bottom on mobile. Contains 4
items (Sell, Claims, Notifications, Profile). Active item: a lime
pill indicator behind the icon. Badge for unread notifications:
small lime dot, top-right of the icon.

**The header.** Brand mark + wordmark top-left. Wallet status
top-right. One row, 56px tall, `bg` background, no border unless
scrolled (then a `border` hairline appears).

---

## 8. Escrow state visual language

Eight states. Each has a distinct visual treatment so a user can
tell at a glance where they are.

| State | Accent | Icon chip | Copy |
|---|---|---|---|
| `created` | Neutral (`surface-2`) | Clock | "Waiting for payment" |
| `funded` | **Lime** | Lock | "Held until delivery" |
| `delivered` | **Lime** | Package | "Marked delivered" |
| `disputed` | `warning` | Alert | "In review" |
| `releasing` | Lime, pulsing | Arrow up | "Releasing…" |
| `released` | Lime | Check | "Released" |
| `refunding` | Neutral | Arrow down | "Refunding…" |
| `refunded` | Neutral | Return | "Refunded" |

**Rules:**
- Only `funded`, `delivered`, `releasing`, and `released` carry the
  lime accent — these are the states where the user's money is
  working as intended.
- `disputed` is the only state using `warning` (amber). It is not
  an error, but it needs attention.
- `refunding` and `refunded` are neutral. A refund is not a
  failure — it's the system working.
- Dollar amounts are always visible in `mono` at the state's
  primary size, never hidden behind a tap.

---

## 9. Anti-patterns

TAKEOVER should never look or feel like:

- **A casino.** No flashing, no rewards popups, no "you might win,"
  no confetti.
- **A crypto product.** No wallet addresses in the primary UI, no
  chain names, no gas estimates, no "connect wallet" language
  beyond what's necessary for auth.
- **A generic SaaS dashboard.** No data-viz charts, no KPI tiles,
  no admin-first layout on the consumer surface.
- **A startup template.** No hero gradient, no "features grid," no
  fake testimonials, no "trusted by thousands."
- **A Dribbble shot.** No drop shadows stacked for depth, no glow
  orbs, no glassmorphism, no decorative motion.

If a screen looks like any of the above, it's wrong — even if it's
"pretty." Come back to §1 and rebuild.

---

## 10. Accessibility

Non-negotiable commitments:

- **Contrast:** every text/background and UI/background pair passes
  WCAG AA in every mode kept. Measured programmatically, not
  eyeballed.
- **Keyboard:** every interactive element is reachable by Tab and
  activates on Enter/Space.
- **Focus:** a visible focus ring on every focusable element.
  Never `outline: none` without a replacement.
- **Reduced motion:** all motion collapses when the user's system
  requests it.
- **Screen readers:** every icon that conveys meaning has an
  accessible label; decorative icons are `aria-hidden`.
- **Touch targets:** 44×44px minimum for anything tappable,
  including nav items and icon chips.
- **Color is never the only signal.** Status is carried by icon +
  label + color, not color alone.

---

## 11. Working method

Design is done **section by section**, not in one pass:

1. Build one section.
2. Open it in a browser. Click through it. Inspect every state
   (default, loading, empty, error, success, focus, disabled).
3. Look at it at 320px, 375px, 768px, and 1280px.
4. Fix what's wrong.
5. Move to the next section.

Never batch sections. Never declare a section "done" without seeing
it in a real browser. The difference between "AI-generated" and
"finished" is entirely in this loop.

---

## 12. How to use this document

- **Before any visual change**, read this file.
- **When a decision isn't covered**, extend this file with a
  new section — do not improvise silently.
- **When a decision here conflicts with a decision in code**,
  this file wins. Update the code.
- **When the file itself is wrong**, change the file first,
  then change the code. Never the reverse.

This is the source of truth. Treat it like one.