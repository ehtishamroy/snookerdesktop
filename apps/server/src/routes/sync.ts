import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { writeAuditLog } from "../lib/audit";
import { createGame, reverseGame, updateGame, type CreateGameInput, type UpdateGameInput } from "../services/gameService";

export const syncRouter = Router();
syncRouter.use(requireAuth);

/**
 * Behavioral requirement #7: sync is idempotent on `localUuid`. The schema
 * only carries a `localUuid` unique constraint on the `games` table (see
 * prisma/schema.prisma), which is also the only entity type the API
 * contract calls out by name for this ("idempotency via localUuid on the
 * games table") — so /sync/push scopes to `entityType: "game"` operations.
 * Payments/expenses/collateral are created directly via their own REST
 * endpoints by the desktop app once it's back online, rather than replayed
 * through this generic operation log.
 */
const operationSchema = z.object({
  localUuid: z.string().min(1),
  entityType: z.literal("game"),
  operation: z.enum(["create", "update", "reverse"]),
  payload: z.record(z.unknown()),
  /**
   * Optional client-side "as of" timestamp for update/reverse operations,
   * used for last-write-wins conflict resolution against the server's
   * updatedAt. If omitted, the client write is always applied (best effort).
   */
  clientUpdatedAt: z.string().optional(),
});

const pushSchema = z.object({
  operations: z.array(operationSchema),
});

type PushStatus = "applied" | "duplicate" | "error";
interface PushResult {
  localUuid: string;
  status: PushStatus;
  serverId?: number;
  error?: string;
}

syncRouter.post(
  "/push",
  asyncHandler(async (req, res) => {
    const body = pushSchema.parse(req.body);
    const actor = req.user!;
    const results: PushResult[] = [];

    for (const op of body.operations) {
      try {
        if (op.operation === "create") {
          const existing = await prisma.game.findUnique({ where: { localUuid: op.localUuid } });
          const created = await createGame(
            prisma,
            { ...(op.payload as unknown as CreateGameInput), localUuid: op.localUuid },
            actor.userId
          );
          results.push({ localUuid: op.localUuid, status: existing ? "duplicate" : "applied", serverId: created.id });
          continue;
        }

        const existing = await prisma.game.findUnique({ where: { localUuid: op.localUuid } });
        if (!existing) {
          results.push({ localUuid: op.localUuid, status: "error", error: "No matching game to update/reverse for this localUuid" });
          continue;
        }

        // Conflict resolution: last-write-wins on updated_at. If the
        // client's operation is older than what the server already has,
        // the server's version wins — the client's would-be write is
        // logged to audit_log as a superseded snapshot instead of applied.
        if (op.clientUpdatedAt && new Date(op.clientUpdatedAt) < existing.updatedAt) {
          await writeAuditLog(prisma, {
            entityType: "game",
            entityId: existing.id,
            action: "update",
            performedById: actor.userId,
            beforeValue: { supersededClientWrite: op.payload, clientUpdatedAt: op.clientUpdatedAt },
            afterValue: existing,
          });
          results.push({ localUuid: op.localUuid, status: "duplicate", serverId: existing.id });
          continue;
        }

        if (op.operation === "update") {
          const updated = await updateGame(prisma, existing.id, op.payload as unknown as UpdateGameInput, actor);
          results.push({ localUuid: op.localUuid, status: "applied", serverId: updated.id });
        } else {
          const reason = typeof (op.payload as { reason?: unknown }).reason === "string"
            ? ((op.payload as { reason: string }).reason)
            : "Reversed via sync";
          const reversed = await reverseGame(prisma, existing.id, reason, actor);
          results.push({ localUuid: op.localUuid, status: "applied", serverId: reversed.id });
        }
      } catch (err) {
        results.push({
          localUuid: op.localUuid,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    res.json({ results });
  })
);

/**
 * GET /sync/pull?since=<ISO timestamp> — hydrates a desktop app that was
 * offline. Design notes:
 *  - `tables` and `game_types` have no updatedAt column (they're small,
 *    rarely-changing reference tables) so we always return the full set
 *    rather than trying to diff them — cheap and simpler than adding
 *    tracked-at-a-distance columns for two tables of a handful of rows each.
 *  - `pricing_rules` has no single updatedAt either, but versioning means
 *    "changed since X" is exactly: a new rule created after X
 *    (effectiveFrom > since) OR a previously-open rule that got closed
 *    after X (effectiveTo > since).
 *  - `customers` excludes is_temporary=true (decision #17 — nishani never
 *    sync to other devices as reusable identities) and uses its real
 *    updatedAt column.
 *  - Games/shifts are scoped to the caller's own activity per the contract
 *    ("any of the caller's own shift/game data").
 */
syncRouter.get(
  "/pull",
  asyncHandler(async (req, res) => {
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(0);
    const actor = req.user!;

    const [tables, gameTypes, pricingRules, customers, games, shifts] = await Promise.all([
      prisma.table.findMany({ orderBy: { tableNumber: "asc" } }),
      prisma.gameType.findMany({ orderBy: { id: "asc" } }),
      prisma.pricingRule.findMany({
        where: { OR: [{ effectiveFrom: { gt: since } }, { effectiveTo: { gt: since } }] },
      }),
      prisma.customer.findMany({
        where: { isTemporary: false, updatedAt: { gt: since } },
      }),
      prisma.game.findMany({
        where: { updatedAt: { gt: since }, createdByUserId: actor.userId },
      }),
      prisma.shift.findMany({
        where: {
          userId: actor.userId,
          OR: [{ openedAt: { gt: since } }, { closedAt: { gt: since } }],
        },
      }),
    ]);

    res.json({
      pulledAt: new Date().toISOString(),
      tables,
      gameTypes,
      pricingRules,
      customers,
      games,
      shifts,
    });
  })
);
