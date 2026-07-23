import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import { writeAuditLog } from "../lib/audit";

export const tablesRouter = Router();
tablesRouter.use(requireAuth);

/**
 * GET /tables — includes current status (occupied/vacant) + active game
 * summary if occupied. Design choice (behavioral requirement #6): current
 * occupancy is derived, not stored — a table is occupied iff it has a Game
 * row with endTime IS NULL, rather than trusting a separately-maintained
 * status column that could drift out of sync.
 */
tablesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const tables = await prisma.table.findMany({ orderBy: { tableNumber: "asc" } });

    const activeGames = await prisma.game.findMany({
      where: { endTime: null, reversed: false, tableId: { in: tables.map((t) => t.id) } },
      include: { gameType: true, loserCustomer: true, winnerCustomer: true },
    });
    const activeByTable = new Map(activeGames.map((g) => [g.tableId, g]));

    res.json(
      tables.map((t) => {
        const activeGame = activeByTable.get(t.id);
        return {
          id: t.id,
          tableNumber: t.tableNumber,
          tableType: t.tableType,
          label: t.label,
          isActive: t.isActive,
          status: activeGame ? "occupied" : "vacant",
          activeGame: activeGame
            ? {
                id: activeGame.id,
                gameTypeId: activeGame.gameTypeId,
                gameTypeName: activeGame.gameType.name,
                startTime: activeGame.startTime,
                loserCustomerId: activeGame.loserCustomerId,
                loserCustomerName: activeGame.loserCustomer?.displayName ?? null,
                winnerCustomerId: activeGame.winnerCustomerId,
                winnerCustomerName: activeGame.winnerCustomer?.displayName ?? null,
              }
            : null,
        };
      })
    );
  })
);

const patchTableSchema = z.object({
  isActive: z.boolean(),
});

tablesRouter.patch(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = patchTableSchema.parse(req.body);

    const existing = await prisma.table.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound(`Table ${id} not found`);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.table.update({ where: { id }, data: { isActive: body.isActive } });
      await writeAuditLog(tx, {
        entityType: "table",
        entityId: id,
        action: "update",
        performedById: req.user!.userId,
        beforeValue: existing,
        afterValue: result,
      });
      return result;
    });

    res.json(updated);
  })
);
