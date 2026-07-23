import type { PrismaClient } from "@prisma/client";

/**
 * Behavioral requirement #9 / decision #17: hard-deletes any `customers` row
 * with `isTemporary=true`, `mergedIntoCustomerId IS NULL`, and zero games in
 * ('pending','loan','collateral') referencing them as loser. Nishani rows
 * are never given an audit trail of their own (they were never a real
 * identity) — this is a genuine, intentional hard delete, not a soft
 * reverse.
 *
 * Note on FK safety: a purged nishani may still be referenced by *fully
 * paid* historical games/payments/collateral (that's exactly the common
 * case this job targets — "once every game linked to a nishani is fully
 * paid... the record is purged"). schema.prisma makes
 * Game.loserCustomerId/winnerCustomerId, Payment.customerId and
 * CollateralItem.customerId nullable with `onDelete: SetNull` for exactly
 * this reason, so Postgres nulls those references out instead of rejecting
 * the delete — the games/payments/collateral rows themselves (and the
 * revenue they represent) are preserved; only the now-meaningless nishani
 * identity is gone.
 */
export async function purgeNishani(prisma: PrismaClient): Promise<{ purgedCount: number; purgedIds: number[] }> {
  const candidates = await prisma.customer.findMany({
    where: {
      isTemporary: true,
      mergedIntoCustomerId: null,
    },
    select: { id: true },
  });

  if (candidates.length === 0) return { purgedCount: 0, purgedIds: [] };

  const candidateIds = candidates.map((c) => c.id);

  const blockedIds = new Set(
    (
      await prisma.game.findMany({
        where: {
          loserCustomerId: { in: candidateIds },
          paymentStatus: { in: ["pending", "loan", "collateral"] },
        },
        select: { loserCustomerId: true },
        distinct: ["loserCustomerId"],
      })
    )
      .map((g) => g.loserCustomerId)
      .filter((id): id is number => id !== null)
  );

  // Extra safety net: never purge a customer that is itself the *target* of
  // another merge (mergedIntoCustomerId pointing at it) — that FK has no
  // onDelete override, so deleting would violate referential integrity.
  // This should never legitimately happen (merges always fold a duplicate
  // into the real, non-temporary identity), but guard against it anyway.
  const mergeTargets = new Set(
    (
      await prisma.customer.findMany({
        where: { mergedIntoCustomerId: { in: candidateIds } },
        select: { mergedIntoCustomerId: true },
        distinct: ["mergedIntoCustomerId"],
      })
    )
      .map((c) => c.mergedIntoCustomerId)
      .filter((id): id is number => id !== null)
  );

  const purgeableIds = candidateIds.filter((id) => !blockedIds.has(id) && !mergeTargets.has(id));
  if (purgeableIds.length === 0) return { purgedCount: 0, purgedIds: [] };

  await prisma.customer.deleteMany({ where: { id: { in: purgeableIds } } });

  return { purgedCount: purgeableIds.length, purgedIds: purgeableIds };
}
