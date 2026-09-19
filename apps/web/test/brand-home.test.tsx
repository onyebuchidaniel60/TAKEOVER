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
import Home from '../src/routes/Home';
import { mockFetch, slotFixture } from './a11y-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrandMark', () => {
  it('renders an accessible single-color SVG mark', () => {
    const { container } = render(<BrandMark size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('TAKEOVER');
    expect(svg?.querySelector('title')?.textContent).toBe('TAKEOVER');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 32 32');
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
  it('renders feed, then How it works, FAQ, and Contact in that order', async () => {
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
    const feedAt = text.indexOf('Available now');
    const howAt = text.indexOf('How it works');
    const faqAt = text.indexOf('Questions, answered');
    const contactAt = text.indexOf('Talk to us');
    expect(feedAt).toBeGreaterThanOrEqual(0);
    expect(howAt).toBeGreaterThan(feedAt);
    expect(faqAt).toBeGreaterThan(howAt);
    expect(contactAt).toBeGreaterThan(faqAt);
  });
});
