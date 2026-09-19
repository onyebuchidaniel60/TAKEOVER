// @vitest-environment jsdom
// Fixed category dropdowns. The filter and the
// form render exactly the six owner-approved options plus their empty
// option; selection round-trips (filter: URL param -> select -> URL ->
// fetch; form: select -> submit body); a pre-list custom draft value stays
// visible as a disabled "Custom:" option and submits unchanged.
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
};

const validForm: SlotFormValues = {
  ...emptyForm,
  title: 'Table for two',
  starts_at: '2030-01-01T10:00',
  ends_at: '2030-01-01T11:00',
  price: '1',
  total_quantity: '2',
};

function categoryOptions(): { label: string; value: string }[] {
  return screen
    .getAllByRole('option')
    .map((o) => ({ label: o.textContent ?? '', value: (o as HTMLOptionElement).value }));
}

describe('category filter dropdown', () => {
  it('renders exactly the six approved options plus All categories', () => {
    const { unmount } = render(<SearchFilters values={emptyFilters} onChange={() => {}} onClear={() => {}} />);
    try {
      expect(SLOT_CATEGORIES).toEqual(EXPECTED);
      expect(categoryOptions()).toEqual([
        { label: 'All categories', value: '' },
        ...EXPECTED.map((c) => ({ label: c, value: c })),
      ]);
    } finally {
      unmount();
    }
  });

  it('emits the picked category through onChange', () => {
    const onChange = vi.fn();
    const { unmount } = render(<SearchFilters values={emptyFilters} onChange={onChange} onClear={() => {}} />);
    try {
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Event' } });
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
    const { unmount } = render(
      <MemoryRouter initialEntries={['/?category=Event']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    try {
      // URL param -> select shows the value, and the fetch carries it.
      const select = (await screen.findByLabelText('Category')) as HTMLSelectElement;
      expect(select.value).toBe('Event');
      await waitFor(() => expect(seen.some((u) => u.includes('category=Event'))).toBe(true));
      // Select -> URL -> fetch carries the new value.
      fireEvent.change(select, { target: { value: 'Other' } });
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
