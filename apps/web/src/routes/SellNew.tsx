// Create a draft opening. Auth-guarded.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import SlotForm, { initialValues } from '../components/SlotForm';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { createSlot, updateSlotContactNote, type SlotWrite } from '../lib/slots';

export default function SellNew() {
  usePageMeta({ title: 'New opening — TAKEOVER' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: SlotWrite) => createSlot(body),
  });
  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => updateSlotContactNote(id, note),
  });

  // Create first, then the contact-note PATCH in the same user action
  // when a note was entered (the create endpoint accepts no note field
  // — double round-trip, reported in Phase 4c). If the note PATCH fails
  // after the slot exists, we still navigate (duplicating the slot on
  // retry would be worse) but flag it: SellDetail shows a dismissible
  // "note wasn't saved" banner so the miss is never silent.
  const handleSubmit = (body: SlotWrite, note: string | null): void => {
    setSubmitting(true);
    setServerError(null);
    void createMutation
      .mutateAsync(body)
      .then(({ slot }) => {
        // New listings stale every list cache they appear in.
        void queryClient.invalidateQueries({ queryKey: ['my-slots'] });
        void queryClient.invalidateQueries({ queryKey: ['slots'] });
        if (note === null) {
          navigate(`/sell/${slot.id}`);
          return;
        }
        void noteMutation.mutateAsync({ id: slot.id, note }).then(
          () => navigate(`/sell/${slot.id}`),
          () => navigate(`/sell/${slot.id}`, { state: { noteFailed: true } }),
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
