// Phase 4: price_nim is BIGINT in Postgres (integer NIM base units, never floats).
// JSON has no bigint, so the public API always serializes it as a decimal string.
// A JS number must never be used: values above 2^53 would silently lose precision.

/** Serialize a NIM base-unit amount to its exact decimal string form. */
export function serializePriceNim(value: bigint | string | number): string {
  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new Error('price_nim must be positive');
    }
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('price_nim must be a positive safe integer');
    }
    return BigInt(value).toString();
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('price_nim must be a positive integer string');
  }
  // Normalize (strip any leading zeros via BigInt round-trip; input is validated).
  return BigInt(value).toString();
}
