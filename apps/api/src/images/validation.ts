// Shared base64 image validation (profile avatars + opening images).
// Both are stored as data URIs in TEXT columns — no Storage bucket, no
// external service — capped at 200KB decoded so rows stay small. The client
// resizes + re-encodes through canvas before upload (apps/web/src/lib/image.ts);
// the server re-checks shape and size and stays authoritative.
import { z } from 'zod';

/** Decoded-size cap: 200KB. Larger uploads are rejected with 400. */
export const IMAGE_DATA_MAX_BYTES = 200 * 1024;

/** Allowed shapes: JPEG, PNG, or WebP data URIs with a base64 payload. */
const IMAGE_DATA_URI_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decoded byte length of the base64 payload. Total (never throws — a
 * malformed URI measures Infinity so the size refinement rejects it):
 * zod refinements run even when the shape regex already failed, so a
 * throw here would escape safeParse as a 500 instead of a 400.
 */
export function decodedImageByteLength(uri: string): number {
  const comma = uri.indexOf(',');
  if (comma < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Buffer.from(uri.slice(comma + 1), 'base64').length;
}

const imageDataUri = z
  .string()
  .regex(IMAGE_DATA_URI_PATTERN, {
    message: 'Image must be a JPEG, PNG, or WebP data URI.',
  })
  .refine((value) => decodedImageByteLength(value) <= IMAGE_DATA_MAX_BYTES, {
    message: 'Image must be 200KB or smaller.',
  });

/** Set-or-clear shape ({ avatarData / image_data: string | null }). Null clears. */
export const nullableImageDataField = imageDataUri.nullable();

/** Optional shape for create/patch bodies (undefined = unchanged). */
export const optionalImageDataField = imageDataUri.nullable().optional();
