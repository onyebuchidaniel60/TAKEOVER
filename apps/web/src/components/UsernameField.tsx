// Username field (Phase 5o-A, D25/D26).
//
// One component for BOTH surfaces that collect a handle — the ProfileSetup
// onboarding step (wallet users, who never got one at signup) and the
// one-time Profile set. Two copies of a live-availability field would drift
// in the debounce note, the format error, and the required-ness, and the
// account screen already owns the canonical markup for it.
//
// The availability check is the existing debounced hook, which asks
// GET /auth/username-available: the server stays the single source of truth
// for reserved/taken, and this component only mirrors the FORMAT rule for
// instant feedback. Availability is required (not advisory) — a handle the
// server will reject must never be submittable.
import {
  ONBOARDING_INPUT_CLASS,
  ONBOARDING_LABEL_CLASS,
  OnboardingFieldError,
} from './onboarding/OnboardingShell';
import { useEffect, useState } from 'react';
import { useUsernameAvailable, usernameUnavailableMessage } from '../hooks/useUsernameAvailable';
import { validateUsernameInput } from '../lib/identity';

export default function UsernameField({
  id,
  value,
  onChange,
  required,
  revealToken = 0,
  serverError = null,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Whether an empty value blocks submit. EXPLICIT, not derived from
   * `disabled`: the two used to be the same flag, which made the handle
   * mandatory in the settings variant of ProfileSetup — where D25's
   * requirement does not apply (that rule is an ONBOARDING gate) and the same
   * claim is optional from the Profile page. One screen, two entry points, and
   * HTML validation silently enforcing a rule only one of them had.
   */
  required: boolean;
  /**
   * Increment to reveal the format error WITHOUT waiting for a blur. A submit
   * attempt on a never-focused empty field never fires onBlur, so the user
   * pressed Continue, nothing happened, and nothing said why — the same
   * "silent wall" shape as the Cancel bug, one layer down. A counter (rather
   * than a boolean) fires on every attempt, including the second one.
   */
  revealToken?: number;
  /** Server-side reason (409 message), shown below the live check. */
  serverError?: string | null;
  /** True for an account that already has a handle (D26 immutable). */
  disabled?: boolean;
}) {
  // Touched is owned here, not by the caller. It was passed in alongside an
  // onBlur callback, which meant every surface had to remember to wire a
  // "has this been visited yet" flag — a piece of interaction state with no
  // business living in a parent, and an easy prop to forget.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (revealToken > 0) setTouched(true);
  }, [revealToken]);
  const availability = useUsernameAvailable(disabled ? '' : value);
  const formatError = !disabled && touched ? validateUsernameInput(value) : null;
  const error = formatError ?? serverError;

  return (
    <div>
      <label htmlFor={id} className={ONBOARDING_LABEL_CLASS}>
        Username
      </label>
      <input
        id={id}
        type="text"
        // A handle is a URL segment: no autofill, no autocapitalize, no
        // spellcheck — "Jordan" must stay lowercase or it silently forks.
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required={required && !disabled}
        disabled={disabled}
        readOnly={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder="your_handle"
        aria-describedby={`${id}-note`}
        aria-invalid={error ? true : undefined}
        className={disabled ? `${ONBOARDING_INPUT_CLASS} opacity-70` : ONBOARDING_INPUT_CLASS}
      />
      <p id={`${id}-note`} className="mt-1 text-small text-faint">
        {disabled
          ? 'Your handle is set and cannot be changed.'
          : availability.state === 'checking'
            ? 'Checking availability…'
            : availability.state === 'available'
              ? 'That username is available.'
              : availability.state === 'unavailable'
                ? usernameUnavailableMessage(availability.reason)
                : availability.state === 'error'
                  ? 'Could not check availability. Try again in a moment.'
                  : 'Your public link. 3–20 lowercase letters, numbers, or underscores.'}
      </p>
      {error ? <OnboardingFieldError message={error} /> : null}
    </div>
  );
}