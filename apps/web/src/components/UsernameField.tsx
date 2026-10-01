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
import { useUsernameAvailable, usernameUnavailableMessage } from '../hooks/useUsernameAvailable';
import { validateUsernameInput } from '../lib/identity';

export default function UsernameField({
  id,
  value,
  onChange,
  onBlur,
  disabled = false,
  touched = false,
  serverError = null,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** True for an email user who already chose a handle at signup (D25). */
  disabled?: boolean;
  /** Suppresses the format error until the field has been left once. */
  touched?: boolean;
  /** Server-side reason (409 message), shown below the live check. */
  serverError?: string | null;
}) {
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
        required={!disabled}
        disabled={disabled}
        readOnly={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
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