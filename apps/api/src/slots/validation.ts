// Phase 5: provider slot input validation. Zod guards shapes at the API
// boundary; the pure helpers below guard lifecycle semantics and are unit
// tested without a database.
import { z } from 'zod';
import { AppError } from '../http/errors';
import { canonicalizeNimiqAddress, InvalidAddressError } from '../auth/nimiq-address';
import { serializePriceNim } from './price';

export const slotStatusValues = ['draft', 'published', 'sold_out', 'cancelled', 'expired'] as const;

// Length bounds are anti-abuse caps only (DB text columns are unbounded).
const slotFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  location_label: z.string().max(200).optional(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).optional(),
  price_nim: z.string().refine(
    (v) => {
      try {
        serializePriceNim(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'price_nim must be a positive integer string' },
  ),
  // Upper bound is the Postgres INT4 ceiling, not a business rule.
  total_quantity: z.number().int().min(1).max(2147483647),
  // Shape only here; checksum/canonical form is enforced in the service so the
  // same rule covers create, patch, and publish.
  payout_wallet: z.string().min(1).max(64),
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
    price_nim: slotFields.price_nim,
    total_quantity: slotFields.total_quantity,
    payout_wallet: slotFields.payout_wallet,
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

// Phase 14g-1: publish body. Wire-optional ({} stays valid for the no-fee
// path); required-by-policy when the fee is configured (the lifecycle throws
// PAYMENT_INVALID_TX then). Shape-only here — hash well-formedness is the
// service's normalizeFeeHash check. Strict: unknown fields → 400.
export const publishBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({ transactionHash: z.string().optional() }).strict(),
);

export type PublishBody = z.infer<typeof publishBodySchema>;

// Phase 14d-4: one-way provider contact note. Free-form text, 1–500 chars
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

export type SlotCreateInput = z.infer<typeof slotCreateSchema>;
export type SlotPatchInput = z.infer<typeof slotPatchSchema>;
export type SlotStatusValue = (typeof slotStatusValues)[number];

export interface PublishableInput {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  priceNim: bigint;
  totalQuantity: number;
  payoutWallet: string;
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
  if (!(input.priceNim > 0n)) {
    failed.push('price_nim');
  }
  if (!(Number.isInteger(input.totalQuantity) && input.totalQuantity > 0)) {
    failed.push('total_quantity');
  }
  try {
    canonicalizeNimiqAddress(input.payoutWallet);
  } catch {
    failed.push('payout_wallet');
  }
  return failed;
}

/** Canonicalize a payout wallet or throw 400 (bad checksum included). */
export function canonicalizePayoutWallet(value: string): string {
  try {
    return canonicalizeNimiqAddress(value);
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid payout wallet address.');
    }
    throw err;
  }
}

type SlotStatus = SlotStatusValue;

/**
 * MVP restriction (stricter than "commercial fields immutable"): published
 * slots cannot be edited at all — only drafts. Documented in AI_HANDOFF.
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
