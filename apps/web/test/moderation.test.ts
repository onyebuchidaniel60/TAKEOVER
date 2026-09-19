// frontend tests — no backend, no wallet. Covers the admin role
// check (single place both the guard and the nav read) and the locked
// report-reason set mirrored from the API contract.
import { describe, expect, it } from 'vitest';
import { isAdminUser, REPORT_REASON_LABELS, REPORT_REASONS } from '../src/lib/admin';
import { KNOWN_EVENT_TYPES } from '../src/routes/admin/AdminAudit';

describe('isAdminUser', () => {
  it('passes only the admin role', () => {
    expect(isAdminUser({ role: 'admin' })).toBe(true);
    expect(isAdminUser({ role: 'buyer' })).toBe(false);
    expect(isAdminUser({ role: 'provider' })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});

describe('REPORT_REASONS', () => {
  it('mirrors the spec (FR-10) reason set', () => {
    expect([...REPORT_REASONS].sort()).toEqual(
      [
        'misleading_listing',
        'unauthorized_listing',
        'prohibited_content',
        'payment_issue',
        'other',
      ].sort(),
    );
  });

  it('labels every reason for the dialog', () => {
    expect(REPORT_REASON_LABELS).toEqual({
      misleading_listing: 'Misleading listing',
      unauthorized_listing: 'Unauthorized listing',
      prohibited_content: 'Prohibited content',
      payment_issue: 'Payment issue',
      other: 'Other',
    });
  });
});

describe('KNOWN_EVENT_TYPES', () => {
  it('covers every audit event type', () => {
    for (const type of [
      'user.created',
      'slot.published',
      'slot.cancelled',
      'claim.created',
      'payment.submitted',
      'payment.verified',
      'payment.review',
      'report.created',
      'report.resolved',
      'slot.disabled_by_admin',
      'user.disabled',
      'payment_review.resolved',
    ]) {
      expect(KNOWN_EVENT_TYPES).toContain(type);
    }
  });
});
