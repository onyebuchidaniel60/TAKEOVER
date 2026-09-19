// Provider display-name validation. Only display_name is editable;
// trim first so length and link checks run on the stored value (which also
// makes leading/trailing whitespace and whitespace-only input impossible).
import { z } from 'zod';

export const providerProfileBodySchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(2, { message: 'Display name must be at least 2 characters.' })
      .max(60, { message: 'Display name must be at most 60 characters.' })
      .refine((value) => !/https?:\/\//i.test(value), {
        message: 'Display name must not contain links.',
      })
      .refine((value) => !/www\./i.test(value), {
        message: 'Display name must not contain links.',
      }),
  })
  .strict();
