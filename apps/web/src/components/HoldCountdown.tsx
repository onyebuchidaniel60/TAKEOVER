import { useEffect, useState } from 'react';

function remainingMs(targetIso: string): number {
  return Math.max(0, new Date(targetIso).getTime() - Date.now());
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// Screen-reader announcement bands (ms remaining): the live region changes
// ONLY when a 5 min / 1 min / 30s / 10s threshold is crossed — never every
// second and never every minute in between.
function announcementFor(remaining: number): string | null {
  if (remaining <= 0) {
    return 'Hold expired.';
  }
  if (remaining <= 10 * 1000) {
    return 'Hold expires in 10 seconds.';
  }
  if (remaining <= 30 * 1000) {
    return 'Hold expires in 30 seconds.';
  }
  if (remaining <= 60 * 1000) {
    return 'Hold expires in 1 minute.';
  }
  if (remaining <= 5 * 60 * 1000) {
    return 'Hold expires in 5 minutes.';
  }
  return null;
}

// Live countdown to the hold deadline. Ticks every second visually
// (aria-hidden so screen readers are not spammed); a separate polite live
// region announces only the 5 min / 1 min / 30s / 10s thresholds and expiry.
export default function HoldCountdown({ holdExpiresAt }: { holdExpiresAt: string }) {
  const [remaining, setRemaining] = useState(() => remainingMs(holdExpiresAt));
  const [announcement, setAnnouncement] = useState<string | null>(() =>
    announcementFor(remainingMs(holdExpiresAt)),
  );

  useEffect(() => {
    setRemaining(remainingMs(holdExpiresAt));
    setAnnouncement(announcementFor(remainingMs(holdExpiresAt)));
    let lastAnnounced = announcementFor(remainingMs(holdExpiresAt));
    const timer = setInterval(() => {
      const next = remainingMs(holdExpiresAt);
      setRemaining(next);
      const nextAnnouncement = announcementFor(next);
      if (nextAnnouncement !== lastAnnounced) {
        lastAnnounced = nextAnnouncement;
        setAnnouncement(nextAnnouncement);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt]);

  if (remaining <= 0) {
    return (
      <>
        <span className="text-body font-semibold text-muted dark:text-drift">Hold expired</span>
        <span className="sr-only" role="status">
          Hold expired.
        </span>
      </>
    );
  }
  const text = `Hold expires in ${formatRemaining(remaining)}`;
  return (
    <>
      <span className="font-mono text-body font-semibold tabular-nums text-bark dark:text-parchment" aria-hidden="true">
        {text}
      </span>
      {/* Static until a threshold is crossed, so screen readers hear the
          hold state once — then 5 min / 1 min / 30s / 10s / expired only. */}
      <span className="sr-only" role="status">
        {announcement ?? 'Your hold is active.'}
      </span>
    </>
  );
}
