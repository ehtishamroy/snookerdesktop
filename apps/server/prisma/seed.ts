/**
 * Database seed script — run via `pnpm prisma:seed` (or automatically after
 * `prisma migrate dev` if you wire up prisma.seed in package.json).
 *
 * Seeds:
 *  - 6 tables: 1-5 standard, 6 = "Table 6 - Private Room" (private_room)
 *  - 5 game types: 6_ball, 6_ball_double, full_frame, full_frame_double, century
 *  - Initial pricing_rules (effectiveFrom = now, effectiveTo = null) per
 *    spec §2.1's price list:
 *      Standard:      6 Ball 100/25m, 6 Ball Double 200/25m,
 *                      Full Frame 150/25m, Full Frame Double 300/25m,
 *                      Century 600/60m
 *      Private Room:  6 Ball 250/25m*, Full Frame 250/25m,
 *                      Full Frame Double 500/25m*, Century 1000/60m
 *      (* spec didn't give a duration for these two private-room prices;
 *      25 minutes is used, matching the standard-table block length for
 *      the same game type — see task instructions for this build pass.)
 *      Note there is no private-room "6 Ball Double" price in the spec, so
 *      no pricing_rules row is seeded for that (tableType, gameTypeId)
 *      combination — starting that combo would correctly fail pricing
 *      resolution until the owner adds one via POST /pricing-rules.
 *  - One initial 'vacant' table_status_log row per table (statusFrom = now)
 *    so the utilization report has continuous history from t=0 rather than
 *    a gap before the first game is ever played on a table.
 *  - One owner user (username "owner"), with a randomly generated PIN that
 *    is bcrypt-hashed for storage and printed once, in plaintext, to the
 *    console — this is a dev/setup convenience only; treat that PIN as
 *    already "used" and rotate it via PATCH /users/:id in any environment
 *    the console output might have been visible to more than the operator.
 */
import { PrismaClient, type TableType } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 10;

interface GameTypeSeed {
  code: string;
  name: string;
  defaultDurationMinutes: number;
}

const GAME_TYPES: GameTypeSeed[] = [
  { code: "6_ball", name: "6 Ball Single", defaultDurationMinutes: 25 },
  { code: "6_ball_double", name: "6 Ball Double", defaultDurationMinutes: 25 },
  { code: "full_frame", name: "Full Frame Single", defaultDurationMinutes: 25 },
  { code: "full_frame_double", name: "Full Frame Double", defaultDurationMinutes: 25 },
  { code: "century", name: "Century", defaultDurationMinutes: 60 },
];

interface PricingSeed {
  tableType: TableType;
  gameTypeCode: string;
  price: number;
  durationMinutes: number;
}

const PRICING_RULES: PricingSeed[] = [
  // Standard tables (1-5)
  { tableType: "standard", gameTypeCode: "6_ball", price: 100, durationMinutes: 25 },
  { tableType: "standard", gameTypeCode: "6_ball_double", price: 200, durationMinutes: 25 },
  { tableType: "standard", gameTypeCode: "full_frame", price: 150, durationMinutes: 25 },
  { tableType: "standard", gameTypeCode: "full_frame_double", price: 300, durationMinutes: 25 },
  { tableType: "standard", gameTypeCode: "century", price: 600, durationMinutes: 60 },
  // Private room (table 6) — no "6 Ball Double" price given in the spec.
  { tableType: "private_room", gameTypeCode: "6_ball", price: 250, durationMinutes: 25 },
  { tableType: "private_room", gameTypeCode: "full_frame", price: 250, durationMinutes: 25 },
  { tableType: "private_room", gameTypeCode: "full_frame_double", price: 500, durationMinutes: 25 },
  { tableType: "private_room", gameTypeCode: "century", price: 1000, durationMinutes: 60 },
];

function generatePin(): string {
  // 6-digit numeric PIN, easy for counter staff to enter, hard enough to
  // guess for a dev-seeded credential that's about to be printed once.
  return crypto.randomInt(100000, 999999).toString();
}

async function main() {
  console.log("Seeding database...");

  // --- Tables -------------------------------------------------------------
  const tableSeeds: { tableNumber: number; tableType: TableType; label: string }[] = [
    { tableNumber: 1, tableType: "standard", label: "Table 1" },
    { tableNumber: 2, tableType: "standard", label: "Table 2" },
    { tableNumber: 3, tableType: "standard", label: "Table 3" },
    { tableNumber: 4, tableType: "standard", label: "Table 4" },
    { tableNumber: 5, tableType: "standard", label: "Table 5" },
    { tableNumber: 6, tableType: "private_room", label: "Table 6 - Private Room" },
  ];

  const now = new Date();
  const tables = [];
  for (const t of tableSeeds) {
    const table = await prisma.table.upsert({
      where: { tableNumber: t.tableNumber },
      update: { tableType: t.tableType, label: t.label },
      create: t,
    });
    tables.push(table);

    const hasStatusLog = await prisma.tableStatusLog.findFirst({ where: { tableId: table.id } });
    if (!hasStatusLog) {
      await prisma.tableStatusLog.create({
        data: { tableId: table.id, status: "vacant", statusFrom: now, statusTo: null },
      });
    }
  }
  console.log(`  tables: ${tables.length}`);

  // --- Game types -----------------------------------------------------------
  const gameTypeByCode = new Map<string, { id: number }>();
  for (const gt of GAME_TYPES) {
    const created = await prisma.gameType.upsert({
      where: { code: gt.code },
      update: { name: gt.name, defaultDurationMinutes: gt.defaultDurationMinutes },
      create: gt,
    });
    gameTypeByCode.set(gt.code, created);
  }
  console.log(`  game types: ${GAME_TYPES.length}`);

  // --- Owner user (needed as createdById for pricing rules below) ---------
  const existingOwner = await prisma.user.findUnique({ where: { username: "owner" } });
  let ownerId: number;
  let plaintextPin: string | null = null;

  if (existingOwner) {
    ownerId = existingOwner.id;
    console.log('  owner user "owner" already exists, skipping (PIN unchanged)');
  } else {
    plaintextPin = generatePin();
    const pinHash = await bcrypt.hash(plaintextPin, BCRYPT_ROUNDS);
    const owner = await prisma.user.create({
      data: { fullName: "Club Owner", username: "owner", role: "owner", pinHash },
    });
    ownerId = owner.id;
  }

  // --- Pricing rules (only if this (tableType, gameTypeId) has no active rule yet) ---
  let pricingCreated = 0;
  for (const rule of PRICING_RULES) {
    const gameType = gameTypeByCode.get(rule.gameTypeCode)!;
    const alreadyActive = await prisma.pricingRule.findFirst({
      where: { tableType: rule.tableType, gameTypeId: gameType.id, effectiveTo: null },
    });
    if (alreadyActive) continue;

    await prisma.pricingRule.create({
      data: {
        tableType: rule.tableType,
        gameTypeId: gameType.id,
        price: rule.price,
        durationMinutes: rule.durationMinutes,
        effectiveFrom: now,
        effectiveTo: null,
        createdById: ownerId,
      },
    });
    pricingCreated++;
  }
  console.log(`  pricing rules created: ${pricingCreated} (of ${PRICING_RULES.length} defined)`);

  console.log("Seed complete.");
  if (plaintextPin) {
    console.log("\n==================================================");
    console.log(`  Owner login  ->  username: owner   PIN: ${plaintextPin}`);
    console.log("  (shown once — store it somewhere safe; reset via PATCH /users/:id if lost)");
    console.log("==================================================\n");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
