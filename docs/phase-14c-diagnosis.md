# Phase 14c — Diagnosis: session cookie loss inside Nimiq Pay (Risk A CONFIRMED)

Date: 2026-09-14. Status: **DIAGNOSIS ONLY. No code changed. Owner review required
before any auth/session/CSRF implementation.**

Phase 14b (human, real Android device, real wallet, inside Nimiq Pay) confirmed
Risk A: connect succeeds (address shows), then "Claim this opening" and Profile
(`/me`) both fail with "authentication required". The server creates the session
row; subsequent requests arrive without the `takeover_session` cookie, so the
server correctly returns 401. Risks B, C, D remain untested (blocked behind auth).

## 1. Verdict

The session cookie is a **cross-site (third-party) session cookie**, and the
Nimiq Pay Android WebView is dropping it under its third-party-cookie policy —
a per-WebView setting controlled by the Nimiq Pay app, not by our server
headers. `SameSite=None; Secure` is necessary but **not sufficient**: on Android
WebView, third-party cookies default to **disallowed** for apps targeting API 21+
unless the host app explicitly opts in per WebView, and Nimiq Pay documents
nothing about its cookie policy. No server-side `Set-Cookie` attribute tuning
(short of `Partitioned`, which is unproven here) can override the host app's
cookie policy. The robust fix is the documented Bearer-token fallback
(Option 2), keeping the cookie path intact for browsers that accept it.

## 2. Investigation (all six items)

### 2.1. Exact production `Set-Cookie` attributes — CONFIRMED (code + live)

Code: `apps/api/src/auth/session.ts:28-44` (`sessionCookieOptions()`):

- prod: `{ path: '/', httpOnly: true, secure: true, sameSite: 'none' }`
- dev: `{ path: '/', httpOnly: true, secure: false, sameSite: 'lax' }`
- No `Domain`, no `Max-Age`/`Expires` in either environment.
- Set at `apps/api/src/routes/auth.ts:192` (`setSessionCookie(reply, token.token)`);
  cleared with the same options at `session.ts:114-116`.

Live (2026-09-14, throwaway `@nimiq/core` keypair against
`https://takeover-api-production-1511.up.railway.app`, residue fully removed —
1 user, 1 session, 1 challenge, 1 audit row deleted; counts only, no secrets):

```text
challenge -> 200; verify -> 200 (user object present)
SET-COOKIE: takeover_session=<redacted-token>; Path=/; HttpOnly; Secure; SameSite=None
```

Verbatim modulo the redacted 81-char `<sessionId>.<secret>` token. The server
emits exactly what the code says: `Path=/; HttpOnly; Secure; SameSite=None`,
host-only (no `Domain`), **session cookie** (no `Expires`/`Max-Age`). The server
side is healthy; the drop happens client-side in the WebView.

### 2.2. Session cookie vs persistent — CONFIRMED session cookie

Both the code (§2.1) and the live capture show no `Expires`/`Max-Age`, so the
cookie lives in the WebView's in-memory jar and dies with the WebView/session.
Two consequences:

1. Session cookies are the most fragile kind in WebViews (no persistence via
   `CookieManager.flush()`, gone if Nimiq Pay destroys the WebView).
2. **Adding `Max-Age` alone would NOT fix this case**: a persistent
   third-party cookie is still a third-party cookie and is blocked by the same
   policy. Persistence only helps the orthogonal "cookie accepted but lost on
   restart" failure, which is not what 14b shows (failure is immediate).

Server session lifetime is 7 days fixed (`SESSION_TTL_MS` in
`apps/api/src/auth/challenge.ts:5`, set at `routes/auth.ts:190`). Note for the
completion pass (non-blocking doc drift, not the cause): ARCHITECTURE.md §4.2
says "7 days with sliding renewal on authenticated use", but the code only
bumps `lastSeenAt` (`session.ts:97`) and never extends `expiresAt`. Either
implement sliding or fix the doc; keep the Bearer TTL identical to whatever the
cookie session uses.

### 2.3. Cross-site / third-party — CONFIRMED by topology + platform defaults

- Frontend top-level document: `https://takeover-web-gamma.vercel.app`.
- API: `https://takeover-api-production-1511.up.railway.app`.
- Different registrable domains sharing no private suffix → **cross-site** by
  the Public-Suffix-List-based site definition. The Railway `Set-Cookie` on a
  Vercel-top-level page is therefore a **third-party cookie**, regardless of
  `SameSite=None`.
- Android platform default (cited):
  - `developer.android.com/reference/kotlin/android/webkit/CookieManager` —
    `setAcceptThirdPartyCookies(WebView, boolean)` is a **per-WebView app
    policy**; "Apps targeting LOLLIPOP or later **default to disallowing**
    third party cookies."
  - `chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/cookies.md`
    — WebView does not use the browser's content-settings map; cookie
    permissions are delegated to the app developer per WebView.
  - Nimiq Pay targets a modern API level (2026 app), so the default applies
    unless Nimiq Pay explicitly opted its Mini App WebView in. **Nimiq Pay does
    not document this** (full FAQ at `https://nimiq.dev/mini-apps/faq` checked
    2026-09-14: no mention of cookies, `CookieManager`, third-party-cookie
    policy, `Origin` headers, or storage — it only says mini apps "can call any
    external API using `fetch()`" and to "treat the WebView like any other
    browser", which is exactly the sanctioned pattern our cross-site `fetch`
    follows).
- Desktop-Chrome context (why this surprises): Google scrapped full
  third-party-cookie deprecation (The Verge, 2025-04-22; Privacy Sandbox wound
  down Oct 2025 with CHIPS retained), so desktop Chrome still accepts
  `SameSite=None; Secure` third-party cookies by default. Android WebView never
  followed that default — its default is deny. Testing in desktop Chrome (or a
  regular mobile browser) cannot reproduce this failure.

### 2.4. Would `Partitioned` (CHIPS) help? — PLAUSIBLE, UNCONFIRMED, not sufficient alone

Facts (cited):

- Requirements: `Secure` + `SameSite=None` + `Partitioned`
  (MDN "Cookies Having Independent Partitioned State (CHIPS)";
  `privacysandbox.google.com/cookies/chips`). Production already sends the
  first two, so adding `Partitioned` is a one-line, additive, backward-safe
  server change: clients that don't recognize the attribute ignore it and fall
  back to `SameSite=None; Secure` behavior.
- Library support: installed `@fastify/cookie@11.1.2` already types
  `partitioned?: boolean` in `SerializeOptions`
  (`node_modules/@fastify/cookie/types/index.d.ts`). No new dependency needed.
- Chromium support floor: CHIPS shipped in Chrome/WebView 114 (2023); any
  2026 device WebView (updated via Play Store independently of Nimiq Pay)
  supports it. But **Nimiq Pay does not document** which WebView version it
  embeds or its cookie policy, and whether Nimiq Pay's WebView configuration
  delivers partitioned third-party cookies when unpartitioned ones are blocked
  is **version- and configuration-dependent and untestable from here**.
- Operational caveat if adopted: a partitioned cookie is double-keyed to the
  **top-level site**. We currently have two Vercel URLs in play (alias
  `takeover-web-gamma.vercel.app` and deployment
  `takeover-gnyxd4jmi-uhhh2.vercel.app`): sessions set under one partition key
  are invisible under the other. Unpartitioned cookies (where allowed) roam;
  partitioned ones do not. Pin one canonical frontend URL before relying on it.
- Conclusion: `Partitioned` is cheap, safe, and *might* fix newer WebViews on
  its own, but it cannot be verified without a device and is not guaranteed —
  if Nimiq Pay blocks third-party cookie *storage* outright, partitioned
  cookies go with it. Do not ship it as the sole fix and hope.

### 2.5. Top-level document vs iframe — 14a note VERIFIED, with one clarification

- Official docs (`https://nimiq.dev/mini-apps`, "How It Works", fetched via
  search 2026-09-14): "Mini apps **run in a WebView**", "like a specialized
  web browser embedded within Nimiq Pay"; "your mini app loads in the Nimiq Pay
  app" and talks to the host "through injected providers".
- Installed SDK confirms injection into the top-level document:
  `node_modules/@nimiq/mini-app-sdk/dist/index.js` — `init()` only polls
  `window.nimiq`; `dist/index.d.ts` types `window.nimiq` / `window.nimiqPay`
  as injected globals. The README documents `init()` + `window.nimiq` access
  and a `requestDeviceIdentifier` host API — an iframe postMessage bridge would
  look nothing like this. There is no framing origin, so the 14a conclusion
  stands: **no CSP `frame-ancestors`/allow-framing work needed**.
- Clarification (this is the point the 14a note left implicit): "top-level
  document" does **not** make the API cookie first-party. First-/third-party
  is computed per *request* against the top-level site: page site
  `takeover-web-gamma.vercel.app` vs cookie domain
  `takeover-api-production-1511.up.railway.app` = cross-site = third-party
  cookie rules apply to both the `Set-Cookie` (SET) and the `Cookie` (SEND).
  No iframe is required for this failure.

### 2.6. SET-drop vs SEND-block — cookie ABSENT either way; exact half needs a device

Error-string forensics (no device needed):

- "authentication required" is emitted in exactly one place:
  `apps/api/src/auth/session.ts:105` — `requireAuth` → 401 `UNAUTHENTICATED`.
- The Phase 12 CSRF guard (`apps/api/src/http/csrf.ts:29-45`) **skips**
  requests with no session cookie ("no cookie means nothing to steal") and
  403s (`FORBIDDEN_ORIGIN` / `MISSING_CLIENT_HEADER`) only when a cookie IS
  present. The claim POST in 14b returned 401, not 403 → **the cookie was
  absent on the request**. Had the cookie been sent with a wrong/missing
  `Origin`, we would have seen 403 `FORBIDDEN_ORIGIN` instead.
- The in-memory vs persisted split explains observations 1–4 exactly:
  `apps/web/src/store/auth.ts:55-59` sets `authenticated` + address from the
  `/auth/verify` **response body** (works — observation 2), while every later
  call (`refresh()` → `/me` at `auth.ts:74-81`, claim POST) depends on the
  cookie (fails — observations 3, 4). This also rules out "verify failed":
  the session row exists.
- Whether the WebView rejected the `Set-Cookie` (SET) or stores it but refuses
  to send it (SEND) is **indistinguishable from the server** and needs the
  device check below. Chromium with third-party cookies disabled does both
  consistently; the fix is identical either way, so this is diagnostic detail,
  not a fork in the plan.

## 3. Fix options compared

### Option 1 — Cookie-config change (server-only)

Candidates: add `Partitioned`; add `Max-Age`; change `SameSite`; set `Domain`.

- `SameSite`: `None` is already the only correct value for this topology.
  `Lax`/`Strict` would **break** the cookie in *all* cross-site browsers, not
  just the WebView. Do not change.
- `Domain`: there is no shared parent domain between `vercel.app` and
  `railway.app` (public suffixes block it). Cannot help. Do not set.
- `Max-Age`: converts session → persistent cookie. Does not change
  third-party status; blocked by the same policy. Harmless but not a fix.
- `Partitioned`: the only attribute that can plausibly restore third-party
  delivery (see §2.4). One line, no contract change, no new dependency, CSRF
  guard untouched, dev flow untouched (`Lax` in dev, no `Partitioned` needed
  for same-site local dev). But: unconfirmed without a device, partition-key
  binds to one frontend URL (alias discipline required), and fails entirely if
  Nimiq Pay blocks third-party storage outright.
- Security: no weakening anywhere. CSRF guard runs unchanged on the cookie path.

### Option 2 — Bearer-token fallback (documented workaround) — RECOMMENDED

Design (smallest correct form):

- Server returns the **existing raw session token** (`<sessionId>.<secret>`,
  already generated at `routes/auth.ts:185`) in the `POST /auth/verify`
  response body (additive field; cookie still set as today). No new table, no
  new credential type, no new dependency: the Bearer token **is** the session
  token, verified by the same constant-time hash compare
  (`session-token.ts:56-63`) against the same `sessions` row, same 7-day TTL,
  same revoke-on-logout.
- Server accepts `Authorization: Bearer <token>` as an **alternate
  presentation** of the same session when the cookie is absent (cookie wins if
  both present). Everything downstream (`requireAuth`, owner checks, admin
  guard, rate limiters) is unchanged.
- Frontend stores the token in **`sessionStorage`** (not memory-only, not
  `localStorage`): memory-only loses auth on every reload (Phase 14
  acceptance explicitly includes reload/session behavior); `localStorage`
  persists across restarts and widens the theft window with no UX benefit for
  a 7-day session; `sessionStorage` survives reloads, dies with the
  tab/WebView session, and matches the current session-cookie semantics most
  closely. `apiFetch` attaches it only when set. Cookie path stays preferred:
  if the cookie arrives, the server uses it and the header is redundant.
- CSRF interaction (explicit, per locked decision 2 — **requires owner
  approval, not implemented here**): the Phase 12 guard exists because
  browsers **auto-attach** cookies. A Bearer token is never auto-attached, and
  sending `Authorization` cross-origin forces a CORS preflight that is already
  allowlist-gated (`app.ts:41-54`), so a foreign origin can neither send the
  header nor read the response. The guard may therefore legitimately **skip
  the Origin/header requirement for requests authenticated *solely* via a
  valid Bearer token** (no cookie present). The CORS allowlist remains the
  boundary; the cookie path keeps the guard **unchanged**. If the owner
  rejects the exemption, the fallback still works by sending both credentials
  and the client header — state the decision in the approval.
- Logout revokes **both** paths: server deletes/revokes the session row
  (as today, `routes/auth.ts:204-210`) and the client clears `sessionStorage`.
  One revocation covers both presentations because there is only one session.
- Theft bounding: 256-bit secret, same 7-day TTL as the cookie session, same
  server-side revocation. The honest cost: the token lives in
  JS-accessible storage, losing the `HttpOnly` protection the cookie provides
  — any XSS becomes session theft. Mitigating context (not a dismissal): the
  app renders no user HTML (`SECURITY_REVIEW.md` XSS rows verified, zero
  `dangerouslySetInnerHTML`), so the XSS bar is already the app's security
  perimeter; the alternative is "no auth at all inside Nimiq Pay". Owner must
  accept this trade explicitly.
- Why recommended: deterministic — works regardless of Nimiq Pay's cookie
  policy, WebView version, or partition behavior; smallest auth-contract delta
  that solves the confirmed failure; generalizes to any future WebView host
  with the same policy.

### Option 3 — Same-origin proxy (Vercel rewrites `/api/*` → Railway)

- Makes the cookie first-party (page and API share the Vercel site), so WebView
  third-party policy becomes irrelevant and even `SameSite=Lax` would work.
- Costs and flags: inserts Vercel into the API path (extra hop/latency,
  Vercel proxy limits/timeouts on payment-verify long polls); client-IP
  handling for rate limiting must be re-verified (`trustProxy` + Vercel's
  `X-Forwarded-For` chain); CORS/CSRF topology assumptions change (same-origin
  requests carry `Origin` = Vercel URL — allowlisted, so the guard still
  passes, but must be re-proven); frontend `VITE_API_BASE_URL` + redeploy.
- Architecture verdict: **flag as requiring owner approval** per AGENTS.md
  ("do not change architecture without explicit approval") and
  ARCHITECTURE.md §22 (fixed Vercel-frontend / Railway-backend split with a
  direct HTTPS JSON API between them). A rewrite is arguably routing config,
  but it changes the documented deployment data path and failure domains — do
  not treat it as a trivial config tweak. Heavier blast radius than Option 2
  for the same outcome. Not recommended as the fix; keep as a fallback if the
  owner rejects any auth-contract change.

### Recommendation

**Option 2 (Bearer fallback), with Option 1's `Partitioned` attribute added in
the same pass as a one-line companion** (harmless where Bearer applies,
possibly sufficient alone on newer WebViews, zero contract impact). Do not
ship `Partitioned` alone and hope. Do not pursue Option 3 unless the owner
rejects the auth-contract change.

## 4. NOT confirmed without a device

1. Nimiq Pay's `CookieManager` policy (`setAcceptThirdPartyCookies` on/off),
   its WebView/Chromium version, and whether partitioned cookies are delivered
   (the three "Nimiq Pay does not document this" items — §2.3, §2.4).
2. SET-reject vs SEND-block half of the drop (fix-identical; §2.6).
3. The actual `Origin` header the WebView sends on `fetch()` (matters for
   re-testing the CSRF guard on the cookie path, not for the Bearer path).
4. Risks B (SDK return shape), C (data transform), D (Origin/CORS) — still
   untested, blocked behind auth.
5. Whether `sessionStorage`/DOM storage is enabled in Nimiq Pay's WebView
   (assumed yes — any functional mini app needs it; the completion pass must
   handle its absence gracefully by falling back to memory-only + re-login).

## 5. Human steps still needed (in order)

1. **Approve or reject** (a) the `/auth/verify` response-body token contract
   change and (b) the CSRF-guard Bearer exemption as specified in §3-Option 2.
   Both are auth-contract changes; nothing is implemented until approved.
2. **Device check** (optional but informative, ~5 min, does not block the fix):
   USB-debug the Android phone → desktop Chrome `chrome://inspect` → find the
   Nimiq Pay WebView → Inspect:
   - Application → Cookies → look under
     `takeover-api-production-1511.up.railway.app` for `takeover_session`.
     Absent = SET rejected (or SEND-blocked with store rejection — same
     conclusion); present-but-not-sent on `/me` (Network tab: no `Cookie`
     request header) = SEND blocked.
   - Network tab → click `POST /auth/verify` → Response Headers: confirm
     `set-cookie: takeover_session=…; Secure; SameSite=None` arrived; click
     `GET /me` → Request Headers: confirm no `cookie` header is sent.
   - Report back: cookie present/absent in storage; `set-cookie` seen/not
     seen; `cookie` sent/not sent; WebView version (`chrome://version` in the
     inspect window); the `Origin` request header value on the API calls.
3. **Re-test after the approved fix** (Phase 14b repeat on the same device):
   connect → `/me` shows address without re-login → claim → pay → verify →
   paid. Then Risks B/C/D unblock and can be worked through.

## 6. Proposed implementation plan for the completion pass (after approval)

Files to change (production):

- `apps/api/src/routes/auth.ts` — return raw session token in verify body
  (additive field, e.g. `sessionToken`), alongside the existing `setSessionCookie`.
- `apps/api/src/auth/session.ts` — resolve session from cookie **or**
  `Authorization: Bearer <token>` (cookie preferred; shared verification
  helper; no behavior change when only the cookie is present).
- `apps/api/src/http/csrf.ts` — Bearer exemption **only if approved**: skip
  Origin/header checks when the request carries no session cookie and
  authenticates via a valid Bearer token. Cookie path byte-identical.
  (Locked decision 2: exact diff + justification to be re-stated in the
  completion pass and approved before merge.)
- `apps/api/src/auth/session.ts` — `Partitioned` companion (one line in
  `sessionCookieOptions()` prod branch) + alias discipline note.
- `apps/web/src/lib/api.ts` — persist token to `sessionStorage` on verify,
  attach `Authorization` when set, clear on logout/401-revocation.
- `apps/web/src/store/auth.ts` — wire token save/clear into `login`/`logout`;
  graceful fallback if `sessionStorage` is unavailable.
- Docs: `ARCHITECTURE.md` §4.2 (Bearer presentation, storage, CSRF
  interaction), §15 if any code added, §16 CSRF paragraph; fix or implement
  the §4.2 "sliding renewal" drift noted in §2.2.

Tests to add (no threat marked verified without one):

- Verify-body carries a token that authenticates `GET /me` with **no** cookie.
- Cookie-absent + Bearer-present claim/intent/submit/verify round-trip (happy path).
- Bearer + wrong secret → 401; revoked session via Bearer → 401; disabled user
  via Bearer → 401 `ACCOUNT_DISABLED`.
- CSRF matrix on the Bearer path: no `Origin`/no client header + valid Bearer
  → success **iff** the exemption is approved (else 403s as today); cookie +
  bad Origin still 403s (guard unchanged on cookie path).
- Logout revokes Bearer (old token → 401) and clears client storage (web test).
- `Partitioned` present in prod `Set-Cookie`, absent in dev (unit test next to
  the existing prod-flags test, `security.test.ts` #32).
- Full existing suite green (cookie-path behavior must not shift).

## 7. Appendix — live evidence and session commands (statuses/counts, no secrets)

- `GET /health` → 200 `{"status":"ok"}`.
- `POST /auth/challenge` (throwaway keypair) → 200.
- `POST /auth/verify` (real `@nimiq/core` signature via production verifier)
  → 200 with user object + one `Set-Cookie`:
  `takeover_session=<redacted-token>; Path=/; HttpOnly; Secure; SameSite=None`.
- Residue removed: users 1, sessions 1, audits 1, challenges 1 (counts only).
- Temp probe script deleted before commit (`Test-Path` → False); no production
  writes, no env-var changes, no deployments in this session.
- Required battery (actual, run before commit): typecheck exit 0; lint exit 0;
  full test suite green (api + web + shared counts recorded in the handoff
  checkpoint); `git status` shows only `docs/phase-14c-diagnosis.md` (new) +
  `AI_HANDOFF.md` (checkpoint).
