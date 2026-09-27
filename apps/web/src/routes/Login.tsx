// Login (Phase 5j). Sibling route, not an onboarding step: email +
// password form, wallet as the secondary path, sign-up link → /welcome.
// Success → the ?redirect= target when present and safe, else Home.
// Authenticated visits resolve via the guard; this screen additionally
// forwards fresh accounts to /onboarding/profile (they must onboard)
// and onboarded users to Home.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import OnboardingShell, {
  ONBOARDING_INPUT_CLASS,
  ONBOARDING_LABEL_CLASS,
  ONBOARDING_PRIMARY_CTA_CLASS,
  ONBOARDING_SECONDARY_CTA_CLASS,
  OnboardingFieldError,
} from '../components/onboarding/OnboardingShell';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { useAuth } from '../store/auth';

/** Same-origin relative path only — never an external URL. */
export function safeRedirectTarget(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }
  return raw;
}

export default function Login() {
  usePageMeta({ title: 'Sign in — TAKEOVER' });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const status = useAuth((s) => s.status);
  const onboardedAt = useAuth((s) => s.user?.onboardedAt ?? null);
  const loginWithEmail = useAuth((s) => s.loginWithEmail);
  const loginWallet = useAuth((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const redirect = safeRedirectTarget(searchParams.get('redirect'));

  function afterAuth(): void {
    navigate(redirect ?? '/', { replace: true });
  }

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (onboardedAt === null) {
      navigate('/onboarding/profile', { replace: true });
    } else {
      afterAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, onboardedAt]);

  async function handleEmailSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    setEmailBusy(true);
    try {
      await loginWithEmail({ email: email.trim(), password });
    } catch (err) {
      setEmailBusy(false);
      if (err instanceof ApiError && err.code === 'ACCOUNT_DISABLED') {
        setFormError('This account is disabled.');
        return;
      }
      // UNAUTHENTICATED is deliberately generic (no enumeration);
      // RATE_LIMITED carries the server's retry message.
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function handleWallet(): Promise<void> {
    setWalletBusy(true);
    setFormError(null);
    try {
      await loginWallet();
    } catch (err) {
      setWalletBusy(false);
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  return (
    <OnboardingShell
      eyebrow="Welcome back"
      title="Sign in"
      supporting="Pick up where you left off."
    >
      <form onSubmit={(e) => void handleEmailSubmit(e)} noValidate aria-label="Sign in with email">
        <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
          <div>
            <label htmlFor="login-email" className={ONBOARDING_LABEL_CLASS}>
              Email
            </label>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={ONBOARDING_INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="login-password" className={ONBOARDING_LABEL_CLASS}>
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className={ONBOARDING_INPUT_CLASS}
            />
          </div>
          {formError ? <OnboardingFieldError message={formError} /> : null}
          <button type="submit" disabled={emailBusy} className={ONBOARDING_PRIMARY_CTA_CLASS}>
            {emailBusy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
      <button
        type="button"
        disabled={walletBusy}
        onClick={() => void handleWallet()}
        className={ONBOARDING_SECONDARY_CTA_CLASS}
      >
        {walletBusy ? 'Connecting…' : 'Sign in with wallet'}
      </button>
      <p className="text-center text-body text-muted">Don&apos;t have an account?</p>
      <Link
        to="/welcome"
        className="inline-flex min-h-touch w-full items-center justify-center rounded-pill border border-border-strong bg-transparent px-5 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
      >
        Sign up
      </Link>
    </OnboardingShell>
  );
}
