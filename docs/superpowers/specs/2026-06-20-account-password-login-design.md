# iFace Account Password Login Design

## Goal

Add first-party account/password login to iFace so each user has an isolated cloud data space.
The first version should feel like a normal product login, keep the existing local-first study
experience, and avoid losing data that already exists in IndexedDB.

## Current Context

iFace is a Vite React app with local IndexedDB as the primary data store. It already has:

- Built-in question loading from `public/questions/**/core.json`.
- Local IndexedDB stores for questions, study records, notes, answer annotations, answer
  overrides, flags, mock interviews, JD reports, and metadata.
- A Cloudflare Worker under `worker/src/index.ts`.
- A D1-backed sync snapshot flow:
  - `sync_profiles` stores generated sync identities.
  - `sync_snapshots` stores one serialized backup payload per profile.
  - `src/lib/d1Sync.ts` pushes and pulls the same backup payload shape used by local/Gist backup.
- A GitHub OAuth store used for Gist backup, not for first-party user accounts.

The account/password feature should reuse the Worker and D1 path. It should not turn built-in
question JSON into user-owned data. User-owned data means progress, notes, answer edits, starred
flags, AI sessions, custom questions, custom categories, mock interviews, and JD reports.

## Product Scope

### In Scope

- Register with email, display name, and password.
- Log in with email and password.
- Log out.
- Keep a server-side session in an HttpOnly cookie.
- Show current account state in the navigation bar.
- Add a login/register page using the existing iFace visual style.
- Sync the current local data snapshot to the logged-in account.
- Pull account data from the cloud into local IndexedDB.
- Isolate cloud snapshots by `user_id`.
- Keep anonymous local usage possible for browsing and trying the app.

### Out of Scope For Version 1

- Password reset.
- Email verification.
- Third-party login.
- Admin dashboard.
- Sharing data between users.
- Fine-grained per-record server tables.
- Complex conflict history or manual version compare UI.

## User Experience

### Anonymous User

Anonymous users can open the app, browse built-in question banks, import local content, and practice
locally. When they use cloud sync or account-only actions, iFace prompts them to log in.

The app should not block the first screen behind login. iFace remains local-first.

### Login And Register

Add a `/login` route with two modes:

- Login mode:
  - Email.
  - Password.
  - Submit button.
  - Link-style button to switch to register mode.
- Register mode:
  - Display name.
  - Email.
  - Password.
  - Confirm password.
  - Submit button.
  - Link-style button to switch back to login.

The form should use existing `input-base`, button, border, surface, and typography styles. Keep the
screen compact and work-focused rather than marketing-like. Error messages should be short and
placed near the form.

### Navigation

In `Navbar`, replace the current lack of account entry with:

- Anonymous state: a small `登录` button.
- Loading state: compact neutral account skeleton.
- Logged-in state: display name or email prefix plus a menu.
- Menu actions:
  - Sync now.
  - Account settings or cloud sync settings.
  - Log out.

On mobile, add the same account action in the mobile menu.

### Settings Drawer

Rename the D1 sync language from generated sync profile wording to account wording:

- `数据库同步` becomes `云端账号同步`.
- If logged out, show a login call to action.
- If logged in, show account email, last sync time, push, pull, and delete cloud snapshot actions.
- Keep import/export backup tools separate from account sync.

The old sync-code import/export can be kept temporarily under an advanced/legacy section or hidden
from the main flow. It should not be the primary login experience.

## Data Model

Add a new migration after `0001_sync_snapshots.sql`.

### `users`

Stores first-party account records.

Columns:

- `id TEXT PRIMARY KEY`
- `email TEXT NOT NULL UNIQUE`
- `email_normalized TEXT NOT NULL UNIQUE`
- `display_name TEXT NOT NULL`
- `password_hash TEXT NOT NULL`
- `password_salt TEXT NOT NULL`
- `password_algo TEXT NOT NULL`
- `password_iterations INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `last_login_at TEXT`

Notes:

- Normalize email with lowercase and trim.
- Store only password hashes, never plaintext.
- Use Web Crypto PBKDF2-SHA-256 with a per-user salt and a server-side pepper from a Worker secret.
- Keep algorithm and iteration count on each user row to allow future upgrades.

### `user_sessions`

Stores active sessions.

Columns:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `token_hash TEXT NOT NULL UNIQUE`
- `created_at TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `last_seen_at TEXT NOT NULL`
- `user_agent TEXT`
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

Indexes:

- `idx_user_sessions_user_id`
- `idx_user_sessions_expires_at`

The browser receives the raw random session token only as an HttpOnly cookie. D1 stores only the
SHA-256 hash.

### `user_snapshots`

Stores one cloud backup snapshot per user.

Columns:

- `user_id TEXT PRIMARY KEY`
- `payload TEXT NOT NULL`
- `payload_hash TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

This mirrors `sync_snapshots`, but the key is `user_id` instead of a generated profile id.

### Legacy Tables

Keep existing `sync_profiles` and `sync_snapshots` for compatibility during the first rollout.
Do not delete them in this feature.

## Worker API

All auth endpoints live in the existing Cloudflare Worker.

### `POST /api/auth/register`

Request:

```json
{
  "email": "user@example.com",
  "displayName": "buling",
  "password": "example-password"
}
```

Behavior:

- Validate email format, display name length, and password length.
- Reject duplicate normalized email.
- Hash password with salt and server pepper.
- Create user.
- Create session.
- Set session cookie.
- Return sanitized user.

Response:

```json
{
  "ok": true,
  "user": {
    "id": "usr_...",
    "email": "user@example.com",
    "displayName": "buling"
  }
}
```

### `POST /api/auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "example-password"
}
```

Behavior:

- Normalize email.
- Find user.
- Verify password.
- Use the same generic error for missing user and wrong password.
- Create a new session.
- Set session cookie.
- Return sanitized user.

### `POST /api/auth/logout`

Behavior:

- If a session cookie exists, delete the matching session row.
- Clear the cookie.
- Return `{ "ok": true }`.

### `GET /api/auth/me`

Behavior:

- Read session cookie.
- If valid and not expired, return sanitized user.
- If missing or expired, return `401`.
- Refresh `last_seen_at` opportunistically.

### `GET /api/account/snapshot`

Requires an authenticated session.

Behavior:

- Load the current user's snapshot from `user_snapshots`.
- Return `snapshot: null` when none exists.

### `POST /api/account/snapshot`

Requires an authenticated session.

Request:

```json
{
  "payload": {
    "version": 8,
    "exportedAt": "2026-06-20T00:00:00.000Z"
  }
}
```

Behavior:

- Reuse the existing snapshot payload validation.
- Store or replace the row for the current `user_id`.
- Return payload hash and update time.

### `DELETE /api/account/snapshot`

Requires an authenticated session.

Behavior:

- Delete only the current user's snapshot.
- Return `{ "ok": true }`.

## Cookie Policy

Use a cookie named `iface_session`.

Attributes:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- `Max-Age=2592000`

Use `fetch(..., { credentials: 'include' })` on frontend requests that need authentication.

## Frontend Architecture

### `src/store/useAccountStore.ts`

Create a new account store instead of extending the GitHub OAuth store. The GitHub store can remain
only for Gist backup.

State:

- `user`
- `loading`
- `initialized`
- `error`

Actions:

- `initAccount()`
- `register(input)`
- `login(input)`
- `logout()`
- `refreshUser()`

### `src/lib/accountApi.ts`

Centralize account API requests:

- `registerAccount`
- `loginAccount`
- `logoutAccount`
- `getCurrentAccount`
- `pullAccountSnapshot`
- `pushAccountSnapshot`
- `deleteAccountSnapshot`

This keeps cookie/credentials behavior out of components.

### `src/lib/accountSync.ts`

Mirror `d1Sync.ts`, but use authenticated account endpoints instead of profile headers.

Functions:

- `pushToAccount(aiSessions)`
- `pullFromAccount(localAISessions)`
- `deleteAccountSnapshot()`

It should reuse:

- `collectLocalSyncData` behavior from `d1Sync.ts`.
- `applySyncData` behavior from `d1Sync.ts`.
- `mergeGistBackupData`.
- `buildGistBackupPayload`.
- `parseGistBackupPayload`.

If needed, split shared snapshot helpers out of `d1Sync.ts` into `src/lib/syncSnapshot.ts` so both
legacy D1 sync and account sync use the same merge/apply code.

### `src/pages/Login.tsx`

New route:

- `/login`

Responsibilities:

- Render login/register modes.
- Call `useAccountStore`.
- Redirect to the previous route or `/` after success.
- Show concise validation and server errors.

### `src/components/layout/Navbar.tsx`

Add account entry using `useAccountStore`.

Do not make navigation depend on login status. The app should still be explorable while logged out.

### `src/components/layout/SettingsDrawer.tsx`

Update sync tab:

- Logged out: show login prompt.
- Logged in: show cloud account sync controls.
- Keep local export/import controls in the data tab.
- Keep GitHub/Gist controls only if they still provide value; otherwise reduce their prominence.

## Data Flow

### Register/Login

1. User submits form.
2. Frontend sends credentials to Worker with `credentials: 'include'`.
3. Worker validates credentials and creates a session.
4. Worker sets `iface_session` cookie.
5. Frontend stores only sanitized user state in memory.
6. Frontend optionally pushes current local data snapshot to the account.

### App Start

1. `App` or `Navbar` initializes account store.
2. Store calls `/api/auth/me`.
3. If authenticated, user state is available globally.
4. If unauthenticated, app continues in local-only mode.

### Account Sync

1. User clicks sync.
2. Frontend collects local IndexedDB snapshot.
3. Frontend pulls remote account snapshot.
4. Merge logic keeps newer or missing remote data according to existing backup merge rules.
5. Frontend applies merged data locally.
6. Frontend pushes merged snapshot to the authenticated account.

## Migration And Compatibility

Existing anonymous IndexedDB data stays in place.

On first successful login:

- Do not clear local data.
- Offer or automatically perform a safe merge push.
- If remote snapshot exists, merge local and remote using existing merge logic.
- After merge, apply the merged snapshot locally and push it back to the account.

Existing sync-code users:

- Keep old D1 sync endpoints working for now.
- Let users manually export/import if they need to move from sync-code identity to account identity.
- Exclude one-click sync-code migration from this version.

## Security Rules

- Never store plaintext passwords.
- Never expose password hash, salt, session token hash, or raw session token to the frontend.
- Use generic login error text: `邮箱或密码不正确`.
- Limit request body size using the same defensive approach as current sync endpoints.
- Validate all JSON request bodies.
- Validate snapshot payload shape before storing.
- Use constant-time comparison for password hashes and session hashes where practical.
- Store server pepper as a Worker secret, not in git.
- Keep auth cookies HttpOnly so app JavaScript cannot read session tokens.
- Delete expired sessions opportunistically during login/me checks.

Rate limiting is out of scope for the first implementation because the current stack has no
rate-limit store. The API should be structured so Turnstile or Cloudflare rate limiting can be
added in a separate feature without changing the frontend contract.

## Testing And Verification

Local verification:

- `bun run check`
- `bun run build`
- Worker auth API smoke tests against local or deployed Worker.

Manual smoke path:

1. Register a new account.
2. Confirm navbar shows account state.
3. Add a note or mark a question as starred.
4. Sync to account.
5. Log out.
6. Log in as a different account and confirm data does not appear.
7. Log back into the first account and pull/sync.
8. Confirm first account data returns.
9. Confirm built-in question counts remain unchanged.

Deployment verification:

- Apply D1 migration.
- Deploy Worker/static app.
- Call `/api/auth/me` while logged out and confirm `401`.
- Register a throwaway account.
- Confirm the response sets `iface_session`.
- Confirm `/api/auth/me` returns that account.
- Confirm snapshot push/pull only affects that account.

## Open Decisions

The first implementation should choose these defaults:

- Account identifier: email.
- Display name: required during registration.
- Session duration: 30 days.
- Password minimum length: 8 characters.
- Post-login behavior: merge local and remote snapshots, then push merged result.

These defaults are intentionally simple so the first version can ship without password reset,
email verification, or an admin console.
