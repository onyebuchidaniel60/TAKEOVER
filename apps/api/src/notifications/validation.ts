// Notification route validation. UUID path params only;
// bodies are ignored (read markers carry no payload).
import { z } from 'zod';

export const notificationIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
