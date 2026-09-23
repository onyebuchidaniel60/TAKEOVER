// @vitest-environment jsdom
// frontend security suite — no backend, no wallet. Proves user
// content renders as inert text (React escapes by default): hostile slot
// fields, a hostile provider display name, and a hostile server error message
// never become live markup. Plus a source scan proving no
// dangerouslySetInnerHTML exists anywhere in web src, and a client-posture
// check (JSON-only posts with credentials).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SlotCard from '../src/components/SlotCard';
import SlotDetail from '../src/components/SlotDetail';
import { apiFetch } from '../src/lib/api';
import type { PublicSlot } from '../src/lib/slots';
import Profile from '../src/routes/Profile';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import { useAuth } from '../src/store/auth';
import { err, meFixture, mockFetch, setBuyer, slotFixture } from './a11y-helpers';

const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

const EVIL_TITLE = `<script>alert('xss-title')</script>`;
const EVIL_DESC = `<img src=x onerror=alert('xss-desc')>`;
const EVIL_CATEGORY = `"><svg onload=alert('xss-cat')>`;
const EVIL_LOCATION = `javascript:alert('xss-loc')`;
const EVIL_NAME = `<img src=x onerror=alert('xss-name')>`;

function hostileSlot(): PublicSlot {
  return slotFixture({
    title: EVIL_TITLE,
    description: EVIL_DESC,
    category: EVIL_CATEGORY,
    location_label: EVIL_LOCATION,
  }) as unknown as PublicSlot;
}

function expectInertHtml(container: HTMLElement): void {
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  // Lucide-react icons are first-party elements (every one
  // carries class "lucide"). Hostile field values render as escaped text via
  // React and can never produce elements at all — so any svg WITHOUT the
  // lucide class is still a hard failure, exactly as before.
  expect(container.querySelector('svg:not(.lucide)')).toBeNull();
  expect(container.querySelector('iframe')).toBeNull();
}

describe('frontend security pass', () => {
  it('xss: SlotCard renders hostile fields as inert text', () => {
    const { container } = render(
      <MemoryRouter>
        <SlotCard slot={hostileSlot()} />
      </MemoryRouter>,
    );
    expectInertHtml(container);
    const text = container.textContent ?? '';
    expect(text).toContain(EVIL_TITLE);
    expect(text).toContain(EVIL_DESC);
    expect(text).toContain(EVIL_LOCATION);
    // Category rides the icon chip (Phase 3): the hostile value survives
    // only as the escaped accessible label — never as markup, never as
    // visible text.
    const chip = container.querySelector('[role="img"]');
    expect(chip?.getAttribute('aria-label')).toBe(EVIL_CATEGORY);
  });

  it('xss: SlotDetail renders hostile fields as inert text', () => {
    const { container } = render(<SlotDetail slot={hostileSlot()} />);
    expectInertHtml(container);
    const text = container.textContent ?? '';
    expect(text).toContain(EVIL_TITLE);
    expect(text).toContain(EVIL_DESC);
    expect(text).toContain(EVIL_LOCATION);
    // Category rides the icon chip (Phase 4, like the feed card): the
    // hostile value survives only as the escaped accessible label —
    // never as markup, never as visible text.
    const chip = container.querySelector('[role="img"]');
    expect(chip?.getAttribute('aria-label')).toBe(EVIL_CATEGORY);
  });

  it('xss: Profile renders a hostile provider display name as inert text', async () => {
    setBuyer();
    const evilMe = {
      ...meFixture(),
      hasProviderProfile: true,
      providerProfile: { displayName: EVIL_NAME },
    };
    mockFetch((url: string) => {
      if (url.includes('/api/v1/me/slots')) {
        return { slots: [], total: 0, limit: 1, offset: 0 };
      }
      return { user: evilMe };
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(EVIL_NAME);
    expectInertHtml(container);
    useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
  });

  it('xss: a hostile server error message renders as inert text', async () => {
    setBuyer();
    const evilMessage = `<script>alert('xss-err')</script>`;
    mockFetch(() => err(500, 'INTERNAL_ERROR', evilMessage));
    const { container } = render(
      <MemoryRouter initialEntries={['/slot/slot-9']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(evilMessage);
    expectInertHtml(container);
  });

  it('xss: no dangerouslySetInnerHTML anywhere in web src', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules' || entry === 'dist') continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const text = readFileSync(full, 'utf8');
          if (/dangerouslySetInnerHTML|__html|innerHTML\s*=/.test(text)) {
            offenders.push(full);
          }
        }
      }
    };
    expect(existsSync(WEB_SRC)).toBe(true);
    walk(WEB_SRC);
    expect(offenders).toEqual([]);
  });

  it('client posture: state-changing posts are JSON-only with credentials', async () => {
    const seen: RequestInit[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ data: { ok: true }, requestId: 'test' }),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      await apiFetch<{ ok: boolean }>('/api/v1/slots/slot-1/claims', { method: 'POST', body: '{}' });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.credentials).toBe('include');
    const headers = seen[0]?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    // Completion (F4): the CSRF guard requires this header on
    // Credentialed mutations; the browser then forces a CORS-gated preflight.
    expect(headers['X-Takeover-Client']).toBe('web');
  });

  it('client posture: GET requests carry no client header', async () => {
    const seen: RequestInit[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ data: { slots: [] }, requestId: 'test' }),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      await apiFetch<{ slots: unknown[] }>('/api/v1/slots?limit=5');
      await apiFetch<{ slots: unknown[] }>('/api/v1/slots?limit=5', { method: 'GET' });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen).toHaveLength(2);
    for (const init of seen) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers['X-Takeover-Client']).toBeUndefined();
    }
  });
});
