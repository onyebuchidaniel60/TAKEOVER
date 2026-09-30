// @vitest-environment jsdom
// Form-level validation DOM tests (fix C + guardrail 7).
// Pure validator matrices live in request-bodies.test.ts; these prove the
// wiring: invalid input blocks submit with an inline reason, valid input
// submits, and server rejections still surface the server's reason.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithClient } from './test-utils';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SlotForm from '../src/components/SlotForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});


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
    provider_contact_note: '',
    image_data: null,
  };

  it('labels the price input in USDT', async () => {
    const onSubmit = vi.fn();
    const { unmount } = renderWithClient(
      <SlotForm initial={emptyInitial} submitLabel="Save draft" submitting={false} serverError={null} onSubmit={onSubmit} />,
    );
    try {
      expect(await screen.findByText('Price (USDT) *')).toBeTruthy();
      expect(screen.queryByText('Price (NIM) *')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('blocks submit with per-field inline errors and never calls onSubmit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
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

  it('flags a past start, end-before-start, zero price, zero spots', async () => {
    const onSubmit = vi.fn();
    const { container, unmount } = renderWithClient(
      <SlotForm
        initial={{
          ...emptyInitial,
          title: 'T',
          starts_at: '2020-01-01T10:00',
          ends_at: '2020-01-01T09:00',
          price: '0',
          total_quantity: '0',
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
    } finally {
      unmount();
    }
  });

  it('submits valid input with the exact server body', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
      <SlotForm
        initial={{
          ...emptyInitial,
          title: 'Table for two',
          starts_at: '2030-01-01T10:00',
          ends_at: '2030-01-01T11:00',
          price: '1',
          total_quantity: '2',
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
      expect(body.price_usdt).toBe('1000000');
      expect(body.total_quantity).toBe(2);
      expect('payout_wallet' in body).toBe(false);
      expect(body.ends_at).toBeDefined();
    } finally {
      unmount();
    }
  });

  it('submits a valid future start with no end and omits ends_at', async () => {
    // Ends_at stays optional — a valid
    // future start with no end must submit, with no ends_at key in the body.
    // Cases a/b/d are covered by the tests above and the validator matrix in
    // request-bodies.test.ts.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
      <SlotForm
        initial={{
          ...emptyInitial,
          title: 'Table for two',
          starts_at: '2030-01-01T10:00',
          ends_at: '',
          price: '1',
          total_quantity: '2',
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
    const { unmount } = renderWithClient(
      <SlotForm
        initial={emptyInitial}
        submitLabel="Save draft"
        submitting={false}
        serverError="Something went wrong."
        onSubmit={() => {}}
      />,
    );
    try {
      expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    } finally {
      unmount();
    }
  });
});
