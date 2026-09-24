// Create a draft opening. Auth-guarded.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SlotForm, { initialValues } from '../components/SlotForm';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { createSlot, updateSlotContactNote, type SlotWrite } from '../lib/slots';

export default function SellNew() {
  usePageMeta({ title: 'New opening — TAKEOVER' });
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Create first, then the contact-note PATCH in the same user action
  // when a note was entered (the create endpoint accepts no note field
  // — double round-trip, reported in Phase 4c). If the note PATCH fails
  // after the slot exists, we still navigate: the draft keeps an empty
  // note field for re-entry, which beats duplicating the slot on retry.
  const handleSubmit = (body: SlotWrite, note: string | null): void => {
    setSubmitting(true);
    setServerError(null);
    void createSlot(body)
      .then(({ slot }) => {
        if (note === null) {
          navigate(`/sell/${slot.id}`);
          return;
        }
        void updateSlotContactNote(slot.id, note).then(
          () => navigate(`/sell/${slot.id}`),
          () => navigate(`/sell/${slot.id}`),
        );
      })
      .catch((err: unknown) => {
        setServerError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSubmitting(false);
      });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/sell" className="inline-block min-h-touch py-2 text-body font-medium text-muted">
        ← Back to my openings
      </Link>
      <h1 className="mt-1 text-h1 font-bold text-text">New opening</h1>
      <p className="mt-1 text-body text-muted">
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
