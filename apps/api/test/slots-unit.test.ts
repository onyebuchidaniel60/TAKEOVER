// unit tests — no database. Covers price serialization, the filter
// builder, and the future-start boundary rule.
import { describe, expect, it } from 'vitest';
import { serializePriceUsdt } from '../src/slots/price';
import {
  buildPublicSlotConditions,
  escapeLikePattern,
  isStartInFuture,
} from '../src/slots/service';

describe('serializePriceUsdt', () => {
  it('serializes a bigint to its exact decimal string', () => {
    expect(serializePriceUsdt(150000n)).toBe('150000');
  });

  it('keeps full precision for values above 2^53', () => {
    expect(serializePriceUsdt(9007199254740993n)).toBe('9007199254740993');
  });

  it('accepts a valid integer string', () => {
    expect(serializePriceUsdt('2500000')).toBe('2500000');
  });

  it('rejects zero, negative, decimal, and garbage input', () => {
    expect(() => serializePriceUsdt(0n)).toThrow();
    expect(() => serializePriceUsdt(-5n)).toThrow();
    expect(() => serializePriceUsdt('0')).toThrow();
    expect(() => serializePriceUsdt('-10')).toThrow();
    expect(() => serializePriceUsdt('1.5')).toThrow();
    expect(() => serializePriceUsdt('abc')).toThrow();
    expect(() => serializePriceUsdt('')).toThrow();
    expect(() => serializePriceUsdt(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe('buildPublicSlotConditions', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('contains only the two base conditions when every filter is empty', () => {
    expect(buildPublicSlotConditions({}, now)).toHaveLength(2);
    expect(buildPublicSlotConditions({ q: '', category: '  ' }, now)).toHaveLength(2);
  });

  it('appends one condition per present filter', () => {
    const base = 2;
    expect(buildPublicSlotConditions({ q: 'yoga' }, now)).toHaveLength(base + 1);
    expect(buildPublicSlotConditions({ category: 'fitness' }, now)).toHaveLength(base + 1);
    expect(buildPublicSlotConditions({ location: 'Mitte' }, now)).toHaveLength(base + 1);
    expect(buildPublicSlotConditions({ from: new Date() }, now)).toHaveLength(base + 1);
    expect(buildPublicSlotConditions({ to: new Date() }, now)).toHaveLength(base + 1);
    expect(
      buildPublicSlotConditions(
        {
          q: 'yoga',
          category: 'fitness',
          location: 'Mitte',
          from: new Date(),
          to: new Date(),
        },
        now,
      ),
    ).toHaveLength(base + 5);
  });

  it('escapes LIKE wildcards in free text', () => {
    expect(escapeLikePattern('100%_x\\y')).toBe('100\\%\\_x\\\\y');
  });
});

describe('isStartInFuture', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('excludes a slot starting exactly at now (past, not future)', () => {
    expect(isStartInFuture(new Date(now.getTime()), now)).toBe(false);
  });

  it('excludes past starts and includes future starts', () => {
    expect(isStartInFuture(new Date(now.getTime() - 1), now)).toBe(false);
    expect(isStartInFuture(new Date(now.getTime() + 1), now)).toBe(true);
  });
});
