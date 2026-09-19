// Public fee-terms endpoint. Serves the NIM listing-fee state
// (amount + receive-only wallet) so the publish page can render the fee copy
// and drive the pay-then-publish flow. PUBLIC (no auth): the terms are not
// secrets, and the publish page needs them pre-auth. Reads env tolerantly
// (never throws, never leaks); no caching header — the read is a synchronous
// env lookup (sub-millisecond, nothing to gain), and a cached
// "required: false" or stale wallet after a fee change could let a seller
// publish free or pay a rotated address. no-store keeps money-gating reads
// always fresh.
import type { FastifyInstance } from 'fastify';
import { getListingFeeState } from '../env';
import { successBody } from '../http/errors';

export interface ListingFeeConfigView {
  required: boolean;
  amountNim: string | null;
  walletAddress: string | null;
  /** F4: amount set but wallet missing/malformed. Present only when true. */
  misconfigured?: true;
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', async (request, reply) => {
    const state = getListingFeeState();
    const listingFee: ListingFeeConfigView = state.misconfigured
      ? {
          required: true,
          amountNim: state.amountNim,
          walletAddress: null,
          misconfigured: true,
        }
      : {
          required: state.required,
          amountNim: state.amountNim,
          walletAddress: state.walletAddress,
        };
    void request.log.info(
      { feeRequired: listingFee.required, misconfigured: state.misconfigured },
      'config served',
    );
    void reply.header('Cache-Control', 'no-store');
    return successBody(request, { listingFee });
  });
}
