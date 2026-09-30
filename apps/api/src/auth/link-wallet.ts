// Wallet linking (Phase 5n-A, D21/D22).
//
// Adds a wallet to an account that signed up with email. This is NOT a new
// auth surface: the challenge, the signature check, the canonicalization
// and the single-use consumption are all the SAME code the wallet-login
// path uses (see routes/auth.ts /auth/verify). The only difference is what
// happens after a valid signature — login loads-or-creates the wallet's own
// user, while link attaches the wallet to the CALLER's user.
//
// D21 (1:1) is enforced twice over:
//   - users.wallet_address is UNIQUE, so a wallet can never end up on two
//     rows no matter what the handler does.
//   - the handler returns a specific 409 instead of letting the unique
//     constraint throw, so the user gets "already linked to another
//     account" rather than a 500.
// Neither layer is the only thing standing between.
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { authChallenges, users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { AppError } from '../http/errors';
import { formatChallenge } from './challenge';
import { canonicalizeNimiqAddress, InvalidAddressError } from './nimiq-address';
import type { VerifySignatureFn } from './nimiq-verify';

type Db = ReturnType<typeof getDb>;

export interface LinkWalletInput {
  userId: string;
  walletAddress: string;
  nonce: string;
  signature: string;
  publicKey?: string;
  requestId: string;
}

/** Canonical form, or a 400. Mirrors the login path exactly. */
function canonicalizeOr400(value: string): string {
  try {
    return canonicalizeNimiqAddress(value);
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid wallet address.');
    }
    throw err;
  }
}

/**
 * Verify a challenge the way /auth/verify does (wallet-bound, unconsumed,
 * unexpired) and consume it. Returns nothing: a valid signature is the
 * proof of ownership, and the caller decides what it authorizes.
 *
 * Failed SIGNATURES do not burn the challenge — same as login, where the
 * rate limiter bounds retries.
 */
export async function consumeChallengeForSignature(
  db: Db,
  args: { walletAddress: string; nonce: string; signature: string; publicKey?: string },
  verifySignature: VerifySignatureFn,
): Promise<void> {
  const rows = await db
    .select()
    .from(authChallenges)
    .where(
      and(
        eq(authChallenges.nonce, args.nonce),
        eq(authChallenges.walletAddress, args.walletAddress),
        isNull(authChallenges.consumedAt),
      ),
    )
    .limit(1);
  const challenge = rows[0];
  if (!challenge) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired challenge.');
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, 'AUTH_EXPIRED', 'Challenge has expired.');
  }

  const ok = await verifySignature({
    address: args.walletAddress,
    message: formatChallenge(challenge.nonce, challenge.createdAt),
    signature: args.signature,
    publicKey: args.publicKey,
  });
  if (!ok) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Signature verification failed.');
  }

  // Single-use, race-safe: only one caller can flip consumedAt from NULL.
  const consumed = await db
    .update(authChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(authChallenges.id, challenge.id), isNull(authChallenges.consumedAt)))
    .returning({ id: authChallenges.id });
  if (consumed.length === 0) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired challenge.');
  }
}

/**
 * Attach a verified wallet to the caller's account. Returns the updated
 * user id so the route can serve the normal /me projection.
 *
 * Idempotent for the SAME wallet: re-linking the wallet you already have is
 * a 200 no-op, so a retry after a dropped response cannot read as a
 * failure. Linking a DIFFERENT wallet is refused (D21) — replacing a wallet
 * is a separate, deliberate operation, not a side effect of "connect".
 */
export async function linkWallet(
  db: Db,
  input: LinkWalletInput,
  verifySignature: VerifySignatureFn,
): Promise<{ userId: string }> {
  const walletAddress = canonicalizeOr400(input.walletAddress);

  await consumeChallengeForSignature(
    db,
    {
      walletAddress,
      nonce: input.nonce,
      signature: input.signature,
      publicKey: input.publicKey,
    },
    verifySignature,
  );

  return db.transaction(async (tx) => {
    // Lock the caller first: two concurrent links from one account must not
    // both pass the "has no wallet" check.
    const me = (await tx.select().from(users).where(eq(users.id, input.userId)).for('update'))[0];
    if (!me) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    if (me.status !== 'active' || me.disabledAt !== null) {
      throw new AppError(403, 'USER_DISABLED', 'This account is disabled.');
    }

    if (me.walletAddress === walletAddress) {
      // Already this wallet: idempotent success, no write, no audit.
      return { userId: me.id };
    }
    if (me.walletAddress !== null) {
      throw new AppError(
        409,
        'WALLET_ALREADY_LINKED',
        'Your account already has a wallet. Remove it before linking a new one.',
      );
    }

    // Is this wallet someone else's? The UNIQUE constraint would also catch
    // this, but a raw 500 is not an answer a user can act on.
    const owner = (
      await tx.select({ id: users.id }).from(users).where(eq(users.walletAddress, walletAddress)).limit(1)
    )[0];
    if (owner) {
      throw new AppError(409, 'WALLET_TAKEN', 'This wallet is already linked to another account.');
    }

    const updated = await tx
      .update(users)
      .set({ walletAddress, updatedAt: new Date() })
      .where(eq(users.id, me.id))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    // Audit carries the user id only — never the wallet address (audit
    // privacy rule: metadata holds IDs, not identity values).
    await writeAuditEvent(tx, {
      actorUserId: me.id,
      eventType: 'user.wallet_linked',
      entityType: 'user',
      entityId: me.id,
      requestId: input.requestId,
    });
    return { userId: me.id };
  });
}
