// Self-service profile scalars (Phase 5j): bio, phone, dob, location.
// All four optional; empty string clears to NULL (the same
// empty-to-null convention as the slot filters). Trim first so length
// checks run on the stored value. The server is authoritative — the web
// onboarding form mirrors these rules client-side for inline errors.
import { z } from 'zod';
import { EMAIL_MAX_LENGTH } from '../auth/identity';

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

/**
 * Email is normalized (trim + lowercase) BEFORE validation and before
 * storage, matching registration, so `Me@Example.com` and
 * `me@example.com` can never become two accounts.
 */
const emailField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .min(3, { message: 'Email must be at least 3 characters.' })
    .max(EMAIL_MAX_LENGTH, { message: 'Email is too long.' })
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'Enter a valid email address.',
    })
    .transform((value) => value.toLowerCase())
    .nullish(),
);

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

const locationField = z.preprocess(  emptyToNull,
  z
    .string()
    .trim()
    .min(1, { message: 'Location must be at least 1 character.' })
    .max(LOCATION_MAX_LENGTH, { message: 'Location must be at most 200 characters.' })
    .nullish(),
);

export const userProfileBodySchema = z
  .object({
    // Phase 5n-B: email became editable after signup so tapping the email
    // row can open a single-field form instead of the full profile screen.
    // It is the one IDENTITY field in this patch (phone/dob/location are
    // optional profile data), so uniqueness is enforced in the service and
    // answers EMAIL_TAKEN — the same rule registration applies.
    email: emailField,
    bio: bioField,
    phone: phoneField,
    dob: dobField,
    location: locationField,
  })
  .strict()
  .partial();

export type UserProfileBody = z.infer<typeof userProfileBodySchema>;

/**
 * Phase 5o-A — one-time username set. A SEPARATE body schema and endpoint,
 * not a field on userProfileBodySchema, for three reasons:
 *   1. Rate limit. The set budget is per-USER (10/hour, one lifetime action);
 *      a preHandler runs before the body is parsed, so a body field on the
 *      shared /me/profile route could not be budgeted separately from the
 *      60/min per-IP profile limiter.
 *   2. Audit. It writes its own `user.username_set` event, not the
 *      `user.profile_updated` field list.
 *   3. Semantics. Setting a handle is a one-time identity write with an
 *      immutability rule; editing profile scalars is neither.
 *
 * Format + reserved-word rules are NOT re-implemented here — validateUsername
 * is the single definition, shared with registration (ARCHITECTURE.md §4:
 * one validator, two callers). A value that survives validateUsername is
 * normalized; anything else is a 400 INVALID_INPUT naming the rule.
 */
export const usernameSetBodySchema = z
  .object({
    username: z.string({ required_error: 'Enter a username.' }).min(1, {
      message: 'Enter a username.',
    }),
  })
  .strict();

export type UsernameSetBody = z.infer<typeof usernameSetBodySchema>;
