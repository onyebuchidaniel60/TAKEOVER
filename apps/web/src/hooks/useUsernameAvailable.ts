// Debounced username availability for the onboarding account screen.
// Wraps GET /api/v1/auth/username-available (~400ms debounce): the server
// is the single source of truth for reserved/taken; the client only
// mirrors format rules (see lib/identity) for instant feedback.
import { useEffect, useRef, useState } from 'react';
import { checkUsernameAvailable, validateUsernameInput } from '../lib/identity';

export type UsernameAvailabilityState =
  | { state: 'idle' }
  | { state: 'invalid'; message: string }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: 'reserved' | 'taken' }
  | { state: 'error' };

const DEBOUNCE_MS = 400;

export function usernameUnavailableMessage(reason: 'reserved' | 'taken'): string {
  return reason === 'reserved' ? 'This username is reserved.' : 'This username is already taken.';
}

export function useUsernameAvailable(username: string): UsernameAvailabilityState {
  const [result, setResult] = useState<UsernameAvailabilityState>({ state: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = username.trim();
    if (trimmed.length === 0) {
      setResult({ state: 'idle' });
      return;
    }
    const formatError = validateUsernameInput(username);
    if (formatError) {
      setResult({ state: 'invalid', message: formatError });
      return;
    }
    setResult({ state: 'checking' });
    const id = requestId.current + 1;
    requestId.current = id;
    const timer = window.setTimeout(() => {
      void checkUsernameAvailable(trimmed.toLowerCase())
        .then((res) => {
          if (requestId.current !== id) return;
          if (res.available) {
            setResult({ state: 'available' });
          } else if (res.reason === 'taken' || res.reason === 'reserved') {
            setResult({ state: 'unavailable', reason: res.reason });
          } else {
            setResult({ state: 'invalid', message: validateUsernameInput(trimmed) ?? 'That username is not available.' });
          }
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setResult({ state: 'error' });
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [username]);

  return result;
}
