// Phase 10: admin + report API client. No wallet SDK usage here — all reads
// and writes ride the session cookie. Admin-only endpoints 403 for non-admin
// (never 404) and 401 for anonymous; the RequireAdmin guard keeps guests out
// of these pages, the server still enforces it.
import { apiFetch } from './api';

export interface AdminUser {
  id: string;
  walletAddress: string;
  role: string;
  status: string;
}

/** Pure role check shared by the guard and the nav (unit-tested). */
export function isAdminUser(user: { role: string } | null | undefined): boolean {
  return user?.role === 'admin';
}

// PROJECT_SPEC.md FR-10 categories (snake_case stored value and API field).
export const REPORT_REASONS = [
  'misleading_listing',
  'unauthorized_listing',
  'prohibited_content',
  'payment_issue',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Human labels for the report dialog (values stay snake_case on the wire). */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  misleading_listing: 'Misleading listing',
  unauthorized_listing: 'Unauthorized listing',
  prohibited_content: 'Prohibited content',
  payment_issue: 'Payment issue',
  other: 'Other',
};

export function createReport(body: {
  slotId?: string;
  targetUserId?: string;
  reason: ReportReason;
  details?: string;
}): Promise<{ report: ReportSummary }> {
  return apiFetch<{ report: ReportSummary }>('/api/v1/reports', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ReportSummary {
  id: string;
  slot_id: string | null;
  target_user_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
}

export interface AdminReport {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  resolution_notes: string | null;
  resolved_by_user_id: string | null;
  reporter: { id: string; walletDisplay: string };
  slot: { id: string; title: string; status: string } | null;
  targetUser: { id: string; walletDisplay: string } | null;
}

export function fetchAdminReports(params: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ reports: AdminReport[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  const suffix = query.toString();
  return apiFetch(`/api/v1/admin/reports${suffix ? `?${suffix}` : ''}`);
}

export function resolveReport(
  reportId: string,
  body: { action: 'reviewed' | 'dismissed'; resolutionNotes: string },
): Promise<{ report: AdminReport }> {
  return apiFetch(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface DisabledSlot {
  id: string;
  status: string;
  available_quantity: number;
  cancelled_at: string | null;
}

export function disableSlot(
  slotId: string,
  reason: string,
): Promise<{
  slot: DisabledSlot;
  migratedClaims: string[];
  cancelledClaims: string[];
  warning: string | null;
}> {
  return apiFetch(`/api/v1/admin/slots/${encodeURIComponent(slotId)}/disable`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function disableUser(
  userId: string,
  reason: string,
): Promise<{ user: { id: string; status: string; disabled_at: string | null } }> {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/disable`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export interface PaymentReview {
  claim: {
    id: string;
    status: string;
    buyerWallet: string;
    claimed_at: string;
    updated_at: string;
  };
  slot: { id: string; title: string; price_usdt: string; payout_wallet: string };
  intent: {
    id: string;
    expected_amount_nim: string;
    expected_recipient: string;
    expected_sender: string;
    expected_data: string;
    tx_hash: string | null;
    submitted_at: string | null;
  } | null;
}

export function fetchPaymentReviews(
  params: { limit?: number; offset?: number } = {},
): Promise<{ reviews: PaymentReview[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  const suffix = query.toString();
  return apiFetch(`/api/v1/admin/payment-reviews${suffix ? `?${suffix}` : ''}`);
}

export function resolvePaymentReview(
  claimId: string,
  body: { action: 'confirm_paid' | 'reject'; resolutionNotes: string },
): Promise<{ claim: { id: string; status: string }; intent: { id: string; status: string } }> {
  return apiFetch(`/api/v1/admin/payment-reviews/${encodeURIComponent(claimId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface AuditEvent {
  id: string;
  actor: { id: string; walletDisplay: string } | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  request_id: string | null;
}

export function fetchAuditEvents(
  params: {
    eventType?: string;
    entityType?: string;
    entityId?: string;
    actorUserId?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ events: AuditEvent[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.eventType) query.set('eventType', params.eventType);
  if (params.entityType) query.set('entityType', params.entityType);
  if (params.entityId) query.set('entityId', params.entityId);
  if (params.actorUserId) query.set('actorUserId', params.actorUserId);
  if (params.since) query.set('since', params.since);
  if (params.until) query.set('until', params.until);
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  const suffix = query.toString();
  return apiFetch(`/api/v1/admin/audit-events${suffix ? `?${suffix}` : ''}`);
}
