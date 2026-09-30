// Single onboarding redirect (Phase 5j, Part A). Mounted once inside the
// router: on every location/auth change it applies the pure
// onboardingRedirect() decision (see lib/onboarding) via replace
// navigation. Unknown onboardedAt (verify-shaped user before the first
// refresh) reads as must-onboard — refresh() on app start and after every
// auth success resolves it to the canonical /me value immediately.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { onboardingRedirect } from '../lib/onboarding';
import { useAuth } from '../store/auth';

export default function OnboardingRedirect() {
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
  const onboardedAt = useAuth((s) => s.user?.onboardedAt ?? null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const to = onboardingRedirect(
      { initialized, status, onboardedAt },
      location.pathname,
      // Phase 5k-B: the ?from=settings edit variant of /onboarding/profile is
      // reached from /profile by an already-onboarded user, so the guard
      // needs the query string to tell it apart from an onboarding step.
      location.search,
    );
    if (to) {
      navigate(to, { replace: true });
    }
  }, [initialized, status, onboardedAt, location, navigate]);

  return null;
}
