// @vitest-environment jsdom
// Phase 5n-B: field-specific profile edit.
//
// The owner correction: tapping a field row opened the FULL profile-setup
// form. These tests pin the opposite — one field, one modal — and the email
// path end to end, since email is the only IDENTITY field in that patch and
// needs a uniqueness rule the optional fields do not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { createTestQueryClient } from './test-utils';
import Profile from '../src/routes/Profile';
import { useAuth } from '../src/store/auth';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

interface StubOptions {
  user?: Record<string, unknown>;
  /** Make PATCH /me/profile answer with this code instead of succeeding. */
  patchError?: { status: number; code: string; message: string };
  /** Phase 5o-A: make PATCH /me/username answer with this code. */
  usernameError?: { status: number; code: string; message: string };
}

const PATCHES: { field: string; value: unknown }[] = [];

function stubApi(opts: StubOptions = {}) {
  PATCHES.length = 0;
  vi.stubGlobal(
    'fetch',
    (async (url: string, init?: RequestInit) => {
      const path = String(url);
      // Phase 5o-A: the handle has its OWN endpoint (the server owns
      // set-once), so it is stubbed separately from the profile scalars.
      if (path.includes('/me/username') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        PATCHES.push({ field: path, value: JSON.parse(String(init?.body ?? '{}')) });
        const failure = opts.usernameError;
        if (failure) {
          return {
            ok: false,
            status: failure.status,
            headers: { get: () => null },
            json: () => Promise.resolve({ error: { code: failure.code, message: failure.message } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ data: { username: 'claimed', alreadySet: false } }),
        };
      }
      if (path.includes('/auth/username-available')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ available: true }),
        };
      }
      if (path.includes('/me/profile') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        PATCHES.push({ field: path, value: JSON.parse(String(init?.body ?? '{}')) });
        const failure = opts.patchError;
        if (failure) {
          return {
            ok: false,
            status: failure.status,
            headers: { get: () => null },
            json: () => Promise.resolve({ error: { code: failure.code, message: failure.message } }),
          };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { profile: {} } }) };
      }
      if (path.includes('/api/v1/users/')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              data: {
                profile: { username: 'me', displayName: 'Me', avatarData: null, bio: null, location: null, memberSince: '2026-01-01', isFollowing: null, stats: { openings: 0, claims: 0, followers: 0, following: 0 } },
              },
            }),
        };
      }
      if (path.includes('/me/slots')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { slots: [], total: 0, limit: 3, offset: 0 } }) };
      }
      if (path.includes('/claims')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { claims: [], total: 0, limit: 1, offset: 0 } }) };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            data: {
              user: {
                id: 'u1',
                email: 'me@test.local',
                username: 'me',
                walletAddress: null,
                role: 'buyer',
                status: 'active',
                providerProfile: null,
                phone: null,
                dob: null,
                location: null,
                ...(opts.user ?? {}),
              },
            },
          }),
      };
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'u1', username: 'me' } as never,
    error: null,
    initialized: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Tapping a field row must open a dialog containing ONLY that field. */
async function openField(label: RegExp): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  return screen.findByRole('dialog');
}

describe('Profile — field-specific edit (Phase 5n-B)', () => {
  it('opens a single-field dialog for Email, not the full profile form', async () => {
    stubApi();
    render(<Profile />, { wrapper: Wrapper });
    const dialog = await openField(/email/i);
    // Exactly one input, pre-filled with the current value.
    const inputs = dialog.querySelectorAll('input');
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as HTMLInputElement).value).toBe('me@test.local');
    // The full form's other fields are NOT here — that was the complaint.
    expect(dialog.textContent).not.toMatch(/full name/i);
    expect(dialog.textContent).not.toMatch(/profile picture/i);
    expect(dialog.textContent).not.toMatch(/username/i);
  });

  it('opens a single-field dialog for Phone, Date of birth and Location', async () => {
    stubApi();
    for (const [label, title] of [
      [/phone/i, 'Edit phone'],
      [/date of birth/i, 'Edit date of birth'],
      [/location/i, 'Edit location'],
    ] as const) {
      const { unmount } = render(<Profile />, { wrapper: Wrapper });
      const dialog = await openField(label);
      expect(dialog.textContent).toContain(title);
      expect(dialog.querySelectorAll('input')).toHaveLength(1);
      unmount();
      cleanup();
    }
  });

  it('saves a new email and closes the dialog', async () => {
    stubApi();
    render(<Profile />, { wrapper: Wrapper });
    const dialog = await openField(/email/i);
    const input = dialog.querySelector('input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'new@test.local');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(PATCHES).toHaveLength(1);
    expect(PATCHES[0].value).toMatchObject({ email: 'new@test.local' });
  });

  it('blocks an invalid email inline and sends no request', async () => {
    stubApi();
    render(<Profile />, { wrapper: Wrapper });
    const dialog = await openField(/email/i);
    const input = dialog.querySelector('input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(PATCHES).toHaveLength(0);
  });

  it('explains EMAIL_TAKEN in consumer language and keeps the dialog open', async () => {
    stubApi({ patchError: { status: 409, code: 'EMAIL_TAKEN', message: 'raw server text' } });
    render(<Profile />, { wrapper: Wrapper });
    const dialog = await openField(/email/i);
    const input = dialog.querySelector('input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'taken@test.local');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That email is already in use.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('clears an optional field by saving it empty', async () => {
    stubApi();
    render(<Profile />, { wrapper: Wrapper });
    const dialog = await openField(/phone/i);
    expect(dialog.querySelector('input')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(PATCHES[0].value).toMatchObject({ phone: null });
  });

  it('no longer routes an Information row to the onboarding profile form', async () => {
    stubApi();
    render(<Profile />, { wrapper: Wrapper });
    await screen.findByText('Information');
    // Every Information row is a BUTTON now, not a link.
    for (const label of [/email/i, /phone/i, /date of birth/i, /location/i]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    // The ONLY remaining link to the full form is the "Edit profile" pill,
    // which is the intended use of that screen (name, username, avatar).
    const links = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links.filter((h) => h?.includes('/onboarding/profile'))).toEqual([
      '/onboarding/profile?from=settings',
    ]);
  });
});

// -- Phase 5o-A: the one-time handle set (D26) -------------------------------
//
// D26: a handle is set ONCE and never changes. So the Profile row is
// tappable only while it is empty — an edit control that could only ever 409
// is worse than no control, so the set state drops the chevron and the tap
// target exactly like the Wallet row does.
describe('Profile — one-time username set (Phase 5o-A)', () => {
  async function renderHandleLess() {
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u1', username: null } as never,
      error: null,
      initialized: true,
    });
    stubApi({ user: { username: null } });
    render(<Profile />, { wrapper: Wrapper });
    await screen.findByText('Information');
  }

  it('shows "Not set" and offers the set affordance when there is no handle', async () => {
    await renderHandleLess();
    const row = screen.getByRole('button', { name: /username/i });
    expect(row.textContent).toContain('Not set');
  });

  it('shows @handle with NO edit affordance once a handle exists (D26)', async () => {
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u1', username: 'me' } as never,
      error: null,
      initialized: true,
    });
    stubApi();
    render(<Profile />, { wrapper: Wrapper });
    await screen.findByText('Information');
    expect(screen.queryByRole('button', { name: /username/i })).toBeNull();
    // Scoped to the Information card: the header also renders the handle.
    const info = document.querySelector('section[aria-label="Information"]') as HTMLElement;
    expect(info.textContent).toContain('@me');
  });

  it('claims the handle through the one-time endpoint and closes', async () => {
    await renderHandleLess();
    await userEvent.click(screen.getByRole('button', { name: /username/i }));
    const dialog = await screen.findByRole('dialog');
    // Copy says "choose", not "change" — this is not an edit.
    expect(dialog.textContent).toContain('Choose your username');
    const input = dialog.querySelector('input') as HTMLInputElement;
    await userEvent.type(input, 'claimed_handle');
    await userEvent.click(screen.getByRole('button', { name: /claim username/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(PATCHES).toHaveLength(1);
    // Its OWN endpoint, and lowercased on the wire so "Claimed" cannot fork.
    expect(PATCHES[0].field).toContain('/me/username');
    expect(PATCHES[0].value).toEqual({ username: 'claimed_handle' });
  });

  it('blocks a malformed handle inline and sends no request', async () => {
    await renderHandleLess();
    await userEvent.click(screen.getByRole('button', { name: /username/i }));
    const input = (await screen.findByRole('dialog')).querySelector('input') as HTMLInputElement;
    await userEvent.type(input, 'ab');
    await userEvent.click(screen.getByRole('button', { name: /claim username/i }));
    expect(await screen.findByText(/Usernames are 3/)).toBeTruthy();
    expect(PATCHES).toHaveLength(0);
  });

  it('an empty handle is refused — a handle can be set, never cleared', async () => {
    await renderHandleLess();
    await userEvent.click(screen.getByRole('button', { name: /username/i }));
    const input = (await screen.findByRole('dialog')).querySelector('input') as HTMLInputElement;
    expect(input.required).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /claim username/i }));
    expect(await screen.findByText(/Usernames are 3/)).toBeTruthy();
    expect(PATCHES).toHaveLength(0);
  });

  it('explains USERNAME_TAKEN and keeps the dialog open', async () => {
    stubApi({
      user: { username: null },
      usernameError: { status: 409, code: 'USERNAME_TAKEN', message: 'This username is already taken.' },
    });
    render(<Profile />, { wrapper: Wrapper });
    await screen.findByText('Information');
    await userEvent.click(screen.getByRole('button', { name: /username/i }));
    const input = (await screen.findByRole('dialog')).querySelector('input') as HTMLInputElement;
    await userEvent.type(input, 'taken_handle');
    await userEvent.click(screen.getByRole('button', { name: /claim username/i }));
    expect(await screen.findByText('This username is already taken.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('explains USERNAME_IMMUTABLE — the server is the boundary, not the UI', async () => {
    stubApi({
      user: { username: null },
      usernameError: { status: 409, code: 'USERNAME_IMMUTABLE', message: 'Your username cannot be changed.' },
    });
    render(<Profile />, { wrapper: Wrapper });
    await screen.findByText('Information');
    await userEvent.click(screen.getByRole('button', { name: /username/i }));
    const input = (await screen.findByRole('dialog')).querySelector('input') as HTMLInputElement;
    await userEvent.type(input, 'another_handle');
    await userEvent.click(screen.getByRole('button', { name: /claim username/i }));
    expect(await screen.findByText('Your username cannot be changed.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('cancel makes no change', async () => {
    await renderHandleLess();
    await userEvent.click(screen.getByRole('button', { name: /username/i }));
    const input = (await screen.findByRole('dialog')).querySelector('input') as HTMLInputElement;
    await userEvent.type(input, 'abandoned');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(PATCHES).toHaveLength(0);
  });
});
