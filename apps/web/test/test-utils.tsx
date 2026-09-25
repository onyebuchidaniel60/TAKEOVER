// Shared TanStack Query test harness (Phase 5c). Every suite that
// renders query-consuming components wraps its renders in
// renderWithClient: a fresh QueryClient per call (no cross-test cache)
// with retries off (error states resolve without retry delays).
// Tests that assert caching behavior create their own client (with a
// production-like staleTime) and share it across renders.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 5 * 60_000,
      },
    },
  });
}

export function renderWithClient(
  ui: ReactElement,
  client: QueryClient = createTestQueryClient(),
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult & { queryClient: QueryClient } {
  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...result, queryClient: client };
}
