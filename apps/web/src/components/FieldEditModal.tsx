// Single-field profile edit (Phase 5n-B).
//
// Owner correction: tapping a field row in Profile's Information section
// opened the FULL profile-setup form (name, username, avatar, bio, phone,
// dob, location) — so "set my email" cost a screen showing six fields, none
// of which you wanted. Field-specific editing should be field-specific.
//
// One modal, one field, driven by a small descriptor — a switch on the field
// name would grow a new branch per field and drift. Email is the only
// IDENTITY field (it is the login handle and must be unique), so it is
// labelled and typed differently; the rest are optional profile data.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import {
  updateUserProfile,
  validateDob,
  validateEmailInput,
  validateLocation,
  validatePhone,
} from '../lib/identity';
import { queryKeys } from '../lib/queryKeys';
import { useDialogFocus } from '../lib/dialog-focus';

export type EditableField = 'email' | 'phone' | 'dob' | 'location';

/** Everything the modal needs to render one field. */
interface FieldSpec {
  title: string;
  label: string;
  hint: string;
  type: 'email' | 'tel' | 'date' | 'text';
  autoComplete: string;
  placeholder: string;
  /** Client-side mirror of the server rule; the server stays authoritative. */
  validate: (value: string) => string | null;
}

const SPECS: Record<EditableField, FieldSpec> = {
  email: {
    title: 'Edit email',
    label: 'Email',
    hint: 'This is how you sign in. Changing it takes effect immediately.',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'you@example.com',
    validate: (value) => validateEmailInput(value),
  },
  phone: {
    title: 'Edit phone',
    label: 'Phone',
    hint: 'Optional. Only you can see this.',
    type: 'tel',
    autoComplete: 'tel',
    placeholder: '+49 170 000000',
    validate: (value) => validatePhone(value.trim()),
  },
  dob: {
    title: 'Edit date of birth',
    label: 'Date of birth',
    hint: 'Optional. Only you can see this.',
    type: 'date',
    autoComplete: 'bday',
    placeholder: '',
    validate: (value) => validateDob(value.trim()),
  },
  location: {
    title: 'Edit location',
    label: 'Location',
    hint: 'Optional. Shown on your public profile.',
    type: 'text',
    autoComplete: 'address-level2',
    placeholder: 'Kreuzberg',
    validate: (value) => validateLocation(value.trim()),
  },
};

export default function FieldEditModal({
  field,
  current,
  onClose,
}: {
  field: EditableField;
  current: string | null;
  onClose: () => void;
}) {
  const spec = SPECS[field];
  const panelRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const queryClient = useQueryClient();
  const [value, setValue] = useState(current ?? '');
  const [touched, setTouched] = useState(false);

  const save = useMutation({
    mutationFn: (next: string) =>
      // Empty clears the field: the endpoint takes null to clear, and an
      // untouched optional field should be clearable.
      updateUserProfile({ [field]: next.trim() === '' ? null : next.trim() } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      onClose();
    },
  });

  const clientError = touched ? spec.validate(value) : null;
  const error = clientError ?? (save.error ? describeError(save.error) : null);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-edit-title"
      className="rounded-card border border-border bg-surface-2 p-4"
    >
      <p id="field-edit-title" className="text-h3 font-semibold text-text">
        {spec.title}
      </p>
      <p className="mt-1 text-body text-muted">{spec.hint}</p>
      <form
        className="mt-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (spec.validate(value)) return;
          save.mutate(value);
        }}
      >
        <label htmlFor={`field-edit-${field}`} className="text-body font-medium text-muted">
          {spec.label}
        </label>
        <input
          id={`field-edit-${field}`}
          type={spec.type}
          autoComplete={spec.autoComplete}
          value={value}
          placeholder={spec.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={error ? 'field-edit-error' : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-1 block min-h-touch w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {error ? (
          <p id="field-edit-error" role="alert" className="mt-2 text-body font-medium text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="inline-flex min-h-touch items-center rounded-pill bg-accent px-5 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            className="min-h-touch rounded-pill border border-border-strong bg-surface px-5 py-2 text-body font-medium text-text disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** EMAIL_TAKEN deserves its own sentence; everything else uses the message. */
function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'EMAIL_TAKEN') return 'That email is already in use.';
    return err.message;
  }
  return 'Something went wrong.';
}

// Re-exported so the caller does not need a second import for the type.
export type { FieldSpec };
