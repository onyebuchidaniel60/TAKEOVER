// @vitest-environment jsdom
// Fixed category filters. The feed filter renders All plus the six
// owner-approved categories as pill chips (aria-pressed); selection
// round-trips (chip -> URL param -> fetch). The sell form keeps its
// select (behavior preserved there); a pre-list custom draft value
// stays visible as a disabled "Custom:" option and submits unchanged.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchFilters from '../src/components/SearchFilters';
import SlotForm, { type SlotFormValues } from '../src/components/SlotForm';
import { SLOT_CATEGORIES } from '../src/lib/slots';
import Home from '../src/routes/Home';
import { mockFetch } from './a11y-helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EXPECTED = [
  'Restaurant / food',
  'Fitness / class',
  'Sports court',
  'Salon / service',
  'Event',
  'Other',
];

const emptyFilters = { q: '', category: '', location: '', from: '', to: '' };

const emptyForm: SlotFormValues = {
  title: '',
  description: '',
  category: '',
  location_label: '',
  starts_at: '',
  ends_at: '',
  price: '',
  total_quantity: '',
  provider_contact_note: '',
};

const validForm: SlotFormValues = {
  ...emptyForm,
  title: 'Table for two',
  starts_at: '2030-01-01T10:00',
  ends_at: '2030-01-01T11:00',
  price: '1',
  total_quantity: '2',
};

function categoryChips(): { label: string; pressed: boolean }[] {
  return screen
    .getAllByRole('button', { name: (name) => [...EXPECTED, 'All'].includes(name) })
    .map((b) => ({ label: b.textContent ?? '', pressed: b.getAttribute('aria-pressed') === 'true' }));
}

// The sell form keeps its native select (unchanged behavior there).
function categoryOptions(): { label: string; value: string }[] {
  return screen
    .getAllByRole('option')
    .map((o) => ({ label: o.textContent ?? '', value: (o as HTMLOptionElement).value }));
}

describe('category filter chips', () => {
  it('renders All plus the six approved categories, none pressed when empty', () => {
    const { unmount } = render(<SearchFilters values={emptyFilters} onChange={() => {}} onClear={() => {}} />);
    try {
      expect(SLOT_CATEGORIES).toEqual(EXPECTED);
      expect(categoryChips()).toEqual([
        { label: 'All', pressed: true },
        ...EXPECTED.map((c) => ({ label: c, pressed: false })),
      ]);
    } finally {
      unmount();
    }
  });

  it('emits the picked category through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<SearchFilters values={emptyFilters} onChange={onChange} onClear={() => {}} />);
    try {
      await user.click(screen.getByRole('button', { name: 'Event' }));
      expect(onChange).toHaveBeenCalledWith({ ...emptyFilters, category: 'Event' });
    } finally {
      unmount();
    }
  });

  it('round-trips through the URL param on the feed', async () => {
    const seen: string[] = [];
    mockFetch((url: string) => {
      seen.push(url);
      return { slots: [], total: 0, limit: 20, offset: 0 };
    });
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/?category=Event']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    try {
      // URL param -> Event chip pressed, and the fetch carries it.
      expect(await screen.findByRole('button', { name: 'Event' })).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Event' }).getAttribute('aria-pressed')).toBe('true'),
      );
      await waitFor(() => expect(seen.some((u) => u.includes('category=Event'))).toBe(true));
      // Chip -> URL -> fetch carries the new value.
      await user.click(screen.getByRole('button', { name: 'Other' }));
      await waitFor(() => expect(seen.some((u) => u.includes('category=Other'))).toBe(true));
    } finally {
      unmount();
    }
  });
});

describe('category form dropdown', () => {
  it('renders exactly the six approved options plus No category', () => {
    const onSubmit = vi.fn();
    const { unmount } = render(
      <SlotForm
        initial={emptyForm}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      expect(categoryOptions()).toEqual([
        { label: 'No category', value: '' },
        ...EXPECTED.map((c) => ({ label: c, value: c })),
      ]);
    } finally {
      unmount();
    }
  });

  it('submits the picked category', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <SlotForm
        initial={validForm}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Sports court' } });
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const body = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body.category).toBe('Sports court');
    } finally {
      unmount();
    }
  });

  it('shows a pre-list custom value as disabled Custom and submits it unchanged', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <SlotForm
        initial={{ ...validForm, category: 'dining' }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      const custom = screen.getByRole('option', { name: 'Custom: dining' }) as HTMLOptionElement;
      expect(custom.disabled).toBe(true);
      expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('dining');
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect((onSubmit.mock.calls[0]?.[0] as Record<string, unknown>).category).toBe('dining');
    } finally {
      unmount();
    }
  });

  it('lets a custom value be replaced with a list value', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <SlotForm
        initial={{ ...validForm, category: 'dining' }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Event' } });
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect((onSubmit.mock.calls[0]?.[0] as Record<string, unknown>).category).toBe('Event');
    } finally {
      unmount();
    }
  });
});
