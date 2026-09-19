// Buyer-facing payment-intent projection. Field names are the locked
// camelCase contract. expected_sender is DELIBERATELY absent — it is
// server-side reconciliation data, never shown to the buyer.
import type { paymentIntents } from '../../../../db/schema';
import { serializePriceUsdt } from '../slots/price';

type IntentRow = typeof paymentIntents.$inferSelect;

export interface PaymentIntentView {
  id: string;
  claimId: string;
  expectedAmountNim: string;
  expectedRecipient: string;
  expectedData: string;
  status: string;
  txHash: string | null;
  submittedAt: string | null;
  createdAt: string;
}

/** Project an intent row onto the locked buyer shape. Throws on invalid amount. */
export function toPaymentIntentView(row: IntentRow): PaymentIntentView {
  return {
    id: row.id,
    claimId: row.claimId,
    expectedAmountNim: serializePriceUsdt(row.expectedAmountNim),
    expectedRecipient: row.expectedRecipient,
    expectedData: row.expectedData,
    status: row.status,
    txHash: row.txHash,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
