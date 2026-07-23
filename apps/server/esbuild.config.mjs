// Production bundler for `pnpm build`.
//
// Why esbuild instead of a plain `tsc` emit: `@snooker/shared` is a
// workspace package that intentionally ships no compiled output — its
// package.json points "main"/"types" straight at `src/index.ts` (see
// packages/shared/package.json) so both the desktop app's bundler and this
// server can consume one copy of the business logic without a separate
// build step to keep in sync. `tsx` (used for `pnpm dev`) transpiles that
// workspace-linked TS source on the fly, but plain `node dist/index.js`
// cannot `require("@snooker/shared")` at runtime if dist/index.js is only
// the output of a bare `tsc` compile, because `tsc` never touches files
// outside its own `rootDir` — it would leave the raw, unexecutable .ts
// import in place.
//
// So `pnpm build` does two things:
//   1. `tsc --noEmit` — full type-check across the project (this is what
//      catches real type errors; see the "build" script in package.json).
//   2. esbuild (this file) — bundles src/index.ts into a single
//      dist/index.js, inlining + transpiling @snooker/shared's TS source
//      (exactly like tsx does for dev) while leaving every *published*
//      npm dependency external so it's loaded normally from node_modules
//      at runtime.
//
// This gives a `dist/index.js` that a plain `node dist/index.js` can run,
// which is what `pnpm start` does — without ever modifying packages/shared.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  // Everything here is a real npm dependency present in node_modules at
  // runtime — only @snooker/shared (no external entry) gets bundled in.
  external: [
    "express",
    "cors",
    "jsonwebtoken",
    "bcryptjs",
    "zod",
    "dotenv",
    "node-cron",
    "@prisma/client",
    ".prisma/client",
  ],
});
