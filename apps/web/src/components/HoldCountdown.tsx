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

// Live countdown to the hold deadline. Ticks every second, clamps at zero.
export default function HoldCountdown({ holdExpiresAt }: { holdExpiresAt: string }) {
  const [remaining, setRemaining] = useState(() => remainingMs(holdExpiresAt));

  useEffect(() => {
    setRemaining(remainingMs(holdExpiresAt));
    const timer = setInterval(() => {
      setRemaining(remainingMs(holdExpiresAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt]);

  if (remaining <= 0) {
    return <span className="text-sm font-semibold text-slate-500">Hold ended</span>;
  }
  return (
    <span
      className="text-sm font-semibold tabular-nums"
      role="timer"
      aria-label={`Hold ends in ${formatRemaining(remaining)}`}
    >
      {formatRemaining(remaining)} left
    </span>
  );
}
