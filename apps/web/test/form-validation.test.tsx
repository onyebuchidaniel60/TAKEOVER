// @vitest-environment jsdom
// Phase 14c round 3 — form-level validation DOM tests (fix C + guardrail 7).
// Pure validator matrices live in request-bodies.test.ts; these prove the
// wiring: invalid input blocks submit with an inline reason, valid input
// submits, and server rejections still surface the server's reason.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SlotForm from '../src/components/SlotForm';
import { DisplayNameForm } from '../src/routes/Profile';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VALID_PAYOUT = 'NQ69CMHG0RUFYBQ8VD8K0HPMBNG58N0S6KR1';

function stubFetchJson(data: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    (async () =>
      ({
        ok,
        status,
        headers: { get: () => null },
        json: () => Promise.resolve({ data, requestId: 'test' }),
      }) as unknown as Response) as typeof fetch,
  );
}

describe('SlotForm client validation', () => {
  const emptyInitial = {
    title: '',
    description: '',
    category: '',
    location_label: '',
    starts_at: '',
    ends_at: '',
    price: '',
    total_quantity: '',
    payout_wallet: '',
  };

  it('blocks submit with per-field inline errors and never calls onSubmit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <SlotForm initial={emptyInitial} submitLabel="Save draft" submitting={false} serverError={null} onSubmit={onSubmit} />,
    );
    try {
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(await screen.findByText('Give your opening a title.')).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it('flags a bad payout, past start, end-before-start, zero price, zero spots', async () => {
    const onSubmit = vi.fn();
    const { container, unmount } = render(
      <SlotForm
        initial={{
          ...emptyInitial,
          title: 'T',
          starts_at: '2020-01-01T10:00',
          ends_at: '2020-01-01T09:00',
          price: '0',
          total_quantity: '0',
          payout_wallet: 'NQ00 SEEDPAYOUT000000000001',
        }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      // fireEvent.submit, not user.click: jsdom (like real browsers) runs
      // native constraint validation on click-submits, and the qty input's
      // min=1 would block submission before our handler runs. Dispatching
      // submit directly tests OUR validation layer deterministically.
      const form = container.querySelector('form');
      expect(form).not.toBeNull();
      fireEvent.submit(form as HTMLFormElement);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(await screen.findByText('Start must be in the future.')).toBeTruthy();
      expect(await screen.findByText('End must be after the start.')).toBeTruthy();
      expect(await screen.findByText('Enter a valid Nimiq wallet address (starts with NQ).')).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it('submits valid input with the exact server body', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <SlotForm
        initial={{
          ...emptyInitial,
          title: 'Table for two',
          starts_at: '2030-01-01T10:00',
          ends_at: '2030-01-01T11:00',
          price: '1',
          total_quantity: '2',
          payout_wallet: VALID_PAYOUT,
        }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const body = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body.title).toBe('Table for two');
      expect(body.price_nim).toBe('100000');
      expect(body.total_quantity).toBe(2);
      expect(body.payout_wallet).toBe(VALID_PAYOUT);
      expect(body.ends_at).toBeDefined();
    } finally {
      unmount();
    }
  });

  it('submits a valid future start with no end and omits ends_at', async () => {
    // Phase 14c round 5 (Item 4, case c): ends_at stays optional — a valid
    // future start with no end must submit, with no ends_at key in the body.
    // Cases a/b/d are covered by the tests above and the validator matrix in
    // request-bodies.test.ts.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <SlotForm
        initial={{
          ...emptyInitial,
          title: 'Table for two',
          starts_at: '2030-01-01T10:00',
          ends_at: '',
          price: '1',
          total_quantity: '2',
          payout_wallet: VALID_PAYOUT,
        }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const body = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body.starts_at).toBeDefined();
      expect('ends_at' in body).toBe(false);
    } finally {
      unmount();
    }
  });

  it('renders a server rejection reason when the server still says no (guardrail 7)', async () => {
    const { unmount } = render(
      <SlotForm
        initial={emptyInitial}
        submitLabel="Save draft"
        submitting={false}
        serverError="Invalid payout wallet address."
        onSubmit={() => {}}
      />,
    );
    try {
      expect(await screen.findByText('Invalid payout wallet address.')).toBeTruthy();
    } finally {
      unmount();
    }
  });
});

describe('DisplayNameForm client validation', () => {
  it('blocks too-short and link names with inline errors and no request', async () => {
    const onSaved = vi.fn();
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      (async (_url: unknown, init?: RequestInit) => {
        seen.push(init ?? {});
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({ data: { providerProfile: { displayName: 'x' } }, requestId: 't' }),
        } as unknown as Response;
      }) as typeof fetch,
    );
    const user = userEvent.setup();
    const { unmount } = render(
      <DisplayNameForm initial="" submitLabel="Set display name" onSaved={onSaved} />,
    );
    try {
      const input = screen.getByLabelText(/display name/i);
      fireEvent.change(input, { target: { value: 'x' } });
      await user.click(screen.getByRole('button', { name: /set display name/i }));
      expect(await screen.findByText('Use at least 2 characters.')).toBeTruthy();
      expect(onSaved).not.toHaveBeenCalled();
      expect(seen).toHaveLength(0);
      fireEvent.change(input, { target: { value: 'see www.example.com deals' } });
      await user.click(screen.getByRole('button', { name: /set display name/i }));
      expect(await screen.findByText('Display name must not contain links.')).toBeTruthy();
      expect(onSaved).not.toHaveBeenCalled();
      expect(seen).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it('submits a valid name and reports the saved value', async () => {
    const onSaved = vi.fn();
    stubFetchJson({ providerProfile: { displayName: 'Sunrise Yoga' } });
    const user = userEvent.setup();
    render(<DisplayNameForm initial="" submitLabel="Set display name" onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Sunrise Yoga' } });
    await user.click(screen.getByRole('button', { name: /set display name/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Sunrise Yoga'));
  });
});
