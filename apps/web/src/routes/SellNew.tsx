// Phase 5: create a draft opening. Auth-guarded.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SlotForm, { initialValues } from '../components/SlotForm';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { createSlot, type SlotWrite } from '../lib/slots';

export default function SellNew() {
  usePageMeta({ title: 'New opening — TAKEOVER' });
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = (body: SlotWrite): void => {
    setSubmitting(true);
    setServerError(null);
    void createSlot(body)
      .then(({ slot }) => {
        navigate(`/sell/${slot.id}`);
      })
      .catch((err: unknown) => {
        setServerError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSubmitting(false);
      });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/sell" className="inline-block min-h-touch py-2 text-body font-medium text-slate-600 dark:text-stone-400">
        ← Back to my openings
      </Link>
      <h1 className="mt-1 text-h1 font-bold text-slate-900 dark:text-stone-100">New opening</h1>
      <p className="mt-1 text-body text-slate-500 dark:text-stone-400">
        Saved as a draft first — nothing goes public until you publish it.
      </p>
      <div className="mt-4">
        <SlotForm
          initial={initialValues()}
          submitLabel="Save draft"
          submitting={submitting}
          serverError={serverError}
          onSubmit={handleSubmit}
        />
      </div>
    </main>
  );
}
