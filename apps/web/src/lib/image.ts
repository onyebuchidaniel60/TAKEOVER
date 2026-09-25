// Client-side image prep (Phase 5d). Files are resized through canvas and
// re-encoded as JPEG data URIs capped at 200KB — the same cap the server
// enforces (images/validation.ts). Re-encoding strips EXIF (GPS, device
// IDs) by construction: pixels are redrawn, metadata is not carried over.
// No new dependency: createImageBitmap + canvas are platform APIs.
//
// Quality ladder: try quality 0.85 → 0.7 → 0.6 at full size, then shrink
// the long edge (×0.75 steps, floor 200px) and retry the ladder. Throws a
// friendly Error when nothing fits (callers show it, never crash).
export const IMAGE_MAX_BYTES = 200 * 1024;

const QUALITIES = [0.85, 0.7, 0.6] as const;
const MIN_DIM = 200;

export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
  /** Quality that fit (0.6–0.85). */
  quality: number;
  /** Encode attempts it took (1 = first try fit). */
  steps: number;
}

/** Decoded byte length of a data-URI payload (mirrors the server cap check). */
export function dataUriByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const payload = dataUrl.slice(comma + 1);
  // 4 base64 chars → 3 bytes, minus padding.
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function drawToDataUrl(
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  quality: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not process that image — your browser blocked the canvas.');
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Resize + re-encode an image file to a ≤200KB JPEG data URI.
 * maxDim caps the long edge (400 for avatars, 1200 for opening images).
 */
export async function prepareImage(file: Blob, maxDim: number): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read that image. Try a JPEG or PNG file.');
  }
  try {
    const scale0 = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * scale0));
    let height = Math.max(1, Math.round(bitmap.height * scale0));
    let steps = 0;
    for (;;) {
      for (const quality of QUALITIES) {
        steps += 1;
        const dataUrl = drawToDataUrl(bitmap, width, height, quality);
        if (dataUriByteLength(dataUrl) <= IMAGE_MAX_BYTES) {
          return { dataUrl, width, height, quality, steps };
        }
      }
      // Ladder exhausted at this size: shrink and retry.
      const nextWidth = Math.floor(width * 0.75);
      const nextHeight = Math.floor(height * 0.75);
      if (nextWidth < MIN_DIM && nextHeight < MIN_DIM) {
        throw new Error('That image is too detailed to fit 200KB — try a smaller photo.');
      }
      width = Math.max(MIN_DIM, nextWidth);
      height = Math.max(MIN_DIM, nextHeight);
    }
  } finally {
    bitmap.close();
  }
}
