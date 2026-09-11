// Phase 4: public read-only marketplace endpoints. No auth required.
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { AppError, successBody } from '../http/errors';
import { getPublicSlotById, listPublicSlots } from '../slots/service';

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

const slotIdParamsSchema = z.object({ slotId: z.string().uuid() }).strict();

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
    if (!slot) {
      // Non-published slots 404 exactly like missing ones: no existence leak.
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    return successBody(request, { slot });
  });
}
