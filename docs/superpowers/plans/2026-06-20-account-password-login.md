# Account Password Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-party email/password accounts to iFace, with isolated account snapshots stored in Cloudflare D1.

**Architecture:** Keep iFace local-first. Add Worker auth endpoints backed by D1 users/sessions/user_snapshots, then add frontend account API/store/login UI and account-backed snapshot sync. Keep the legacy sync-code endpoints working.

**Tech Stack:** Vite React 19, TypeScript, IndexedDB via `idb`, Cloudflare Workers, Cloudflare D1, Bun scripts for verification.

---

### Task 1: D1 Account Migration

**Files:**
- Create: `worker/migrations/0002_account_password_login.sql`

- [ ] Add `users`, `user_sessions`, and `user_snapshots` tables.
- [ ] Add indexes for normalized email, session token hash, user sessions, and session expiry.
- [ ] Keep `sync_profiles` and `sync_snapshots` untouched.
- [ ] Verify the migration is syntactically valid by inspecting it and later applying with Wrangler.

### Task 2: Worker Auth Core And Smoke Tests

**Files:**
- Modify: `worker/src/index.ts`
- Create: `scripts/checkAccountAuth.ts`
- Modify: `package.json`

- [ ] Extract auth helpers inside `worker/src/index.ts`: email normalization, random IDs, PBKDF2 hashing, password verification, cookie parsing, cookie building, sanitized user response.
- [ ] Add a Bun smoke script that mocks a D1 binding and exercises register, duplicate register, me, logout, wrong password, login, and per-user snapshot isolation.
- [ ] Run the smoke script before the Worker implementation is complete and confirm it fails for missing endpoints.
- [ ] Implement Worker endpoints until the smoke script passes.
- [ ] Add `check:account-auth` to `package.json`.

### Task 3: Worker Routes And Cloudflare Config

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] Add `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- [ ] Add `/api/account/snapshot` GET, POST, DELETE.
- [ ] Keep `/api/sync/*` routes unchanged.
- [ ] Expand the Cloudflare route pattern so account endpoints reach the Worker.
- [ ] Document `AUTH_PEPPER` as a Worker secret.
- [ ] Re-run the account smoke script.

### Task 4: Shared Snapshot Sync Helpers

**Files:**
- Create: `src/lib/syncSnapshot.ts`
- Modify: `src/lib/d1Sync.ts`

- [ ] Move local snapshot collection, apply, and result-building helpers out of `d1Sync.ts`.
- [ ] Export helpers needed by account sync.
- [ ] Keep existing D1 sync behavior unchanged.
- [ ] Run `bun run check:sync` to verify existing backup merge behavior.

### Task 5: Frontend Account API, Store, And Account Sync

**Files:**
- Create: `src/lib/accountApi.ts`
- Create: `src/lib/accountSync.ts`
- Create: `src/store/useAccountStore.ts`

- [ ] Add typed account API helpers with `credentials: 'include'`.
- [ ] Add account store with init, register, login, logout, and refresh user actions.
- [ ] Add account sync push, pull, and delete functions using authenticated snapshot endpoints.
- [ ] Ensure no raw password or session token is stored in localStorage.
- [ ] Run TypeScript/build checks after wiring imports.

### Task 6: Login Page And Route

**Files:**
- Create: `src/pages/Login.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/routePreload.ts`

- [ ] Add `/login` route.
- [ ] Implement login/register toggle using the existing iFace visual language.
- [ ] Redirect back to the previous path or `/` after success.
- [ ] Show concise validation/server errors.
- [ ] Keep anonymous app usage available.

### Task 7: Navbar Account Entry

**Files:**
- Modify: `src/components/layout/Navbar.tsx`

- [ ] Initialize account state from the navbar.
- [ ] Show `登录` for anonymous users.
- [ ] Show a compact user menu for logged-in users.
- [ ] Add logout and sync-now actions.
- [ ] Add matching mobile menu behavior.

### Task 8: Settings Cloud Account Sync UI

**Files:**
- Modify: `src/components/layout/SettingsDrawer.tsx`

- [ ] Keep the `sync` tab but rename the primary text to account cloud sync.
- [ ] If logged out, show an account login call to action.
- [ ] If logged in, show account identity and account snapshot push/pull/delete actions.
- [ ] Keep legacy D1 sync-code controls in a lower-priority compatibility section.
- [ ] Preserve GitHub/Gist behavior.

### Task 9: Verification And Deployment

**Files:**
- Modify as needed: `README.md`

- [ ] Run `bun run check:account-auth`.
- [ ] Run `bun run check:sync`.
- [ ] Run `bun run check:questions`.
- [ ] Run `bun run build`.
- [ ] Apply D1 migrations remotely.
- [ ] Set/confirm Worker `AUTH_PEPPER` secret.
- [ ] Deploy Worker.
- [ ] Build and publish static app to VPS.
- [ ] Verify online `/api/auth/me` returns `401` when logged out.
- [ ] Register a throwaway account online, verify cookie/me, then verify snapshot isolation.
