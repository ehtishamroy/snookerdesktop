# Run & Host Guide

Step-by-step instructions to run this system on your own machine, and then
to host it for real use at the club. Follow Part 1 first just to see it
working — don't jump straight to hosting.

---

## Part 0 — One-time installs on your computer

Install these once, in this order:

1. **Git** — https://git-scm.com/downloads (to download/update the code)
2. **Node.js 20 or newer** — https://nodejs.org (download the "LTS" installer
   for your OS and click through it)
3. **pnpm** (the package manager this project uses) — after Node is
   installed, open a terminal and run:
   ```bash
   npm install -g pnpm
   ```
4. **PostgreSQL** (the database for the cloud backend) — easiest options:
   - **Simplest for hosting later: a free [Supabase](https://supabase.com)
     project.** Sign up, create a project, and Supabase gives you a ready-made
     Postgres `DATABASE_URL` connection string — no local Postgres install
     needed at all, even for local development. This is what the original
     spec assumed you'd use.
   - **Or install Postgres locally** if you'd rather not depend on the
     internet while developing: https://www.postgresql.org/download/
     (Windows: run the installer, remember the password you set for the
     `postgres` user).
5. **(Windows only, for building the desktop app)** Visual Studio Build
   Tools with the "Desktop development with C++" workload —
   https://visualstudio.microsoft.com/visual-cpp-build-tools/ — only needed
   if `pnpm install` can't download a prebuilt native module for your exact
   Windows version (rare; it will tell you if this happens).

That's everything. You do **not** need Docker, Electron, or anything else
pre-installed — the rest comes in through `pnpm install`.

---

## Part 1 — Get the code running locally (try it out)

Open a terminal in the project folder and run these once:

```bash
pnpm install
```

This downloads every dependency for all 4 parts of the system (shared logic,
backend, desktop app, owner dashboard). It takes a few minutes the first time.

### 1. Start the backend (cloud API + database)

```bash
cd apps/server
cp .env.example .env
```

Open the new `.env` file in a text editor and set:
- `DATABASE_URL` — paste the connection string from Supabase (Project
  Settings → Database → Connection string), or if using local Postgres:
  `postgresql://postgres:YOUR_PASSWORD@localhost:5432/snooker`
- `JWT_SECRET` — replace with any long random string (run `openssl rand
  -hex 32` in a terminal to generate one, or just mash the keyboard for 40+
  characters).

Then, still inside `apps/server`:

```bash
pnpm prisma:generate      # generates the database client
pnpm prisma:migrate       # creates all the tables in your database
pnpm prisma:seed          # creates the 6 tables, pricing, and one owner login
```

The seed step **prints an owner login PIN to the terminal** — copy it now,
it's only shown once (username is always `owner`).

Start the backend:

```bash
pnpm dev
```

Leave this terminal window open — it's now running at `http://localhost:4000`.

### 2. Start the owner dashboard (in a new terminal window)

```bash
cd apps/owner-dashboard
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000` in your browser and log in with
username `owner` and the PIN the seed step printed.

### 3. Start the counter (desktop) app (in a third terminal window)

```bash
cd apps/desktop
pnpm dev
```

This opens the actual Electron counter app window. It seeds its **own**
separate local login the first time it runs: username `owner`, PIN `0000`
— change that PIN immediately from Admin Settings once it's open. This app
works with **zero internet connection**; the sync engine only needs the
backend (step 1) to be reachable when you want it to push/pull data to the
cloud (owner dashboard reads from the cloud copy, not from this app
directly).

At this point you have all three pieces running and can click through the
whole system: register a game on a table, end it, settle a customer's tab,
close a shift, check the owner dashboard for the numbers.

---

## Part 2 — Package the desktop app into a real Windows installer

The counter PC at the club shouldn't run `pnpm dev` — it should get a real
double-click installer. Build it like this:

```bash
cd apps/desktop
pnpm package
```

This produces `apps/desktop/release/Snooker Counter-Setup-<version>.exe` —
copy that single file to the counter PC and run it like any other Windows
installer.

**Important:** Windows installers (`.exe`/NSIS) can only be reliably built
*on a Windows machine* (or Linux with Wine installed, which is fiddly). If
you're developing on Mac/Linux, either:
- Build it on any Windows PC (even the counter PC itself) by copying the
  `apps/desktop` folder there, installing Node.js + pnpm (Part 0, steps 2–3
  only), running `pnpm install` then `pnpm package` from inside that folder; or
- Set up a free GitHub Actions workflow with a `windows-latest` runner to
  build the `.exe` automatically — say the word and this can be added.

Once installed, open the app's **Admin Settings** screen and point
"Sync Server URL" at wherever you hosted the backend in Part 3 below (not
`localhost` anymore, since it now needs to reach the real internet-hosted
server).

---

## Part 3 — Host it for real, permanently

You need two things online 24/7: the **backend** and the **owner
dashboard**. The desktop app itself is not "hosted" — it's installed
directly on the counter PC(s) and just needs network access to reach the
hosted backend.

### A. Database — Supabase (recommended, free tier works fine for one club)

1. Create a project at https://supabase.com.
2. Copy its Postgres connection string (Project Settings → Database).
3. That's it — this is the `DATABASE_URL` you'll give the backend below.

### B. Backend API — Render.com (free/cheap, simplest option)

1. Push this repository to GitHub if it isn't already there.
2. Create a free account at https://render.com, click **New → Web Service**,
   connect your GitHub repo.
3. Set:
   - **Root directory**: `apps/server`
   - **Build command**: `pnpm install --frozen-lockfile && pnpm prisma:generate && pnpm build`
   - **Start command**: `pnpm prisma:migrate:deploy && pnpm start`
   - **Environment variables**: add `DATABASE_URL` (from Supabase),
     `JWT_SECRET` (a long random string), `PORT` = `4000`, `CORS_ORIGINS` =
     the URL your owner dashboard will live at (see part C below, e.g.
     `https://your-club.vercel.app`).
4. Deploy. Render gives you a public URL like
   `https://snooker-server.onrender.com` — that's your backend's address.
5. Run the seed once (Render's shell tab, or run it locally pointed at the
   production `DATABASE_URL`): `pnpm prisma:seed`.

(Railway.app and Fly.io work the same way if you prefer them over Render —
same three settings: root directory, build command, start command.)

### C. Owner dashboard — Vercel (built by the same people as Next.js, free tier)

1. Go to https://vercel.com, sign in with GitHub, **Add New → Project**,
   pick this repo.
2. Set **Root Directory** to `apps/owner-dashboard`.
3. Add environment variable `NEXT_PUBLIC_API_URL` = your Render backend URL
   + `/api` (e.g. `https://snooker-server.onrender.com/api`).
4. Deploy. Vercel gives you a URL like `https://your-club.vercel.app` — open
   it on your phone and "Add to Home Screen" for an app-like icon (it's a
   PWA, per the original spec's "mobile app via web" approach).

### D. Point the desktop app(s) at the hosted backend

On each counter PC, after installing the packaged `.exe` (Part 2):
Admin Settings → Sync Server URL → set to
`https://snooker-server.onrender.com/api` (your Render URL + `/api`).

### E. Backups (already built in, just confirm the folder)

- **Desktop**: Admin Settings → set a backup folder to a second drive or a
  mounted USB stick; the app copies its local database there on a schedule
  automatically (decision #14).
- **Cloud database**: Supabase takes daily backups automatically on paid
  plans; on the free tier, periodically use Supabase's SQL editor or `pg_dump`
  to export a copy yourself, or upgrade to a paid tier once the club is
  relying on this for real revenue tracking.

---

## Recap — the shortest path

1. Install Node.js + pnpm (Part 0).
2. `pnpm install`, then follow Part 1 to try everything locally.
3. When ready to go live: Supabase (database) + Render (backend) + Vercel
   (owner dashboard) — all free-tier-friendly — then `pnpm package` the
   desktop app on Windows and install it at the counter, pointed at your
   Render URL.
