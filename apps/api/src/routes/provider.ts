// Phase 9: provider self-service profile (display name only).
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import { upsertProviderProfile } from '../provider-profiles/service';
import { providerProfileBodySchema } from '../provider-profiles/validation';

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/me/provider-profile', async (request) => {
    const user = await requireAuth(request);
    const parsed = providerProfileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid display name.');
    }
    const db = getDb();
    const providerProfile = await upsertProviderProfile(db, {
      userId: user.id,
      displayName: parsed.data.display_name,
    });
    return successBody(request, { providerProfile });
  });
}
