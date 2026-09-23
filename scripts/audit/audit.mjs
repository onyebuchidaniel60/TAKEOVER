// TAKEOVER browser audit script (Phase 0, Playwright).
//
// Usage:
//   node scripts/audit/audit.mjs --route / --viewports 320,375,768,1280 \
//     --states default,empty,loading,error --out docs/redesign/audits/phase-0 \
//     [--base http://localhost:5173] [--scrollY 600]
//
// Output:
//   <out>/<width>x<height>-<state>.png   screenshots per viewport x state
//   <out>/report.json                    contrast pairs, touch targets, overflow
//
// State forcing (best-effort, documented honestly in the report):
//   default  plain navigation
//   loading  API responses delayed 1500ms; screenshot taken while pending
//   empty    API JSON list-bodies rewritten to empty arrays where the
//            shape is recognized; otherwise falls back to default and the
//            report notes "empty-unsupported" for that route
//   error    all /api/** requests aborted (forces the app's error UI)
// Unknown state names fall back to default with a report note.
//
// Gates live in the report; the agent interprets them per
// .opencode/skills/takeover-frontend/references/browser-audit.md:
//   contrast text < 4.5:1 or UI < 3:1 -> FAIL
//   interactive element < 44x44px      -> FAIL
//   scrollWidth > viewport width       -> FAIL
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Browser-context globals used inside page.evaluate() callbacks —
// those functions execute in Chromium, not Node.
/* global document, window, NodeFilter, getComputedStyle */

const HEIGHTS = { 320: 568, 375: 812, 768: 1024, 1280: 800 };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const route = arg('route', '/');
const viewports = arg('viewports', '320,375,768,1280')
  .split(',')
  .map((w) => Number(w.trim()))
  .filter((w) => Number.isFinite(w) && w > 0);
const states = arg('states', 'default')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const outDir = resolve(arg('out', 'docs/redesign/audits/phase-0'));
const base = (arg('base', 'http://localhost:5173') || '').replace(/\/$/, '');
// Optional post-load scroll (px) before screenshot + measure — used to
// exercise scroll-dependent chrome (e.g. the header hairline).
const scrollY = Number(arg('scrollY', '0')) || 0;

if (viewports.length === 0 || states.length === 0) {
  console.error('audit: --viewports and --states must be non-empty');
  process.exit(2);
}

async function measure(page) {
  return page.evaluate(() => {
    const out = { pairs: [], touch: [], overflow: null, focus: [] };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(',').map((x) => Number(x.trim()));
          if (p.length >= 3 && (p[3] ?? 1) > 0.02 && !(p[0] === 0 && p[1] === 0 && p[2] === 0 && (p[3] ?? 1) === 0)) {
            // transparent keywords still match rgba(0, 0, 0, 0); skip those
            if (p[0] === 0 && p[1] === 0 && p[2] === 0 && (p[3] ?? 1) === 0) {
              n = n.parentElement;
              continue;
            }
            return { r: p[0], g: p[1], b: p[2] };
          }
        }
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255 };
    };
    const lum = (r, g, b) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || !visible(el)) continue;
      const cs = getComputedStyle(el);
      const fg = cs.color.match(/rgba?\(([^)]+)\)/);
      if (!fg) continue;
      const p = fg[1].split(',').map((x) => Number(x.trim()));
      if (p.slice(0, 3).some((n) => !Number.isFinite(n))) continue;
      const bg = effBg(el);
      const key = `${p[0]},${p[1]},${p[2]}|${bg.r},${bg.g},${bg.b}|${cs.fontSize}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cr = (Math.max(lum(p[0], p[1], p[2]), lum(bg.r, bg.g, bg.b)) + 0.05) /
        (Math.min(lum(p[0], p[1], p[2]), lum(bg.r, bg.g, bg.b)) + 0.05);
      out.pairs.push({
        text: text.slice(0, 80),
        fg: `rgb(${p[0]}, ${p[1]}, ${p[2]})`,
        bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        fontSize: cs.fontSize,
        ratio: Math.round(cr * 100) / 100,
      });
      if (out.pairs.length >= 500) break;
    }
    const interactive = document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
    );
    for (const el of interactive) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) {
        out.touch.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    out.overflow = {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
    return out;
  });
}

const browser = await chromium.launch();
const report = { base, route, at: new Date().toISOString(), results: [] };

try {
  for (const width of viewports) {
    const height = HEIGHTS[width] ?? 800;
    for (const state of states) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const notes = [];
      let effectiveState = state;
      try {
        if (state === 'error') {
          await page.route('**/api/**', (r) => r.abort('failed'));
        } else if (state === 'loading') {
          await page.route('**/api/**', async (r) => {
            await new Promise((res) => setTimeout(res, 1500));
            await r.continue();
          });
        } else if (state === 'empty') {
          let rewrote = false;
          await page.route('**/api/**', async (r) => {
            const resp = await r.fetch();
            const ct = resp.headers()['content-type'] || '';
            if (ct.includes('application/json')) {
              try {
                const json = await resp.json();
                const emptied = Array.isArray(json)
                  ? []
                  : json && typeof json === 'object'
                    ? Object.fromEntries(
                        Object.entries(json).map(([k, v]) => [k, Array.isArray(v) ? [] : v]),
                      )
                    : json;
                if (JSON.stringify(emptied) !== JSON.stringify(json)) rewrote = true;
                await r.fulfill({ response: resp, body: JSON.stringify(emptied) });
                return;
              } catch {
                // fall through to passthrough
              }
            }
            await r.fulfill({ response: resp });
          });
          page.on('load', () => {
            if (!rewrote) notes.push('empty-unsupported: no JSON list body recognized; treated as default');
          });
        } else if (state !== 'default') {
          notes.push(`unknown-state: "${state}" treated as default`);
          effectiveState = 'default';
        }

        const url = `${base}${route}`;
        if (state === 'loading') {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(600);
        } else {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
            page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
          );
          await page.waitForTimeout(400);
        }

        if (scrollY > 0) {
          await page.evaluate((y) => window.scrollTo(0, y), scrollY);
          await page.waitForTimeout(400);
          notes.push(`scrolled: ${scrollY}px`);
        }

        const file = `${width}x${height}-${state}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: false });

        // Focus-ring sample: Tab through the first few stops.
        let focus = [];
        try {
          await page.evaluate(() => document.body.focus());
          for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
            const f = await page.evaluate(() => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const cs = getComputedStyle(el);
              return {
                tag: el.tagName.toLowerCase(),
                outline: cs.outlineColor,
                outlineWidth: cs.outlineWidth,
              };
            });
            if (f) focus.push(f);
            else break;
          }
        } catch {
          notes.push('focus-sample-failed');
        }

        const m = await measure(page);
        const failures = {
          contrast: m.pairs.filter((p) => p.ratio < 4.5),
          touch: m.touch,
          overflow: m.overflow.overflow,
        };
        report.results.push({
          viewport: `${width}x${height}`,
          state,
          effectiveState,
          screenshot: file,
          notes,
          pairs: m.pairs.length,
          contrastFailures: failures.contrast,
          touchFailures: failures.touch,
          overflow: m.overflow,
          focusSample: focus,
          pass: failures.contrast.length === 0 && failures.touch.length === 0 && !failures.overflow,
        });
        console.log(
          `audit: ${width}x${height} [${state}] pairs=${m.pairs.length} ` +
            `contrastFails=${failures.contrast.length} touchFails=${failures.touch.length} ` +
            `overflow=${failures.overflow}`,
        );
      } catch (e) {
        report.results.push({
          viewport: `${width}x${height}`,
          state,
          effectiveState,
          screenshot: null,
          notes: [...notes, `navigation-failed: ${e.message}`],
          pass: false,
        });
        console.error(`audit: ${width}x${height} [${state}] FAILED: ${e.message}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const failed = report.results.filter((r) => !r.pass).length;
console.log(`audit: done. ${report.results.length - failed}/${report.results.length} pass. Report: ${join(outDir, 'report.json')}`);
process.exit(0);
