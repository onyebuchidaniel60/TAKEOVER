// Provider slot input validation. Zod guards shapes at the API
// boundary; the pure helpers below guard lifecycle semantics and are unit
// tested without a database.
import { z } from 'zod';
import { AppError } from '../http/errors';
import { nullableImageDataField, optionalImageDataField } from '../images/validation';
import { serializePriceUsdt } from './price';

export const slotStatusValues = ['draft', 'published', 'sold_out', 'cancelled', 'expired'] as const;

// Length bounds are anti-abuse caps only (DB text columns are unbounded).
const slotFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  location_label: z.string().max(200).optional(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).optional(),
  price_usdt: z.string().refine(
    (v) => {
      try {
        serializePriceUsdt(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'price_usdt must be a positive integer string' },
  ),
  // Upper bound is the Postgres INT4 ceiling, not a business rule.
  total_quantity: z.number().int().min(1).max(2147483647),
  // Optional opening image (data URI, 200KB cap). Not a commercial field:
  // accepted on create and draft-patch; published slots use the dedicated
  // image endpoint instead (same split as the contact note).
  image_data: optionalImageDataField,
};

// POST /slots: drafts are a scratchpad, so only shapes are validated here.
// Semantic gates (future start, ends-after-start, …) run at publish time.
export const slotCreateSchema = z
  .object({
    title: slotFields.title,
    description: slotFields.description,
    category: slotFields.category,
    location_label: slotFields.location_label,
    starts_at: slotFields.starts_at,
    ends_at: slotFields.ends_at,
    price_usdt: slotFields.price_usdt,
    total_quantity: slotFields.total_quantity,
    image_data: slotFields.image_data,
  })
  .strict();

// PATCH: same field validation as create, but every field optional.
export const slotPatchSchema = slotCreateSchema.partial().strict();

export const meSlotsQuerySchema = z
  .object({
    status: z.enum(slotStatusValues).optional(),
    limit: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.coerce.number().int().min(1).max(50).default(20),
    ),
    offset: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.coerce.number().int().min(0).default(0),
    ),
  })
  .strict();

export const slotIdParamsSchema = z.object({ slotId: z.string().uuid() }).strict();

// Publish body. Wire-optional ({} stays valid for the no-fee
// path); required-by-policy when the fee is configured (the lifecycle throws
// PAYMENT_INVALID_TX then). Shape-only here — hash well-formedness is the
// service's normalizeFeeHash check. Strict: unknown fields → 400.
export const publishBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({ transactionHash: z.string().optional() }).strict(),
);

export type PublishBody = z.infer<typeof publishBodySchema>;

// One-way provider contact note. Free-form text, 1–500 chars
// after trimming; null clears the note. The no-URLs rule (any scheme `://`
// or `www.`, case-insensitive) keeps the note from becoming an off-platform
// payment channel — chat/messaging was declined for the same reason. Length
// and URL rules run on the trimmed (stored) value, matching the display_name
// precedent of validating what is stored.
export const CONTACT_NOTE_MAX_LENGTH = 500;

/** True when the value carries a URL of any scheme (`://`) or a `www.` host. */
export function contactNoteContainsUrl(value: string): boolean {
  return value.includes('://') || value.toLowerCase().includes('www.');
}

export const contactNoteBodySchema = z
  .object({
    provider_contact_note: z
      .string()
      .trim()
      .min(1, { message: 'Provider contact note must be at least 1 character.' })
      .max(CONTACT_NOTE_MAX_LENGTH, {
        message: 'Provider contact note must be at most 500 characters.',
      })
      .refine((value) => !contactNoteContainsUrl(value), {
        message: 'Provider contact note must not contain links or URLs.',
      })
      .nullable(),
  })
  .strict();

export type ContactNoteInput = z.infer<typeof contactNoteBodySchema>;

// Opening image set-or-clear. Free-form data URI (JPEG/PNG/WebP, 200KB
// cap); null clears the image. Shape + size run in images/validation.ts;
// strict here so unknown fields → 400.
export const slotImageBodySchema = z
  .object({
    image_data: nullableImageDataField,
  })
  .strict();

export type SlotImageInput = z.infer<typeof slotImageBodySchema>;

export type SlotCreateInput = z.infer<typeof slotCreateSchema>;
export type SlotPatchInput = z.infer<typeof slotPatchSchema>;
export type SlotStatusValue = (typeof slotStatusValues)[number];

export interface PublishableInput {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  priceUsdt: bigint;
  totalQuantity: number;
}

/**
 * Pure publish gate. Returns the names of fields that fail; empty means the
 * draft may publish. Each rule maps to one locked publish requirement.
 */
export function validatePublishable(input: PublishableInput, now: Date): string[] {
  const failed: string[] = [];
  if (input.title.trim().length === 0) {
    failed.push('title');
  }
  if (!(input.startsAt.getTime() > now.getTime())) {
    failed.push('starts_at');
  }
  if (input.endsAt !== null && !(input.endsAt.getTime() > input.startsAt.getTime())) {
    failed.push('ends_at');
  }
  if (!(input.priceUsdt > 0n)) {
    failed.push('price_usdt');
  }
  if (!(Number.isInteger(input.totalQuantity) && input.totalQuantity > 0)) {
    failed.push('total_quantity');
  }
  return failed;
}

type SlotStatus = SlotStatusValue;

/**
 * MVP restriction (stricter than "commercial fields immutable"): published
 * slots cannot be edited at all — only drafts. See ARCHITECTURE.md §8.
 */
export function requireDraftForEdit(status: SlotStatus): void {
  if (status !== 'draft') {
    throw new AppError(409, 'SLOT_NOT_EDITABLE', 'Only draft slots can be edited.');
  }
}

export function requireDraftForPublish(status: SlotStatus): void {
  if (status !== 'draft') {
    throw new AppError(409, 'SLOT_NOT_PUBLISHABLE', 'Only draft slots can be published.');
  }
}

export function requireCancellableStatus(status: SlotStatus): void {
  if (status !== 'draft' && status !== 'published') {
    throw new AppError(409, 'SLOT_NOT_CANCELLABLE', 'This slot can no longer be cancelled.');
  }
}
