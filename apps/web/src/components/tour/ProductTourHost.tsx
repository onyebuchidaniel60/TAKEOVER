// Tour trigger + persistence (Phase 5j-2, Part B4). Mounted on Home.
// Shows the overlay only when ALL hold: authenticated, onboarded,
// tour unseen — after a ~600ms delay so the feed renders and the first
// card is in the DOM. Finish and skip both persist (POST
// /me/tour-completed + ['me'] invalidation); the overlay unmounts
// regardless of the POST outcome, and the next Home visit retries while
// the column is still NULL. Runs once per user, ever (server column).
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../store/auth';
import ProductTour from './ProductTour';
import { TOUR_STOPS } from './tour-steps';

const TOUR_DELAY_MS = 600;

export default function ProductTourHost() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const markTourCompleted = useAuth((s) => s.markTourCompleted);
  const queryClient = useQueryClient();
  const [show, setShow] = useState(false);

  const eligible =
    status === 'authenticated' &&
    user !== null &&
    user.onboardedAt != null &&
    user.tourCompletedAt == null;

  useEffect(() => {
    if (!eligible) {
      setShow(false);
      return;
    }
    const timer = window.setTimeout(() => setShow(true), TOUR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  if (!show || !eligible) {
    return null;
  }

  async function done(): Promise<void> {
    // Unmount first — a failed POST must never block the user.
    setShow(false);
    try {
      await markTourCompleted();
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    } catch {
      // Stays NULL server-side: the next Home visit retries.
    }
  }

  return <ProductTour stops={TOUR_STOPS} onFinish={() => void done()} onSkip={() => void done()} />;
}
