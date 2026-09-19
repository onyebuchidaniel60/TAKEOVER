// @vitest-environment jsdom
// error boundaries: a throwing child renders the branded fallback
// with a working reload action; nothing raw ever reaches the screen.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../src/components/ErrorBoundary';

afterEach(() => {
  cleanup();
});

function Exploding(): React.ReactNode {
  throw new Error('boom (test only)');
}

describe('ErrorBoundary', () => {
  it('renders the branded fallback with a reload button', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary section="Test section" onReload={() => {}}>
          <Exploding />
        </ErrorBoundary>,
      );
      screen.getByText('Something went wrong.');
      screen.getByText(/test section hit a problem/i);
      screen.getByRole('button', { name: /reload/i });
      expect(screen.queryByText(/boom/)).toBeNull();
    } finally {
      silence.mockRestore();
    }
  });

  it('reload button invokes the reload action', async () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onReload = vi.fn();
      render(
        <ErrorBoundary section="Test section" onReload={onReload}>
          <Exploding />
        </ErrorBoundary>,
      );
      await userEvent.setup().click(screen.getByRole('button', { name: /reload/i }));
      expect(onReload).toHaveBeenCalledTimes(1);
    } finally {
      silence.mockRestore();
    }
  });

  it('passes children through when nothing throws', () => {
    render(
      <ErrorBoundary section="Test section" onReload={() => {}}>
        <p>healthy content</p>
      </ErrorBoundary>,
    );
    screen.getByText('healthy content');
  });
});
