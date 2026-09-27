// Step 2 — Account creation (Phase 5j). Wallet-first per D14: the wallet
// CTA is the accent pill, email is the outline pill revealing the form.
// Email form validates inline (mirrors in lib/identity) with a debounced
// server availability check on the username. No Google (deferred, D13 —
// omitted entirely, not a disabled button). Success (either path) →
// /onboarding/profile. Already authenticated → profile (guard covers the
// rest).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingShell, {
  ONBOARDING_INPUT_CLASS,
  ONBOARDING_LABEL_CLASS,
  ONBOARDING_PRIMARY_CTA_CLASS,
  ONBOARDING_SECONDARY_CTA_CLASS,
  OnboardingFieldError,
} from '../../components/onboarding/OnboardingShell';
import { useUsernameAvailable, usernameUnavailableMessage } from '../../hooks/useUsernameAvailable';
import { ApiError } from '../../lib/api';
import {
  validateEmailInput,
  validatePasswordInput,
  validateUsernameInput,
} from '../../lib/identity';
import { usePageMeta } from '../../lib/meta';
import { useAuth } from '../../store/auth';

export default function Account() {
  usePageMeta({ title: 'Create your account — TAKEOVER' });
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const loginWallet = useAuth((s) => s.login);
  const registerWithEmail = useAuth((s) => s.registerWithEmail);

  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false, username: false });
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; username?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const availability = useUsernameAvailable(emailOpen ? username : '');

  // Either auth path lands here authenticated — move forward. (The guard
  // keeps fresh accounts inside the onboarding area; this advances them.)
  useEffect(() => {
    if (status === 'authenticated') {
      navigate('/onboarding/profile', { replace: true });
    }
  }, [status, navigate]);

  const emailError = touched.email ? validateEmailInput(email) : null;
  const passwordError = touched.password
    ? validatePasswordInput(password, { email, username })
    : null;
  const usernameFormatError = touched.username ? validateUsernameInput(username) : null;

  async function handleWallet(): Promise<void> {
    setWalletBusy(true);
    setWalletError(null);
    try {
      await loginWallet();
    } catch (err) {
      setWalletError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setWalletBusy(false);
    }
  }

  async function handleEmailSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setTouched({ email: true, password: true, username: true });
    setFieldErrors({});
    setFormError(null);
    const next: typeof fieldErrors = {};
    const e = validateEmailInput(email);
    if (e) next.email = e;
    const p = validatePasswordInput(password, { email, username });
    if (p) next.password = p;
    const u = validateUsernameInput(username);
    if (u) next.username = u;
    if (availability.state === 'unavailable') {
      next.username = usernameUnavailableMessage(availability.reason);
    }
    if (availability.state === 'checking') {
      setFormError('Checking your username — try again in a moment.');
      return;
    }
    if (Object.keys(next).length > 0) {
      setFieldErrors(next);
      return;
    }
    setEmailBusy(true);
    try {
      await registerWithEmail({
        email: email.trim(),
        password,
        username: username.trim().toLowerCase(),
      });
    } catch (err) {
      setEmailBusy(false);
      if (err instanceof ApiError) {
        // Field-specific server rejections land inline; anything else
        // reads as a form-level error with the server's message.
        if (err.code === 'EMAIL_TAKEN') {
          setFieldErrors({ email: 'This email is already registered.' });
        } else if (err.code === 'USERNAME_TAKEN') {
          setFieldErrors({ username: 'This username is already taken.' });
        } else if (err.code === 'RATE_LIMITED') {
          setFormError('Too many attempts. Try again later.');
        } else {
          setFormError(err.message);
        }
        return;
      }
      setFormError('Something went wrong.');
    }
  }

  return (
    <OnboardingShell
      step="Step 1 of 3"
      eyebrow="Create your account"
      title="How do you want to sign in?"
      supporting="A wallet or an email — either identifies you. You can link the other later."
    >
      <button
        type="button"
        disabled={walletBusy}
        onClick={() => void handleWallet()}
        className={ONBOARDING_PRIMARY_CTA_CLASS}
      >
        {walletBusy ? 'Connecting…' : 'Continue with wallet'}
      </button>
      {walletError ? <OnboardingFieldError message={walletError} /> : null}

      {!emailOpen ? (
        <button
          type="button"
          onClick={() => setEmailOpen(true)}
          className={ONBOARDING_SECONDARY_CTA_CLASS}
        >
          Continue with email
        </button>
      ) : (
        <form onSubmit={(e) => void handleEmailSubmit(e)} noValidate aria-label="Sign up with email">
          <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
            <div>
              <label htmlFor="account-email" className={ONBOARDING_LABEL_CLASS}>
                Email
              </label>
              <input
                id="account-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                placeholder="you@example.com"
                className={ONBOARDING_INPUT_CLASS}
              />
              {emailError ?? fieldErrors.email ? (
                <OnboardingFieldError message={(fieldErrors.email ?? emailError) as string} />
              ) : null}
            </div>
            <div>
              <label htmlFor="account-password" className={ONBOARDING_LABEL_CLASS}>
                Password
              </label>
              <input
                id="account-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                placeholder="At least 8 characters"
                className={ONBOARDING_INPUT_CLASS}
              />
              {passwordError ?? fieldErrors.password ? (
                <OnboardingFieldError message={(fieldErrors.password ?? passwordError) as string} />
              ) : null}
            </div>
            <div>
              <label htmlFor="account-username" className={ONBOARDING_LABEL_CLASS}>
                Username
              </label>
              <input
                id="account-username"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, username: true }))}
                placeholder="your_handle"
                aria-describedby="account-username-note"
                className={ONBOARDING_INPUT_CLASS}
              />
              <p id="account-username-note" className="mt-1 text-small text-faint">
                {availability.state === 'checking'
                  ? 'Checking availability…'
                  : availability.state === 'available'
                    ? 'That username is available.'
                    : availability.state === 'unavailable'
                      ? usernameUnavailableMessage(availability.reason)
                      : '3–20 lowercase letters, numbers, or underscores.'}
              </p>
              {usernameFormatError ?? fieldErrors.username ? (
                <OnboardingFieldError
                  message={(fieldErrors.username ?? usernameFormatError) as string}
                />
              ) : null}
            </div>
            {formError ? <OnboardingFieldError message={formError} /> : null}
            <button type="submit" disabled={emailBusy} className={ONBOARDING_PRIMARY_CTA_CLASS}>
              {emailBusy ? 'Creating your account…' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </OnboardingShell>
  );
}
