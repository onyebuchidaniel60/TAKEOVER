// Public read-only marketplace endpoints. Authenticated
// provider lifecycle (create / edit draft / publish / cancel / my slots).
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  createUserRateLimiter,
  DEFAULT_PROVIDER_CLAIMS_READ_RATE_LIMIT,
  DEFAULT_SLOT_CREATE_RATE_LIMIT,
  DEFAULT_SLOT_MUTATE_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import { expireHoldsForSlot, listSlotClaimsForProvider } from '../claims/service';
import {
  cancelSlot,
  createSlot,
  getOwnSlot,
  isSlotOwner,
  listOwnSlots,
  publishSlot,
  updateDraftSlot,
  updateSlotContactNote,
} from '../slots/lifecycle';
import { toOwnerSlot } from '../slots/owner-slot';
import { loadProviderDisplay } from '../slots/provider-display';
import { getPublicSlotById, listPublicSlots } from '../slots/service';
import {
  contactNoteBodySchema,
  meSlotsQuerySchema,
  publishBodySchema,
  slotCreateSchema,
  slotIdParamsSchema,
  slotPatchSchema,
} from '../slots/validation';
import {
  createRpcClient,
  getNimiqRpcUrl,
  type NimiqRpcClient,
} from '../payments/rpc';

// Empty query values ("?q=") behave as absent so clearing a filter is a no-op.
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const slotsQuerySchema = z
  .object({
    // limit > 50 is REJECTED with 400 (not silently clamped).
    limit: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(50).default(20)),
    offset: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).default(0)),
    q: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
    category: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
    location: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
    from: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
    to: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  })
  .strict();

export interface SlotRouteOptions {
  rateLimit?: {
    /** Per-user slot-creation budget (default 30/hour). Bounds spam listings. */
    slotCreate?: RateLimitOptions;
    /** Per-IP owner-mutation budget shared by patch/publish/cancel (default 60/min). */
    slotMutate?: RateLimitOptions;
    /** Per-IP provider demand-view budget (default 120/min). Bounds claim-state enumeration. */
    providerClaims?: RateLimitOptions;
  };
  /** Injected chain reader for fee-gated publish (tests). Production defaults to the Nimiq RPC client. */
  rpcClient?: NimiqRpcClient;
}

export async function slotRoutes(app: FastifyInstance, opts: SlotRouteOptions = {}): Promise<void> {
  const slotCreateLimiter = createUserRateLimiter(
    opts.rateLimit?.slotCreate ?? DEFAULT_SLOT_CREATE_RATE_LIMIT,
  );
  const slotMutateLimiter = createRateLimiter(
    opts.rateLimit?.slotMutate ?? DEFAULT_SLOT_MUTATE_RATE_LIMIT,
  );
  const providerClaimsLimiter = createRateLimiter(
    opts.rateLimit?.providerClaims ?? DEFAULT_PROVIDER_CLAIMS_READ_RATE_LIMIT,
  );
  app.get('/slots', async (request) => {
    const parsed = slotsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const { limit, offset, q, category, location, from, to } = parsed.data;
    const db = getDb();
    const { slots: items, total } = await listPublicSlots(db, {
      filters: {
        q,
        category,
        location,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      limit,
      offset,
    });
    return successBody(request, { slots: items, total, limit, offset });
  });

  app.get('/slots/:slotId', async (request) => {
    const parsed = slotIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const db = getDb();
    // Lazy hold expiry runs before returning so freed units show immediately.
    await expireHoldsForSlot(db, parsed.data.slotId, new Date());
    const slot = await getPublicSlotById(db, parsed.data.slotId);
    if (slot) {
      return successBody(request, { slot });
    }
    // Non-public slot: the owner (and only the owner) sees the owner
    // projection. Everyone else gets the same 404 — no existence leak.
    if (request.user) {
      const owned = await getOwnSlot(db, request.user.id, parsed.data.slotId);
      return successBody(request, {
        slot: toOwnerSlot(owned, await loadProviderDisplay(db, owned.providerId)),
      });
    }
    throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
  });

  app.get('/slots/:slotId/ownership', async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const db = getDb();
    // UX gate for the claim button only — the claim transaction enforces
    // the rule itself. Boolean only; the provider id is never exposed.
    const owned = await isSlotOwner(db, user.id, params.data.slotId);
    if (owned === null) {
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    return successBody(request, { isOwner: owned });
  });

  app.post('/slots', { preHandler: slotCreateLimiter }, async (request, reply) => {
    const user = await requireAuth(request);
    const parsed = slotCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot details.');
    }
    const db = getDb();
    const slot = await createSlot(db, user.id, parsed.data);
    void reply.code(201);
    return successBody(request, { slot });
  });

  app.patch('/slots/:slotId', { preHandler: slotMutateLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const parsed = slotPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot details.');
    }
    const db = getDb();
    const slot = await updateDraftSlot(db, user.id, params.data.slotId, parsed.data);
    return successBody(request, { slot });
  });

  app.post('/slots/:slotId/publish', { preHandler: slotMutateLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    // Optional fee body. {} stays valid (no-fee path); unknown
    // fields → 400. Hash well-formedness is the lifecycle's PAYMENT_INVALID_TX.
    const body = publishBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
    }
    const db = getDb();
    const slot = await publishSlot(db, user.id, params.data.slotId, { requestId: request.id }, {
      transactionHash: body.data.transactionHash,
      rpc: opts.rpcClient ?? createRpcClient(getNimiqRpcUrl()),
    });
    return successBody(request, { slot });
  });

  app.post('/slots/:slotId/cancel', { preHandler: slotMutateLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const db = getDb();
    const slot = await cancelSlot(db, user.id, params.data.slotId, { requestId: request.id });
    return successBody(request, { slot });
  });

  app.get('/me/slots', async (request) => {
    const user = await requireAuth(request);
    const parsed = meSlotsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const db = getDb();
    const { slots: items, total } = await listOwnSlots(db, user.id, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return successBody(request, {
      slots: items,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });

  // One-way provider contact note. Write gate is open (any
  // owned status); the buyer read gate lives on the claim/escrow views.
  // Owner-only (non-owner or missing slot → 404, never 403), same shape as
  // the existing PATCH response ({ slot } owner projection).
  app.patch('/me/slots/:slotId/contact-note', { preHandler: slotMutateLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const parsed = contactNoteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'Provider contact note must be 1–500 characters with no links or URLs. Use null to clear it.',
      );
    }
    const db = getDb();
    const slot = await updateSlotContactNote(db, user.id, params.data.slotId, parsed.data.provider_contact_note, {
      requestId: request.id,
    });
    return successBody(request, { slot });
  });

  app.get('/me/slots/:slotId/claims', { preHandler: providerClaimsLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const db = getDb();
    const result = await listSlotClaimsForProvider(db, {
      slotId: params.data.slotId,
      providerId: user.id,
    });
    return successBody(request, result);
  });
}
