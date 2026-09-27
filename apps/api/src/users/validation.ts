// Self-service profile scalars (Phase 5j): bio, phone, dob, location.
// All four optional; empty string clears to NULL (the same
// empty-to-null convention as the slot filters). Trim first so length
// checks run on the stored value. The server is authoritative — the web
// onboarding form mirrors these rules client-side for inline errors.
import { z } from 'zod';

export const BIO_MAX_LENGTH = 160;
export const PHONE_MAX_LENGTH = 32;
export const LOCATION_MAX_LENGTH = 200;

const emptyToNull = (value: unknown): unknown => (value === '' ? null : value);

/** Real calendar date (rejects 2024-02-30) and not in the future. */
function isValidPastDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return false;
  }
  return dt.getTime() <= Date.now();
}

const bioField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .min(1, { message: 'Bio must be at least 1 character.' })
    .max(BIO_MAX_LENGTH, { message: 'Bio must be at most 160 characters.' })
    .refine((value) => !/https?:\/\//i.test(value), { message: 'Bio must not contain links.' })
    .refine((value) => !/www\./i.test(value), { message: 'Bio must not contain links.' })
    .nullish(),
);

const phoneField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .min(3, { message: 'Phone number looks too short.' })
    .max(PHONE_MAX_LENGTH, { message: 'Phone number must be at most 32 characters.' })
    .refine((value) => /^[+0-9()\-.\s]+$/.test(value), {
      message: 'Phone number contains invalid characters.',
    })
    .nullish(),
);

const dobField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date of birth must be YYYY-MM-DD.' })
    .refine(isValidPastDate, { message: 'Date of birth must be a real past date.' })
    .nullish(),
);

const locationField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .min(1, { message: 'Location must be at least 1 character.' })
    .max(LOCATION_MAX_LENGTH, { message: 'Location must be at most 200 characters.' })
    .nullish(),
);

export const userProfileBodySchema = z
  .object({
    bio: bioField,
    phone: phoneField,
    dob: dobField,
    location: locationField,
  })
  .strict()
  .partial();

export type UserProfileBody = z.infer<typeof userProfileBodySchema>;
