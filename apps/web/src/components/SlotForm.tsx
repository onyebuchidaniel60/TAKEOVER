// Provider slot form (create + draft edit). Consumer language only.
// Price is entered in USDT ("1.5"); the parent converts nothing — this form
// emits exact base units via parseUsdtToBaseUnits.
import { useState } from 'react';
import {
  CONTACT_NOTE_MAX_LENGTH,
  parseUsdtToBaseUnits,
  SLOT_CATEGORIES,
  validateContactNote,
  validateSlotEndsAt,
  validateSlotPrice,
  validateSlotQuantity,
  validateSlotStartsAt,
  validateSlotTitle,
  type OwnerSlot,
  type SlotWrite,
} from '../lib/slots';
import { formatUsdt } from '../lib/slots';

export interface SlotFormValues {
  title: string;
  description: string;
  category: string;
  location_label: string;
  starts_at: string;
  ends_at: string;
  price: string;
  total_quantity: string;
  /** Buyer contact note (raw field text; empty means none). */
  provider_contact_note: string;
}

const inputClass =
  'min-h-touch w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-muted focus-visible:ring-accent';

const labelClass = 'mb-1 block text-small font-medium text-muted';

function isoToInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function baseUnitsToUsdt(priceUsdt: string): string {
  try {
    return formatUsdt(priceUsdt).replace(/ USDT$/, '');
  } catch {
    return '';
  }
}

export function initialValues(slot?: OwnerSlot): SlotFormValues {
  return {
    title: slot?.title ?? '',
    description: slot?.description ?? '',
    category: slot?.category ?? '',
    location_label: slot?.location_label ?? '',
    starts_at: isoToInput(slot?.starts_at ?? null),
    ends_at: isoToInput(slot?.ends_at ?? null),
    price: slot ? baseUnitsToUsdt(slot.price_usdt) : '',
    total_quantity: slot ? String(slot.total_quantity) : '',
    provider_contact_note: slot?.provider_contact_note ?? '',
  };
}

function FieldMessage({ message }: { message: string }): React.JSX.Element {
  return (
    <p className="mt-1 text-body font-medium text-danger" role="alert">
      {message}
    </p>
  );
}

export default function SlotForm({
  initial,
  submitLabel,
  submitting,
  serverError,
  onSubmit,
  commercialLocked = false,
  onSubmitNote,
}: {
  initial: SlotFormValues;
  submitLabel: string;
  submitting: boolean;
  serverError: string | null;
  /**
   * Draft submit: commercial body plus the note as trimmed text, or null
   * when the field is empty. The parent PATCHes the note separately when
   * it differs from the stored one (the slot PATCH endpoint accepts no
   * note field — two calls, one user action).
   */
  onSubmit: (body: SlotWrite, note: string | null) => void;
  /**
   * Locked mode (published slots): commercial fields render disabled and
   * the note is the only editable field. Submit calls onSubmitNote
   * instead of onSubmit — commercial values are never sent.
   */
  commercialLocked?: boolean;
  onSubmitNote?: (note: string | null) => void;
}) {
  const [values, setValues] = useState<SlotFormValues>(initial);
  // Per-field inline reasons mirroring the
  // server rules publish enforces. The server stays authoritative — these
  // only block the request early with a clearer message.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof SlotFormValues, string>>>({});

  const set =
    (key: keyof SlotFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((prev) => ({ ...prev, [key]: event.target.value }));
    };

  /** Trimmed note, or null when the field is empty. */
  const noteOrNull = (): string | null => {
    const trimmed = values.provider_contact_note.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const noteError = validateContactNote(values.provider_contact_note);
    if (commercialLocked) {
      // Note-only save: commercial fields are disabled and untouched.
      if (noteError) {
        setFieldErrors({ provider_contact_note: noteError });
        return;
      }
      setFieldErrors({});
      onSubmitNote?.(noteOrNull());
      return;
    }
    const errors: Partial<Record<keyof SlotFormValues, string>> = {};
    const titleError = validateSlotTitle(values.title);
    if (titleError) errors.title = titleError;
    const startsAt = inputToIso(values.starts_at);
    const startsError = validateSlotStartsAt(startsAt);
    if (startsError) errors.starts_at = startsError;
    const endsError = validateSlotEndsAt(startsAt, values.ends_at);
    if (endsError) errors.ends_at = endsError;
    const priceError = validateSlotPrice(values.price);
    if (priceError) errors.price = priceError;
    const quantityError = validateSlotQuantity(values.total_quantity);
    if (quantityError) errors.total_quantity = quantityError;
    if (noteError) errors.provider_contact_note = noteError;
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    let priceUsdt: string;
    try {
      priceUsdt = parseUsdtToBaseUnits(values.price);
    } catch (err) {
      // Unreachable when the validator above passes (same parser), kept as a
      // backstop so a divergence can never submit a bad amount.
      setFieldErrors({ price: err instanceof Error ? err.message : 'Enter a valid price.' });
      return;
    }
    const totalQuantity = Number(values.total_quantity);
    // Unreachable when validation above passes (narrowing for the type
    // checker; the validators already rejected bad dates).
    if (!startsAt) {
      return;
    }
    const endsAt = inputToIso(values.ends_at);
    onSubmit(
      {
        title: values.title.trim(),
        description: values.description.trim() || undefined,
        category: values.category.trim() || undefined,
        location_label: values.location_label.trim() || undefined,
        starts_at: startsAt,
        ...(endsAt ? { ends_at: endsAt } : {}),
        price_usdt: priceUsdt,
        total_quantity: totalQuantity,
      },
      noteOrNull(),
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <label htmlFor="slot-title" className={labelClass}>
          Title *
        </label>
        <input
          id="slot-title"
          type="text"
          autoComplete="off"
          className={inputClass}
          placeholder="Table for two — tonight"
          value={values.title}
          onChange={set('title')}
          maxLength={200}
          disabled={commercialLocked}
        />
        {fieldErrors.title ? <FieldMessage message={fieldErrors.title} /> : null}
      </div>
      <div>
        <label htmlFor="slot-description" className={labelClass}>
          Description
        </label>
        <textarea
          id="slot-description"
          className={`${inputClass} min-h-area`}
          placeholder="What should guests expect?"
          value={values.description}
          onChange={set('description')}
          maxLength={5000}
          disabled={commercialLocked}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="slot-category" className={labelClass}>
            Category
          </label>
          <select
            id="slot-category"
            className={inputClass}
            value={values.category}
            onChange={set('category')}
            disabled={commercialLocked}
          >
            <option value="">No category</option>
            {SLOT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
            {/* Drafts predating the fixed list keep their value visible instead
                of crashing or blanking; picking a list value replaces it. */}
            {values.category &&
            !(SLOT_CATEGORIES as readonly string[]).includes(values.category) ? (
              <option value={values.category} disabled>
                Custom: {values.category}
              </option>
            ) : null}
          </select>
        </div>
        <div>
          <label htmlFor="slot-location" className={labelClass}>
            Area
          </label>
          <input
            id="slot-location"
            type="text"
            autoComplete="off"
            className={inputClass}
            placeholder="Mitte, Kreuzberg…"
            value={values.location_label}
            onChange={set('location_label')}
            maxLength={200}
            disabled={commercialLocked}
          />
        </div>
        <div>
          <label htmlFor="slot-starts" className={labelClass}>
            Starts *
          </label>
          <input
            id="slot-starts"
            type="datetime-local"
            className={inputClass}
            value={values.starts_at}
            onChange={set('starts_at')}
            disabled={commercialLocked}
          />
          {fieldErrors.starts_at ? <FieldMessage message={fieldErrors.starts_at} /> : null}
        </div>
        <div>
          <label htmlFor="slot-ends" className={labelClass}>
            Ends
          </label>
          <input
            id="slot-ends"
            type="datetime-local"
            className={inputClass}
            value={values.ends_at}
            onChange={set('ends_at')}
            disabled={commercialLocked}
          />
          {fieldErrors.ends_at ? <FieldMessage message={fieldErrors.ends_at} /> : null}
        </div>
        <div>
          <label htmlFor="slot-price" className={labelClass}>
            Price (USDT) *
          </label>
          <input
            id="slot-price"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={inputClass}
            placeholder="1.5"
            value={values.price}
            onChange={set('price')}
            disabled={commercialLocked}
          />
          {fieldErrors.price ? <FieldMessage message={fieldErrors.price} /> : null}
        </div>
        <div>
          <label htmlFor="slot-qty" className={labelClass}>
            Spots *
          </label>
          <input
            id="slot-qty"
            type="number"
            min={1}
            step={1}
            className={inputClass}
            placeholder="2"
            value={values.total_quantity}
            onChange={set('total_quantity')}
            disabled={commercialLocked}
          />
          {fieldErrors.total_quantity ? <FieldMessage message={fieldErrors.total_quantity} /> : null}
        </div>
      </div>
      <div>
        <label htmlFor="slot-contact-note" className={labelClass}>
          Contact for the buyer
        </label>
        <p className="mb-1 text-small text-muted">
          Shown to the buyer only once their claim is funded. No links or URLs.
        </p>
        <textarea
          id="slot-contact-note"
          className={`${inputClass} min-h-area`}
          placeholder="Where to meet, what to bring…"
          value={values.provider_contact_note}
          onChange={set('provider_contact_note')}
          maxLength={CONTACT_NOTE_MAX_LENGTH + 50}
          aria-describedby="slot-contact-note-count"
        />
        <p
          id="slot-contact-note-count"
          className="mt-1 font-mono text-small tabular-nums text-muted"
        >
          {values.provider_contact_note.trim().length}/{CONTACT_NOTE_MAX_LENGTH} characters
        </p>
        {fieldErrors.provider_contact_note ? (
          <FieldMessage message={fieldErrors.provider_contact_note} />
        ) : null}
      </div>
      {serverError ? (
        <p className="text-body font-medium text-danger" role="alert">
          {serverError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface focus-visible:ring-accent focus-visible:ring-offset-surface"
      >
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
