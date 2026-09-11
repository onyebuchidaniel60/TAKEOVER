// Phase 4: public read-only marketplace endpoints. Phase 5: authenticated
// provider lifecycle (create / edit draft / publish / cancel / my slots).
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  cancelSlot,
  createSlot,
  getOwnSlot,
  listOwnSlots,
  publishSlot,
  updateDraftSlot,
} from '../slots/lifecycle';
import { toOwnerSlot } from '../slots/owner-slot';
import { getPublicSlotById, listPublicSlots } from '../slots/service';
import {
  meSlotsQuerySchema,
  slotCreateSchema,
  slotIdParamsSchema,
  slotPatchSchema,
} from '../slots/validation';

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

export async function slotRoutes(app: FastifyInstance): Promise<void> {
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
    const slot = await getPublicSlotById(db, parsed.data.slotId);
    if (slot) {
      return successBody(request, { slot });
    }
    // Non-public slot: the owner (and only the owner) sees the owner
    // projection. Everyone else gets the same 404 — no existence leak.
    if (request.user) {
      const owned = await getOwnSlot(db, request.user.id, parsed.data.slotId);
      return successBody(request, { slot: toOwnerSlot(owned) });
    }
    throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
  });

  app.post('/slots', async (request, reply) => {
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

  app.patch('/slots/:slotId', async (request) => {
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

  app.post('/slots/:slotId/publish', async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const db = getDb();
    const slot = await publishSlot(db, user.id, params.data.slotId);
    return successBody(request, { slot });
  });

  app.post('/slots/:slotId/cancel', async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const db = getDb();
    const slot = await cancelSlot(db, user.id, params.data.slotId);
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
}
