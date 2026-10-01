// Self-service avatar update. The avatar is a base64 data URI stored on
// the user row (see db/schema/users.ts); null clears it. Same-value
// re-sets are a no-op (no write, no audit). The audit carries IDs only,
// never the image data. Input arrives API-validated (data-URI shape,
// 200KB cap); the service trusts the boundary per the lifecycle-layer
// convention.
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { validateUsername } from '../auth/username';
import { AppError } from '../http/errors';

type Db = ReturnType<typeof getDb>;

export async function setUserAvatar(
  db: Db,
  userId: string,
  avatarData: string | null,
  audit?: { requestId?: string | null },
): Promise<string | null> {
  const row = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    if (current.avatarData === avatarData) {
      return current;
    }
    const updated = await tx
      .update(users)
      .set({ avatarData, updatedAt: new Date() })
      .where(and(eq(users.id, userId)))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    await writeAuditEvent(tx, {
      actorUserId: userId,
      eventType: 'user.avatar_updated',
      entityType: 'user',
      entityId: next.id,
      requestId: audit?.requestId ?? null,
      metadata: { hadAvatar: current.avatarData !== null },
    });
    return next;
  });
  return row.avatarData;
}

export interface UserProfilePatch {
  /**
   * Phase 5n-B: email is editable post-signup. Already normalized to
   * lowercase by the boundary; uniqueness is checked here and answers
   * EMAIL_TAKEN, the same rule registration applies. null clears it.
   */
  email?: string | null;
  bio?: string | null;
  phone?: string | null;
  /** YYYY-MM-DD (drizzle DATE mode is string). */
  dob?: string | null;
  location?: string | null;
}

export interface UserProfileView {
  email: string | null;
  bio: string | null;
  phone: string | null;
  dob: string | null;
  location: string | null;
}

/**
 * Self-service profile scalars (Phase 5j). Only keys present in the patch
 * are written (absent = unchanged); explicit null clears. Same-value
 * re-sets are a no-op (no write, no audit). The audit carries changed
 * FIELD NAMES only — values are PII and never enter metadata.
 */
export async function updateUserProfile(
  db: Db,
  userId: string,
  patch: UserProfilePatch,
  audit?: { requestId?: string | null },
): Promise<UserProfileView> {
  const row = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    // Email is the only IDENTITY field in this patch, so it carries the
    // uniqueness rule. Checked explicitly (and inside the same locked
    // transaction) so a conflict is a 409 the user can act on rather than a
    // raw unique-violation 500 from the UPDATE.
    if (patch.email !== undefined && patch.email !== null && patch.email !== current.email) {
      const taken = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, patch.email), ne(users.id, userId)))
        .limit(1);
      if (taken.length > 0) {
        throw new AppError(409, 'EMAIL_TAKEN', 'That email is already in use.');
      }
    }
    const values: Partial<Pick<UserProfilePatch, 'email' | 'bio' | 'phone' | 'dob' | 'location'>> = {};
    const fields: string[] = [];
    for (const key of ['email', 'bio', 'phone', 'dob', 'location'] as const) {
      if (patch[key] !== undefined && patch[key] !== current[key]) {
        values[key] = patch[key] ?? null;
        fields.push(key);
      }
    }
    if (fields.length === 0) {
      return current;
    }
    const updated = await tx
      .update(users)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    await writeAuditEvent(tx, {
      actorUserId: userId,
      eventType: 'user.profile_updated',
      entityType: 'user',
      entityId: next.id,
      requestId: audit?.requestId ?? null,
      metadata: { fields },
    });
    return next;
  });
  return {
    email: row.email,
    bio: row.bio,
    phone: row.phone,
    dob: row.dob,
    location: row.location,
  };
}

/**
 * Phase 5o-A (D26) — set a public handle ONCE, for an account that never had
 * one. Wallet signup (the primary CTA) never collected a username and the
 * column has always been nullable, so the 112 handle-less accounts are a
 * structural dead end, not a display bug: without a handle the provider row
 * on slot detail has nothing to link to.
 *
 * Immutability (D26): a user who ALREADY has a username can never change it.
 * `/u/:username` is a shareable public URL and followers key off it, so a
 * mutable handle would silently repoint a shared link — the same reasoning
 * that made the column immutable at registration in Phase 5g. Re-submitting
 * the SAME handle is an idempotent 200 no-op (a dropped response must not
 * read as a failure); any DIFFERENT handle is 409 USERNAME_IMMUTABLE.
 *
 * Same rules as registration, deliberately reusing validateUsername so the
 * format/reserved list has exactly one definition. Uniqueness is checked
 * INSIDE the locked transaction and answered 409 USERNAME_TAKEN, because the
 * UNIQUE column would otherwise surface as a 500 nobody can act on.
 *
 * The audit event carries the user id only — never the handle. A username is
 * a public value, but audit rows are read by admins and a handle is PII-adjacent
 * identity data; the audit privacy rule is IDs and reason strings.
 */
export async function setUsernameOnce(
  db: Db,
  userId: string,
  rawUsername: string,
  audit?: { requestId?: string | null },
): Promise<{ username: string; alreadySet: boolean }> {
  // Boundary-parsed body, but the RULE still lives in validateUsername — a
  // future second caller cannot skip it by reaching this function directly.
  const checked = validateUsername(rawUsername);
  if (!checked.ok) {
    throw new AppError(
      400,
      'INVALID_INPUT',
      checked.reason === 'reserved'
        ? 'This username is reserved.'
        : 'Usernames are 3-20 lowercase letters, numbers, or underscores, starting with a letter.',
    );
  }
  const candidate = checked.value;

  const row = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    if (current.status !== 'active' || current.disabledAt !== null) {
      throw new AppError(403, 'USER_DISABLED', 'This account is disabled.');
    }
    // D26: set-once. Same value is an idempotent no-op; any other value is
    // refused BEFORE the uniqueness probe, so an established handle can never
    // leak whether some other handle is free.
    if (current.username !== null) {
      if (current.username === candidate) {
        return { username: current.username, alreadySet: true };
      }
      throw new AppError(409, 'USERNAME_IMMUTABLE', 'Your username cannot be changed.');
    }

    const taken = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, candidate), ne(users.id, userId)))
      .limit(1);
    if (taken.length > 0) {
      throw new AppError(409, 'USERNAME_TAKEN', 'This username is already taken.');
    }

    const updated = await tx
      .update(users)
      .set({ username: candidate, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    const next = updated[0];
    if (!next || next.username === null) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    await writeAuditEvent(tx, {
      actorUserId: userId,
      eventType: 'user.username_set',
      entityType: 'user',
      entityId: next.id,
      requestId: audit?.requestId ?? null,
    });
    return { username: next.username, alreadySet: false };
  });
  return row;
}
