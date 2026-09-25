// @vitest-environment jsdom
// Phase 5d surfaces: Avatar, SlotForm image field, cards/detail with
// images, plus axe over each new visual. Canvas + createImageBitmap are
// stubbed (jsdom has neither); one test leaves them absent to prove the
// friendly-error path never crashes.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Avatar from '../src/components/Avatar';
import BottomNav from '../src/components/BottomNav';
import SlotCard from '../src/components/SlotCard';
import SlotDetail from '../src/components/SlotDetail';
import SlotForm, { type SlotFormValues } from '../src/components/SlotForm';
import Profile from '../src/routes/Profile';
import { prepareImage } from '../src/lib/image';
import type { PublicSlot } from '../src/lib/slots';
import { renderWithClient } from './test-utils';
import {
  runAxe,
  assertZeroCriticalOrSerious,
  meFixture,
  mockFetch,
  setBuyer,
  slotFixture,
} from './a11y-helpers';

const AVATAR_DATA = `data:image/jpeg;base64,${'A'.repeat(500)}`;
const SLOT_IMAGE = `data:image/jpeg;base64,${'B'.repeat(500)}`;

function slotWith(overrides: Record<string, unknown>): PublicSlot {
  return slotFixture(overrides) as unknown as PublicSlot;
}

function stubCanvas(payload: string): void {
  vi.stubGlobal(
    'createImageBitmap',
    async () => ({ width: 800, height: 600, close: () => {} }),
  );
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({ drawImage: () => {} }),
    configurable: true,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    value: () => payload,
    configurable: true,
  });
}

beforeEach(() => {
  document.documentElement.classList.add('dark');
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
});

describe('Avatar', () => {
  it('renders the picture when set, sized exactly', () => {
    const { container } = renderWithClient(<Avatar data={AVATAR_DATA} name="Manual Bistro" size={48} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(AVATAR_DATA);
    expect(img?.getAttribute('width')).toBe('48');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the initial circle when unset', () => {
    const { container } = renderWithClient(<Avatar data={null} name="Manual Bistro" size={24} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('M');
  });

  it('has no critical/serious violations in either state', async () => {
    const withPic = renderWithClient(
      <div>
        Bistro <Avatar data={AVATAR_DATA} name="Manual Bistro" size={32} />
      </div>,
    );
    assertZeroCriticalOrSerious(await runAxe(withPic.container), 'avatar with picture');
    withPic.unmount();
    const fallback = renderWithClient(
      <div>
        Bistro <Avatar data={null} name="Manual Bistro" size={32} />
      </div>,
    );
    assertZeroCriticalOrSerious(await runAxe(fallback.container), 'avatar fallback');
  });
});

describe('prepareImage', () => {
  it('resizes to the long-edge cap and fits first try on a small payload', async () => {
    stubCanvas(`data:image/jpeg;base64,${'A'.repeat(200)}`);
    const prepared = await prepareImage(new Blob(['x'], { type: 'image/png' }), 400);
    expect(prepared.width).toBe(400);
    expect(prepared.height).toBe(300);
    expect(prepared.quality).toBe(0.85);
    expect(prepared.steps).toBe(1);
    expect(prepared.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('walks the quality ladder, then shrinks, reporting steps', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(400000)}`;
    const small = `data:image/jpeg;base64,${'A'.repeat(200)}`;
    let calls = 0;
    vi.stubGlobal(
      'createImageBitmap',
      async () => ({ width: 800, height: 600, close: () => {} }),
    );
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: () => ({ drawImage: () => {} }),
      configurable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      value: () => {
        calls += 1;
        return calls <= 3 ? big : small;
      },
      configurable: true,
    });
    const prepared = await prepareImage(new Blob(['x'], { type: 'image/png' }), 1200);
    expect(prepared.steps).toBe(4);
    expect(prepared.width).toBe(600);
  });

  it('rejects with a friendly message when the platform cannot read images', async () => {
    await expect(prepareImage(new Blob(['x'], { type: 'image/png' }), 400)).rejects.toThrow(
      /could not read that image/i,
    );
  });
});

const draftInitial: SlotFormValues = {
  title: 'Table for two',
  description: '',
  category: '',
  location_label: '',
  starts_at: '2030-01-01T10:00',
  ends_at: '',
  price: '1',
  total_quantity: '2',
  provider_contact_note: '',
  image_data: null,
};

describe('SlotForm image field', () => {
  it('picks an image and submits it in the body', async () => {
    stubCanvas(`data:image/jpeg;base64,${'C'.repeat(200)}`);
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
      <SlotForm
        initial={draftInitial}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(picker).toBeTruthy();
      await user.upload(picker, new File(['x'], 'dish.png', { type: 'image/png' }));
      expect(await screen.findByAltText('Opening preview')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const [body] = onSubmit.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(typeof body['image_data']).toBe('string');
      expect((body['image_data'] as string).startsWith('data:image/jpeg;base64,')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('omits an unchanged image and clears a removed one', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    // Unchanged: key absent from the body.
    const { unmount } = renderWithClient(
      <SlotForm
        initial={{ ...draftInitial, image_data: SLOT_IMAGE }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      expect(await screen.findByAltText('Opening preview')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const [body] = onSubmit.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(body).not.toHaveProperty('image_data');
      // Removed: explicit null clears server-side.
      await user.click(screen.getByRole('button', { name: /remove image/i }));
      await user.click(screen.getByRole('button', { name: /save draft/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
      const [cleared] = onSubmit.mock.calls[1] as [Record<string, unknown>, unknown];
      expect(cleared['image_data']).toBeNull();
    } finally {
      unmount();
    }
  });

  it('shows a friendly error instead of crashing when the image cannot be read', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
      <SlotForm
        initial={draftInitial}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(picker, new File(['x'], 'dish.png', { type: 'image/png' }));
      expect(await screen.findByText(/could not read that image/i)).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('locked form exposes the image field alongside the note', async () => {
    const onSubmitNote = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
      <SlotForm
        initial={draftInitial}
        submitLabel="Save note"
        submitting={false}
        serverError={null}
        onSubmit={() => {}}
        commercialLocked
        onSubmitNote={onSubmitNote}
      />,
    );
    try {
      expect(screen.getByText('Image')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /save note/i }));
      await waitFor(() => expect(onSubmitNote).toHaveBeenCalledTimes(1));
      // Unchanged image travels as undefined (no re-send).
      expect(onSubmitNote.mock.calls[0]?.[1]).toBeUndefined();
    } finally {
      unmount();
    }
  });
});

describe('cards + detail with images', () => {
  function renderCard(slot: PublicSlot): HTMLElement {
    const { container } = renderWithClient(
      <MemoryRouter>
        <SlotCard slot={slot} />
      </MemoryRouter>,
    );
    return container;
  }

  it('feed card never renders the opening image, even when the slot has one (Phase 5e)', () => {
    const withImage = renderCard(slotWith({ imageData: SLOT_IMAGE, providerAvatar: AVATAR_DATA }));
    // The only img on the card is the 24px provider avatar — no 16:10
    // opening-image header anywhere.
    const imgs = [...withImage.querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.className).toContain('rounded-full');
    expect(imgs[0]?.getAttribute('src')).toBe(AVATAR_DATA);
    expect(withImage.querySelector('.aspect-\\[16\\/10\\]')).toBeNull();
    // The card keeps its category chip and title.
    expect(withImage.textContent).toContain('Table for two');
    const without = renderCard(slotWith({ imageData: null, providerAvatar: null }));
    expect(without.querySelector('img')).toBeNull();
    expect(without.textContent).toContain('Table for two');
  });

  it('detail renders the hero image when present, nothing when absent', () => {
    const withImage = renderWithClient(
      <SlotDetail slot={slotWith({ imageData: SLOT_IMAGE, providerAvatar: AVATAR_DATA })} />,
    );
    const img = withImage.container.querySelector('img');
    expect(img?.className).toContain('aspect-[16/10]');
    expect(img?.className).toContain('rounded-card');
    const without = renderWithClient(<SlotDetail slot={slotWith({ imageData: null })} />);
    expect(without.container.querySelector('img')).toBeNull();
  });

  it('card + detail with images have no critical/serious violations', async () => {
    const card = renderCard(slotWith({ imageData: SLOT_IMAGE, providerAvatar: AVATAR_DATA }));
    assertZeroCriticalOrSerious(await runAxe(card), 'feed card (image ignored)');
    const detail = renderWithClient(
      <SlotDetail slot={slotWith({ imageData: SLOT_IMAGE, providerAvatar: AVATAR_DATA })} />,
    );
    assertZeroCriticalOrSerious(await runAxe(detail.container), 'detail with image');
    const plain = renderCard(slotWith({ imageData: null, providerAvatar: null }));
    assertZeroCriticalOrSerious(await runAxe(plain), 'feed card without image');
  });
});

describe('BottomNav open-sign icon', () => {
  it('Sell tab renders the hanging OPEN sign', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me/notifications') return { notifications: [], unreadCount: 0 };
      return undefined;
    });
    const { container } = renderWithClient(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    );
    const sell = await screen.findByRole('link', { name: 'Sell' });
    expect(sell.textContent).toContain('OPEN');
    assertZeroCriticalOrSerious(await runAxe(container), 'nav with open-sign icon');
  });
});

describe('Profile with avatar', () => {
  it('shows the 48px preview and change controls, axe-clean', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me') return { user: { ...meFixture(), avatarData: AVATAR_DATA } };
      if (url.startsWith('/api/v1/me/slots')) return { slots: [], total: 0, limit: 1, offset: 0 };
      return undefined;
    });
    const { container } = renderWithClient(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: /change picture/i })).toBeTruthy();
    const preview = container.querySelector('section[aria-label="Profile picture"] img');
    expect(preview?.getAttribute('width')).toBe('48');
    assertZeroCriticalOrSerious(await runAxe(container), 'profile with avatar');
  });

  it('has no openings/holds shortcuts — the bottom nav is the navigation (Phase 5e)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me') return { user: meFixture() };
      if (url.startsWith('/api/v1/me/slots')) return { slots: [], total: 0, limit: 1, offset: 0 };
      return undefined;
    });
    renderWithClient(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: /upload picture/i });
    expect(screen.queryByRole('link', { name: /my openings/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /my holds/i })).toBeNull();
    expect(screen.getByRole('button', { name: /log out/i })).toBeTruthy();
  });

  it('shows the upload CTA and initial fallback without an avatar', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me') return { user: meFixture() };
      if (url.startsWith('/api/v1/me/slots')) return { slots: [], total: 0, limit: 1, offset: 0 };
      return undefined;
    });
    const { container } = renderWithClient(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: /upload picture/i })).toBeTruthy();
    assertZeroCriticalOrSerious(await runAxe(container), 'profile without avatar');
  });
});
