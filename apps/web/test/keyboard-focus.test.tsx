// @vitest-environment jsdom
// Phase 11 keyboard + focus tests: semantic controls everywhere, Enter
// activates, Escape closes every dialog, focus traps inside dialogs and
// returns to the trigger on close.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import CancelConfirmDialog from '../src/components/CancelConfirmDialog';
import ReportDialog from '../src/components/ReportDialog';
import Home from '../src/routes/Home';
import SellDetail from '../src/routes/SellDetail';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import { claimFixture, mockFetch, setBuyer, slotFixture } from './a11y-helpers';

const FOCUSABLE = 'a[href], button, input, select, textarea, summary';

/** Accessible name via aria-label, aria-labelledby, associated label, or text. */
function accessibleName(el: Element, container: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) {
    return aria;
  }
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${id}`)?.textContent ?? '')
      .join(' ');
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0) {
      return [...labels].map((label) => label.textContent ?? '').join(' ');
    }
    const wrapping = el.closest('label');
    if (wrapping) {
      return wrapping.textContent ?? '';
    }
    if (el instanceof HTMLInputElement) {
      return el.value ?? el.placeholder ?? '';
    }
    return '';
  }
  return el.textContent ?? '';
}

describe('semantic interactive elements', () => {
  it('every control on / is a native element with an accessible name', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots')) {
        return { slots: [slotFixture()], total: 1, limit: 20, offset: 0 };
      }
      return undefined;
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Table for two — tonight');
    const controls = [...container.querySelectorAll(FOCUSABLE)];
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) {
      expect(['A', 'BUTTON', 'INPUT', 'SUMMARY', 'SELECT', 'TEXTAREA']).toContain(el.tagName);
      expect(accessibleName(el, container).trim().length).toBeGreaterThan(0);
    }
    // No clickable divs.
    for (const div of [...container.querySelectorAll('div[onclick], div[role="button"]')]) {
      expect(div).toBeUndefined();
    }
  });

  it('every input on /sell/new has an associated label', async () => {
    const SellNew = (await import('../src/routes/SellNew')).default;
    setBuyer();
    mockFetch(() => undefined);
    const { container } = render(
      <MemoryRouter initialEntries={['/sell/new']}>
        <Routes>
          <Route path="/sell/new" element={<SellNew />} />
        </Routes>
      </MemoryRouter>,
    );
    const fields = [...container.querySelectorAll('input, select, textarea')];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const id = field.getAttribute('id');
      const labelled =
        (id !== null && container.querySelector(`label[for="${id}"]`) !== null) ||
        field.getAttribute('aria-label') !== null;
      expect(labelled).toBe(true);
    }
  });
});

describe('keyboard activation', () => {
  it('Enter on the focused Claim button claims and navigates', async () => {
    setBuyer();
    mockFetch((url, init) => {
      if (url.startsWith('/api/v1/slots/') && (init?.method ?? 'GET') === 'GET') {
        return { slot: slotFixture() };
      }
      if (url.includes('/claims') && init?.method === 'POST') {
        return { claim: claimFixture(), slot: slotFixture() };
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
          <Route path="/claim/:claimId" element={<div>claim page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const button = await screen.findByRole('button', { name: /claim this opening/i });
    button.focus();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('claim page')).toBeDefined());
  });

  it('tab reaches every control on /slot/:id in a sensible order', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: /claim this opening/i });
    const order = [...container.querySelectorAll(FOCUSABLE)].map((el) => el.tagName);
    expect(order).toContain('A');
    expect(order).toContain('BUTTON');
    // Walk the whole tab order without leaving the page.
    (document.body as HTMLElement).focus?.();
    const seen = new Set<Element>();
    for (let i = 0; i < order.length + 2; i += 1) {
      await user.tab();
      if (document.activeElement && document.activeElement !== document.body) {
        seen.add(document.activeElement);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(order.length);
  });
});

describe('dialog focus management', () => {
  it('Escape closes the report dialog and focus returns to the trigger', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const trigger = await screen.findByRole('button', { name: /report this opening/i });
    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: /report this opening/i })).toBeDefined();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).toContain('Report this opening');
  });

  it('Tab cycles inside the report dialog instead of escaping it', async () => {
    setBuyer();
    const user = userEvent.setup();
    render(<ReportDialog slotId="slot-1" onClose={() => {}} onReported={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: /report this opening/i });
    const controls = [...dialog.querySelectorAll('select, textarea, button')];
    expect(controls.length).toBe(4);
    // Focus starts on the first control.
    expect(document.activeElement).toBe(controls[0]);
    // Shift+Tab on the first control wraps to the last.
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(controls[controls.length - 1]);
    // Tab on the last control wraps to the first.
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(controls[0]);
  });

  it('Escape dismisses the inline cancel confirmation', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) {
        return {
          slot: { ...slotFixture(), payout_wallet: 'NQ0700000000000000000000000000000000', status: 'draft' },
        };
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/sell/slot-1']}>
        <Routes>
          <Route path="/sell/:slotId" element={<SellDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /cancel opening/i }));
    expect(await screen.findByRole('alertdialog')).toBeDefined();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // The trigger unmounts while confirming, so focus lands on its re-mount.
    expect(document.activeElement).toBe(
      await screen.findByRole('button', { name: /cancel opening/i }),
    );
  });

  it('standalone CancelConfirmDialog traps focus and closes on Escape', async () => {
    const user = userEvent.setup();
    let dismissed = 0;
    render(<CancelConfirmDialog onConfirm={() => {}} onDismiss={() => { dismissed += 1; }} cancelling={false} />);
    const dialog = await screen.findByRole('alertdialog');
    const buttons = [...dialog.querySelectorAll('button')];
    expect(buttons.length).toBe(2);
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard('{Escape}');
    expect(dismissed).toBe(1);
  });
});
