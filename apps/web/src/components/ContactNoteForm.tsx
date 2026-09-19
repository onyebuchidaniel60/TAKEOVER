// One-way provider contact note — set/clear on the
// owned slot. Client mirrors the server rules for UX only (trimmed 1–500
// chars; no `://` or `www.` case-insensitive; null clears); the server
// stays authoritative. The note is buyer-visible only past the escrow
// gate — the provider sees their own text back here after save.
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { updateSlotContactNote, type OwnerSlot } from '../lib/slots';

export const CONTACT_NOTE_MAX_LENGTH = 500;

function containsUrl(value: string): boolean {
  return value.includes('://') || value.toLowerCase().includes('www.');
}

/** Client-side mirror of the server rules. Returns an error copy or null when ok. */
export function validateContactNote(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'Enter a note, or use Clear to remove it.';
  }
  if (trimmed.length > CONTACT_NOTE_MAX_LENGTH) {
    return `Keep it under ${CONTACT_NOTE_MAX_LENGTH} characters.`;
  }
  if (containsUrl(trimmed)) {
    return 'Links and URLs aren’t allowed in the contact note.';
  }
  return null;
}

export default function ContactNoteForm({
  slot,
  onSaved,
}: {
  slot: OwnerSlot;
  onSaved: (slot: OwnerSlot) => void;
}) {
  const [text, setText] = useState(slot.provider_contact_note ?? '');
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = (note: string | null): void => {
    setError(null);
    setSaved(false);
    if (note !== null) {
      const invalid = validateContactNote(note);
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    if (note === null) {
      setClearing(true);
    } else {
      setBusy(true);
    }
    void updateSlotContactNote(slot.id, note === null ? null : note.trim())
      .then(({ slot: updated }) => {
        setText(updated.provider_contact_note ?? '');
        setSaved(true);
        onSaved(updated);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        setBusy(false);
        setClearing(false);
      });
  };

  return (
    <div className="rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa">
      <label htmlFor={`contact-note-${slot.id}`} className="block text-body font-medium text-bark dark:text-parchment">
        Buyer contact note
      </label>
      <p className="mt-1 text-small text-muted dark:text-drift">
        Shown to the buyer only once their claim is funded. No links or URLs.
      </p>
      <textarea
        id={`contact-note-${slot.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={CONTACT_NOTE_MAX_LENGTH + 50}
        aria-describedby={`contact-note-count-${slot.id}`}
        className="mt-2 min-h-touch w-full rounded-lg border border-borderwarm px-3 py-2 text-body text-bark placeholder:text-muted dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:placeholder:text-drift"
      />
      <p id={`contact-note-count-${slot.id}`} className="mt-1 font-mono text-small tabular-nums text-muted dark:text-drift">
        {text.trim().length}/{CONTACT_NOTE_MAX_LENGTH} characters
      </p>
      {error && (
        <p className="mt-1 text-body text-clay dark:text-clayd" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-1 text-body font-medium text-bark dark:text-parchment" aria-live="polite">
          Saved.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => save(text)}
          disabled={busy || clearing}
          className="inline-flex min-h-touch items-center rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 dark:bg-sandlight dark:text-coal"
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
        <button
          type="button"
          onClick={() => save(null)}
          disabled={busy || clearing || (slot.provider_contact_note ?? null) === null}
          className="inline-flex min-h-touch items-center rounded-lg border border-borderwarm px-4 py-2 text-body font-medium text-bark disabled:opacity-50 dark:border-rootedge dark:bg-cocoa dark:text-parchment"
        >
          {clearing ? 'Clearing…' : 'Clear'}
        </button>
      </div>
    </div>
  );
}
