// Phase 7: exact unit math for payment amounts. Pure BigInt — never floats,
// so large base-unit values stay precise. (The web sell form keeps its own
// identical copy: apps/web has no test runner, so the tested reference lives
// here. See AI_HANDOFF Phase 7.)

const BASE_UNITS_PER_NIM = 100_000n;
const MAX_NIM_DECIMALS = 5;

/**
 * Convert a human NIM amount ("1.5", "0.00001") to exact base-unit string.
 * Throws on garbage, non-positive values, or more than 5 decimals.
 */
export function nimToBaseUnits(input: string): string {
  const trimmed = input.trim();
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(trimmed);
  if (!match) {
    throw new Error('Enter an amount like 1.5 (up to 5 decimals).');
  }
  const whole = BigInt(match[1] ?? '0');
  const frac = (match[2] ?? '').padEnd(MAX_NIM_DECIMALS, '0');
  const value = whole * BASE_UNITS_PER_NIM + BigInt(frac);
  if (value <= 0n) {
    throw new Error('Amount must be more than 0.');
  }
  return value.toString();
}

/**
 * Phase 14g-1 (F2): reverse of nimToBaseUnits — exact base-unit string back
 * to a trimmed decimal NIM string ("40000000" -> "400", "150000" -> "1.5").
 * Throws on garbage or non-positive values. Pure BigInt, never floats.
 */
export function nimFromBaseUnits(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Enter a base-unit amount like 150000.');
  }
  const value = BigInt(trimmed);
  if (value <= 0n) {
    throw new Error('Amount must be more than 0.');
  }
  const whole = value / BASE_UNITS_PER_NIM;
  const frac = value % BASE_UNITS_PER_NIM;
  if (frac === 0n) {
    return whole.toString();
  }
  const fracStr = frac.toString().padStart(MAX_NIM_DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}
