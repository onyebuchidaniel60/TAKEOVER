// @vitest-environment jsdom
// Homepage 12-cap (Phase 4b correction 4): Home fetches limit=12 and,
// when more exist, links to /openings (filters preserved) instead of
// paging in place. /openings renders the same feed uncapped with the
// show-more button.
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithClient } from './test-utils';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../src/routes/Home';
import Openings from '../src/routes/Openings';
import { mockFetch, setGuest, slotFixture } from './a11y-helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function twentyFive(): Record<string, unknown>[] {
  return Array.from({ length: 25 }, (_, i) =>
    slotFixture({ id: `slot-${i}`, title: `Slot ${i}` }),
  );
}

// Records fetch URLs; answers list slices from limit/offset params.
function stubPaged(all: Record<string, unknown>[]): { seen: string[] } {
  const seen: string[] = [];
  mockFetch((url: string) => {
    if (!url.startsWith('/api/v1/slots')) return undefined;
    seen.push(url);
    const query = url.split('?')[1] ?? '';
    const params = new URLSearchParams(query);
    const limit = Number(params.get('limit') ?? '20');
    const offset = Number(params.get('offset') ?? '0');
    return { slots: all.slice(offset, offset + limit), total: all.length, limit, offset };
  });
  return { seen };
}

describe('homepage feed cap', () => {
  it('fetches 12 and links to /openings when more exist', { timeout: 10000 }, async () => {
    setGuest();
    const { seen } = stubPaged(twentyFive());
    renderWithClient(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Slot 0');
    await waitFor(() => expect(seen.some((u) => u.includes('limit=12'))).toBe(true));
    expect(screen.queryByText('Slot 12')).toBeNull();
    const seeAll = await screen.findByRole('link', { name: /see all openings/i });
    expect(seeAll.getAttribute('href')).toBe('/openings');
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('carries active filters into the /openings link', { timeout: 10000 }, async () => {
    setGuest();
    stubPaged(twentyFive());
    renderWithClient(
      <MemoryRouter initialEntries={['/?category=Event']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    const seeAll = await screen.findByRole('link', { name: /see all openings/i });
    expect(seeAll.getAttribute('href')).toBe('/openings?category=Event');
  });

  it('shows neither see-all nor show-more when everything fits', { timeout: 10000 }, async () => {
    setGuest();
    stubPaged(twentyFive().slice(0, 8));
    renderWithClient(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Slot 0');
    await waitFor(() => expect(screen.getByText('Slot 7')).toBeTruthy());
    expect(screen.queryByRole('link', { name: /see all openings/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });
});

describe('/openings full list', () => {
  it('fetches 20 and pages with show-more', { timeout: 10000 }, async () => {
    setGuest();
    const { seen } = stubPaged(twentyFive());
    const user = userEvent.setup();
    renderWithClient(
      <MemoryRouter initialEntries={['/openings']}>
        <Routes>
          <Route path="/openings" element={<Openings />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Slot 0');
    await waitFor(() => expect(seen.some((u) => u.includes('limit=20'))).toBe(true));
    expect(screen.queryByRole('link', { name: /see all openings/i })).toBeNull();
    await user.click(await screen.findByRole('button', { name: /show more/i }));
    await waitFor(() =>
      expect(seen.some((u) => u.includes('limit=20') && u.includes('offset=20'))).toBe(true),
    );
    await screen.findByText('Slot 20');
  });
});
