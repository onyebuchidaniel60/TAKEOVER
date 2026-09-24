// @vitest-environment jsdom
// Brand mark + homepage sections. Structural asserts only.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BrandMark from '../src/components/BrandMark';
import Contact, { SUPPORT_EMAIL } from '../src/components/home/Contact';
import Faq from '../src/components/home/Faq';
import HowItWorks from '../src/components/home/HowItWorks';
import WhyTakeover from '../src/components/home/WhyTakeover';
import Home from '../src/routes/Home';
import { mockFetch, slotFixture } from './a11y-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrandMark', () => {
  it('renders the D9 lockup: box, line, condensed wordmark', () => {
    const { container } = render(<BrandMark height={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('height')).toBe('24');
    // Box outline + T + line + TAKEOVER text, no tab-in-slot geometry.
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('none');
    const texts = [...(svg?.querySelectorAll('text') ?? [])].map((t) => t.textContent);
    expect(texts).toContain('T');
    expect(texts).toContain('TAKEOVER');
    expect(svg?.querySelector('line')).toBeTruthy();
  });
});

describe('HowItWorks', () => {
  it('renders three steps in consumer language', () => {
    render(<HowItWorks />);
    expect(screen.getByRole('heading', { name: /how it works/i })).toBeTruthy();
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(screen.getByText(/see what’s available/i)).toBeTruthy();
    expect(screen.getByText(/claim your slot/i)).toBeTruthy();
    expect(screen.getByText(/enjoy, then confirm/i)).toBeTruthy();
    // No crypto jargon in step copy.
    expect(document.body.textContent).not.toMatch(/on-chain|smart contract/i);
  });

  it('anchors steps in large display numbers, not icons', () => {
    const { container } = render(<HowItWorks />);
    for (const n of ['01', '02', '03']) {
      expect(screen.getByText(n)).toBeTruthy();
    }
    const numbers = ['01', '02', '03'].map((n) => screen.getByText(n));
    for (const el of numbers) {
      expect(el.className).toContain('text-display');
    }
    // No icon chips: zero lucide SVGs in the section.
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('WhyTakeover jumps', () => {
  it('maps each mark to a real section anchor with a 44px hit area', () => {
    const { container } = render(<WhyTakeover />);
    const jumps = [
      ['Jump to How it works', '#how-it-works'],
      ['Jump to Features', '#features'],
      ['Jump to FAQ', '#faq'],
    ] as const;
    for (const [name, href] of jumps) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.className).toContain('min-h-touch');
    }
    // Visuals unchanged: the same three abstract bars, no icons.
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Faq', () => {
  it('renders six questions and expands disclosures on click', async () => {
    const user = userEvent.setup();
    render(<Faq />);
    expect(screen.getByRole('heading', { name: /questions, answered/i })).toBeTruthy();
    const questions = [
      'What is TAKEOVER?',
      'How does payment work?',
      'What if the provider doesn’t deliver?',
      'What is NIM used for?',
      'What does it cost to list a slot?',
      'How do I contact support?',
    ];
    for (const q of questions) {
      expect(screen.getByText(q)).toBeTruthy();
    }
    const first = screen.getByText(questions[0] as string).closest('details');
    expect(first?.open).toBe(false);
    await user.click(screen.getByText(questions[0] as string));
    expect(first?.open).toBe(true);
    expect(screen.getByText(/held safely/i)).toBeTruthy();
  });
});

describe('Contact', () => {
  it('links a valid support mailto and points at the report flow', () => {
    render(<Contact />);
    expect(screen.getByRole('heading', { name: /talk to us/i })).toBeTruthy();
    const link = screen.getByRole('link', { name: SUPPORT_EMAIL });
    expect(link.getAttribute('href')).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(screen.getByText(/report button/i)).toBeTruthy();
  });
});

describe('Home section order', () => {
  it('renders hero, feed, then How it works, Why, Features, Final CTA, FAQ, Contact, footer', async () => {
    mockFetch((url: string) => {
      if (url.startsWith('/api/v1/slots')) {
        return { slots: [slotFixture()], total: 1, limit: 20, offset: 0 };
      }
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/opening(s)? · soonest first/i);
    const main = screen.getByRole('main');
    const text = main.textContent ?? '';
    const order = [
      'Last-minute capacity',
      'Available now',
      'How it works',
      'Why TAKEOVER',
      'Built for the last minute',
      'go to waste',
      'Questions, answered',
      'Talk to us',
      'Built for Nimiq Pay.',
    ];
    let at = -1;
    for (const marker of order) {
      const next = text.indexOf(marker, at + 1);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it('hero links to sell-new and anchors how-it-works; footer links anchor sections', async () => {
    mockFetch((url: string) => {
      if (url.startsWith('/api/v1/slots')) {
        return { slots: [slotFixture()], total: 1, limit: 20, offset: 0 };
      }
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/opening(s)? · soonest first/i);
    const createLinks = screen.getAllByRole('link', { name: 'Create a slot' });
    expect(createLinks.length).toBeGreaterThan(0);
    for (const link of createLinks) {
      expect(link.getAttribute('href')).toBe('/sell/new');
    }
    expect(screen.getByRole('link', { name: 'Browse openings' }).getAttribute('href')).toBe(
      '#openings',
    );
    for (const link of screen.getAllByRole('link', { name: 'How it works' })) {
      expect(link.getAttribute('href')).toBe('#how-it-works');
    }
  });
});
