# Printelligent Quote Desk

A customer design-to-quote workspace and private owner queue for Printelligent Designs. This release is prepared for local review. It has **not been publicly deployed**.

## Start locally

Requires Node.js 24 or newer. Runtime geometry dependencies are pinned and included, so no npm install or remote CDN is needed.

```powershell
cd C:\Users\wirku\Documents\Codex\2026-11-09\new-chat-3\repo
node --env-file-if-exists=../.env.local server.mjs
```

Open **http://localhost:4173**. Use that exact origin rather than 127.0.0.1; write requests intentionally require the configured origin. Stop with Ctrl+C. The key for this local checkout is in the user-approved parent `.env.local`, outside this repository. For another checkout, supply your own ignored environment file or environment variables. Never commit API keys.

### Create the owner login

1. Start the server and open **http://localhost:4173/owner**.
2. Expand **First time? Create your owner login**.
3. Open `data/owner-setup-token.txt` locally, copy its token into the form, and choose your email and a password of at least 12 characters.
4. Select **Create owner login**, then sign in.

The bootstrap form only works from the server's own computer and only before an owner exists. The token changes on restart. No default production password is provided. For a remote server, create the owner locally before exposure, or use `node server.mjs setup-owner` from its private terminal. The terminal option visibly echoes the password; prefer the browser setup when possible.

## What works

- Two interchangeable paths: configurable sign, tray/organizer and mounting plate; or a custom brief with guided conversation and direct form entry. Notes and attachments survive path changes in the same browser tab.
- Real rotatable/zoomable geometry, keyboard camera controls, reset view, mm/inch entry, inline validation and last-valid-preview preservation. Custom ideas can show an explicitly approximate size envelope; unknown dimensions remain `?` and use labeled placeholders.
- The same versioned Manifold geometry function drives the browser worker, server validation and STL. Submitted mesh data is frozen alongside settings, preferences, contacts, open questions and an optional PNG preview. Dimensions are in millimeters.
- SQLite persistence for private attachments, quote records, immutable revisions, approval state and sessions. Request numbers and payload-bound idempotency keys prevent duplicate retries, including a renewed anonymous session. Reload recovery retries the frozen payload.
- Owner sign-in, private queue, status tracking, original revision inspection, separate owner revisions, a manually entered final price and an optional slicer-based cost calculation. Approval is a separate action. **Nothing sends email, accepts payment or starts printing.**
- STL and settings-manifest downloads for customer originals or approved owner revisions. Export rechecks dimensions, finite coordinates, oriented edge incidence, degenerate triangles and positive volume; oversize parts require owner acknowledgment. Manifold constructs the solids; this is not a guarantee of fit, strength or printability.
- Custom CAD prompt copying and brief download with assumptions, referenced filenames, unknowns and requested parametric source/STL checks. Owners can attach returned `.scad`, `.py`, `.stl`, `.step` or `.3mf` files to a new revision. Uploaded CAD is stored as data and never executed; inspect it in Bambu Studio or the appropriate CAD tool.

## AI behavior and current limitation

The server uses `POST https://api.openai.com/v1/responses`, model `gpt-6.1-terra`, `store:false` and strict JSON-schema Structured Outputs. Application validation rejects invalid or unknown settings before showing a proposal. The customer must explicitly accept a proposal. Slider/field adjustments never call AI.

The live API check returned **HTTP 429 / insufficient_quota / credit_balance_exhausted** on November 9, 2026. The valid key is configured, but successful real-model intake and photo interpretation remain unverified until API credits are available. No billing changes were made. Form entry, preview, submission and owner review work without AI. To test an outage explicitly, set `AI_DISABLED=1` and restart.

Only guided-help clicks send description, recent conversation and up to two supported images under 4 MB each to OpenAI. Other attachments are retained for owner review and referenced by filename in the handoff. Uploaded content is untrusted data; it cannot supply system instructions or executable code.

## Storage and deployment setup

| Setting          | Default / purpose                                                    |
| ---------------- | -------------------------------------------------------------------- |
| `OPENAI_API_KEY` | Server-side API key; optional for manual operation                   |
| `OPENAI_MODEL`   | `gpt-6.1-terra`                                                      |
| `PUBLIC_ORIGIN`  | `http://localhost:4173`; exact external origin in production         |
| `HOST`, `PORT`   | `127.0.0.1`, `4173`                                                  |
| `DATA_DIR`       | Repository-local ignored `data/`; use a durable volume in production |
| `PRINTER_X/Y/Z`  | `256` each, millimeters                                              |
| `AI_DISABLED`    | `1` simulates an outage                                              |

Production needs a Node 24 host with durable disk, HTTPS/reverse proxy, hosting secrets, owner setup and a tested backup/restore process. The included Dockerfile is a packaging starting point; Docker and a cloud deployment were not tested here. Do not use an ephemeral serverless filesystem for SQLite. This build is a single-instance app; multi-instance deployment requires shared storage, distributed limits and a migration plan.

Store `OPENAI_API_KEY` in hosting secrets, set the canonical HTTPS `PUBLIC_ORIGIN`, mount `DATA_DIR`, and ensure only the reverse proxy exposes the server. HTTPS origins enable Secure cookies. Origin checks, HttpOnly/SameSite cookies, scrypt password hashing, session expiry, upload quotas and persisted rate limits are included. Proxy client-IP forwarding is intentionally not trusted; behind a proxy, limits aggregate by the proxy address. Configure a trusted-proxy policy and edge abuse controls before a high-volume launch.

Uploads are limited to eight per revision, eight MB per file and forty MB per session. File access requires its draft session or an owner session. Download responses are attachments with sandboxing; uploaded CAD is never rendered as HTML or executed. Image/PDF signatures are checked, but files are not malware-scanned. There is no automated retention policy or account recovery flow yet. Operational access, backups, disk limits and retention need to be set for the chosen host.

### Backups

```powershell
node scripts/backup.mjs C:\private-backups\quote-desk.sqlite
```

Create the destination directory first. The SQLite online-backup API includes uploads and all private quote data. Protect backups like the live data directory. To restore, stop the server, preserve the current database for rollback, replace `quotes.sqlite` with the backup, remove only stale WAL/SHM files from that stopped database, and restart. Test restoration in an isolated directory before relying on a backup.

## Checks

```powershell
node scripts/verify-vendor.mjs
node --test test/*.test.mjs
```

See [VERIFICATION.md](VERIFICATION.md) for observed end-to-end results and limits. Browser QA uses fictional contacts and an isolated owner database; none of those records, credentials or screenshots are committed.

## Extending design families

1. Add defaults and validation to `shared/schema.js`.
2. Add deterministic millimeter geometry to `shared/geometry.js` and controls to `paramFields()` in `public/app.js`.
3. Add dimension, feature-placement and mesh tests. Bump `VERSION` for geometry changes; never silently reinterpret an old version's parameters.
4. Existing revisions retain their generated mesh. Preserve older version-specific dimension rules or add a version registry if a new generator changes coordinate conventions. The first release has one generator version.

Main files: `server.mjs` routes/validation, `store.mjs` persistence/authentication, `ai.mjs` Responses integration, `shared/` schemas/geometry/CAD brief, `public/` customer and owner UI. No framework existed in the selected repository; it was empty when inspected. The small Node/SQLite/ES-module stack was chosen for shared geometry and easy local operation.

## Third-party code

- Three.js **0.187.0**, MIT, minimal runtime build plus FontLoader/OrbitControls. Those two helpers have local relative imports; no CDN requests.
- Manifold **3.5.4**, Apache-2.0, vendored JS/WASM and its original license.
- Helvetiker typeface data from Three.js's official repository, with original embedded font metadata retained.

SHA-256 hashes are recorded in `vendor/integrity.json`. Original package manifests and license files are retained. Upgrades require geometry regression tests and an explicit generator-version decision.

API references: [Responses](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Manifold](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html).
