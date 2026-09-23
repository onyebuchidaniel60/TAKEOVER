// Hold one unit of a claimable opening, then open the claim page.
// No wallet SDK here — the session cookie authenticates the POST.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { createClaim } from '../lib/slots';

export default function ClaimButton({ slotId }: { slotId: string }) {
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = (): void => {
    setClaiming(true);
    setError(null);
    void createClaim(slotId)
      .then(({ claim }) => {
        navigate(`/claim/${claim.id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setClaiming(false);
      });
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={claiming}
        className="min-h-touch w-full rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface focus-visible:ring-accent focus-visible:ring-offset-surface"
      >
        {claiming ? 'Holding your spot…' : 'Claim this opening'}
      </button>
      {error ? (
        <p className="mt-2 text-body font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
