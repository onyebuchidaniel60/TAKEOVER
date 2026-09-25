import { QueryClient } from '@tanstack/react-query';

// Shared client (Phase 5c): one cache for the whole app.
//
// staleTime 30s — data is fresh for 30s; revisits inside the window
// render instantly with zero fetches (the Phase 5b complaint).
// gcTime 5min — unused entries linger for back-navigation.
// retry 1 — one retry on failure (the old code never retried reads).
// refetchOnWindowFocus false — Mini App context: focus refetch fights
// the wallet WebView lifecycle and buys nothing on phones.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
