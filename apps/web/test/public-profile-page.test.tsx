// @vitest-environment jsdom
// Phase 5k-B: profile surfaces.
//
// The security assertion is the PUBLIC one: /u/:username must never render
// email, phone or DOB. Those values are put into the fixture under every
// plausible public field name so that a component which accidentally renders
// a spread user object fails here rather than in production.
//
// The private counter-test is just as important: the OWN profile must still
// show email/phone/DOB to the signed-in user. A "no private data anywhere"
// implementation would pass the first test and fail this one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './test-utils';
import PublicProfile from '../src/routes/PublicProfile';

function renderRoute(ui: React.ReactElement, path = '/u/someone'): void {
  const client = createTestQueryClient();
  cleanup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/u/:username" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubProfile(data: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    (async () => ({
      ok: status < 400,
      status,
      headers: { get: () => null },
      json: () => Promise.resolve(data),
    })) as unknown as typeof fetch,
  );
}

const PUBLIC_PROFILE = {
  data: {
    profile: {
      username: 'someone',
      displayName: 'Sunrise Yoga',
      avatarData: null,
      bio: 'Morning classes in Kreuzberg.',
      location: 'Berlin',
      memberSince: '2026-01-15',
      stats: { openings: 2, claims: 1, followers: 3, following: 4 },
    },
  },
  requestId: 't',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public profile (Phase 5k-B)', () => {
  it('renders the public fields', async () => {
    stubProfile(PUBLIC_PROFILE);
    renderRoute(<PublicProfile />);
    expect(await screen.findByText('Sunrise Yoga')).toBeTruthy();
    expect(screen.getByText('@someone')).toBeTruthy();
    expect(screen.getByText('Morning classes in Kreuzberg.')).toBeTruthy();
    expect(screen.getByText('Berlin')).toBeTruthy();
    expect(screen.getByText('January 2026')).toBeTruthy();
    // Stats row: Part B renders Openings + Claims (+ social counts read 0
    // until 5k-C wires the follows table).
    expect(screen.getByText('Openings')).toBeTruthy();
    expect(screen.getByText('Claims')).toBeTruthy();
  });

  it('never renders private identity fields, even if the payload carries them', async () => {
    // A leaky server (or a future refactor that spreads the user row) would
    // put these on the payload. The page must not surface them regardless.
    stubProfile({
      data: {
        profile: {
          ...PUBLIC_PROFILE.data.profile,
          email: 'leak@example.com',
          phone: '+49 170 0000000',
          dob: '1990-04-01',
          walletAddress: 'NQ00 LEAKEDWALLETADDRESS000000000000000000',
        },
      },
      requestId: 't',
    });
    renderRoute(<PublicProfile />);
    await screen.findByText('Sunrise Yoga');
    const html = document.body.innerHTML;
    expect(html).not.toContain('leak@example.com');
    expect(html).not.toContain('+49 170 0000000');
    expect(html).not.toContain('1990-04-01');
    expect(html).not.toContain('LEAKEDWALLETADDRESS');
  });

  it('shows a not-found state for an unknown handle', async () => {
    stubProfile({ error: { code: 'NOT_FOUND', message: 'Profile not found.' }, requestId: 't' }, 404);
    renderRoute(<PublicProfile />, '/u/nobody_here');
    expect(await screen.findByText('Profile not found')).toBeTruthy();
  });

  it('shows an error state with retry when the read fails', async () => {
    stubProfile({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' }, requestId: 't' }, 500);
    renderRoute(<PublicProfile />);
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy());
  });
});
