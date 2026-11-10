# Printelligent Quote Desk

A customer design-to-quote workspace and private owner queue for Printelligent Designs. This release is prepared for local review. It has **not been publicly deployed**.

## Open and stop the app (Windows)

In this checkout, double-click **Start-QuoteDesk.cmd**. It starts a separate background server, waits for readiness, and opens your default browser. It continues after ChatGPT or the launcher closes. **Open-Owner-Workspace.cmd** opens the private owner login; **Stop-QuoteDesk.cmd** stops only the verified local app and preserves saved requests.

The usual address is **http://localhost:4173**. If occupied, the launcher selects an available port and opens that address automatically. It reuses an existing verified instance. Errors stay visible; details go to ignored `data/local-server.log`. If an interrupted start leaves `data/local-launch.lock`, first close other launchers, then remove only that lock and retry. Do not delete the data folder.

A verified portable Node.js 24.22.2 runtime is already installed in this local checkout. A fresh GitHub checkout excludes the runtime binary: run **Setup-Local.cmd** once (downloads from nodejs.org and verifies the pinned SHA-256), or install Node.js 24+ from the official site. If Windows policy blocks the setup script, use the official Node installer; do not weaken system policy. No npm install is needed; geometry dependencies are vendored.

The launcher always selects free rule-based guidance, even when a key exists in the approved parent `.env.local`. Keys, records, runtime files and logs are ignored by Git.

**Local** means this PC only, while it is on. **Review** means a verified candidate, not a public service. The local [business integration review](http://localhost:4173/business-review.html) demonstrates the proposed entry point. A **public customer website** needs independent hosting and durable storage; see [DEPLOYMENT.md](DEPLOYMENT.md). The main website and its DNS have not been changed.

### Create the owner login

1. Open **Open-Owner-Workspace.cmd**.
2. Expand **First time? Create your owner login**.
3. Open `data/owner-setup-token.txt` locally and copy its token into the form. Choose your own email and a unique password of 12–256 characters.
4. Select **Create owner login**, then sign in. Store your password safely.

No default owner account is installed. Browser setup works only on a local origin before an owner exists; the setup token changes on restart and is removed after successful setup. For a hosted instance, use its private interactive terminal: `node server.mjs setup-owner`. Password entry is hidden. Public browser bootstrap is disabled even behind a loopback proxy. Owner password reset is not exposed publicly; recovery requires private server administration and a verified backup.

## What works

- Two interchangeable paths: configurable sign, tray/organizer and mounting plate; or a custom brief with guided conversation and direct form entry. Notes and attachments survive path changes in the same browser tab.
- Real rotatable/zoomable geometry, keyboard camera controls, reset view, mm/inch entry, inline validation and last-valid-preview preservation. Custom ideas can show an explicitly approximate size envelope; unknown dimensions remain `?` and use labeled placeholders.
- The same versioned Manifold geometry function drives the browser worker, server validation and STL. Submitted mesh data is frozen alongside settings, preferences, contacts, open questions and an optional PNG preview. Dimensions are in millimeters.
- SQLite persistence for private attachments, quote records, immutable revisions, approval state and sessions. Request numbers and payload-bound idempotency keys prevent duplicate retries, including a renewed anonymous session. Reload recovery retries the frozen payload.
- Owner sign-in, private queue, status tracking, original revision inspection, separate owner revisions, a manually entered final price and an optional slicer-based cost calculation. Approval is a separate action. **Nothing sends email, accepts payment or starts printing.**
- STL and settings-manifest downloads for customer originals or approved owner revisions. Export rechecks dimensions, finite coordinates, oriented edge incidence, degenerate triangles and positive volume; oversize parts require owner acknowledgment. Manifold constructs the solids; this is not a guarantee of fit, strength or printability.
- Custom CAD prompt copying and brief download with assumptions, referenced filenames, unknowns and requested parametric source/STL checks. Owners can attach returned `.scad`, `.py`, `.stl`, `.step` or `.3mf` files to a new revision. Uploaded CAD is stored as data and never executed; inspect it in Bambu Studio or the appropriate CAD tool.

## Free guidance and optional AI

**Default: zero API calls and zero API charges.** Rule-based guidance asks targeted questions, preserves unknown measurements, and can offer clearly labeled family starter settings. It does not interpret photos or infer dimensions from prose. The customer confirms a suggested family before application. Manual customization, real preview, submission, owner review and CAD-prompt copying work without a key or internet AI service.

OpenAI remains an optional server-side integration: Responses API, `gpt-6.1-terra`, `store:false`, strict Structured Outputs and application validation. To deliberately enable it, configure `AI_MODE=openai` and a funded server-side key, then start the server directly instead of the free-mode launcher. Only guided-help clicks send text, recent conversation and up to two supported images under 4 MB each. Disclose this to customers first. No provider was changed and no customer data was sent elsewhere during this review. Set `AI_DISABLED=1` to force rule guidance.

The earlier November 9 live check returned 429 / insufficient_quota / credit_balance_exhausted. This is historical evidence, not a current balance check. This review made no billable model calls. Successful live model output and photo interpretation remain unverified. [DEPLOYMENT.md](DEPLOYMENT.md) records current official billing/credit sources and free-service limitations; subscription eligibility and issued credits could not be established through the connected account tools.

## Storage and deployment setup

| Setting                 | Default / purpose                                                    |
| ----------------------- | -------------------------------------------------------------------- |
| `AI_MODE`               | `rules` by default; `openai` is explicit opt-in                      |
| `MAX_UPLOAD_STORAGE_MB` | `1024` locally; proposed host cap `512`                              |
| `OPENAI_API_KEY`        | Server-side API key; optional for manual operation                   |
| `OPENAI_MODEL`          | `gpt-6.1-terra`                                                      |
| `PUBLIC_ORIGIN`         | `http://localhost:4173`; exact external origin in production         |
| `HOST`, `PORT`          | `127.0.0.1`, `4173`                                                  |
| `DATA_DIR`              | Repository-local ignored `data/`; use a durable volume in production |
| `PRINTER_X/Y/Z`         | `256` each, millimeters                                              |
| `AI_DISABLED`           | `1` simulates an outage                                              |

Production needs a Node 24 host with durable disk, HTTPS/reverse proxy, hosting secrets, owner setup and a tested backup/restore process. The included Dockerfile is a packaging starting point; Docker and a cloud deployment were not tested here. Do not use an ephemeral serverless filesystem for SQLite. This build is a single-instance app; multi-instance deployment requires shared storage, distributed limits and a migration plan.

Store `OPENAI_API_KEY` in hosting secrets, set the canonical HTTPS `PUBLIC_ORIGIN`, mount `DATA_DIR`, and ensure only the reverse proxy exposes the server. HTTPS origins enable Secure cookies. Origin checks, HttpOnly/SameSite cookies, scrypt password hashing, session expiry, upload quotas and persisted rate limits are included. Proxy client-IP forwarding is intentionally not trusted; behind a proxy, limits aggregate by the proxy address. Configure a trusted-proxy policy and edge abuse controls before a high-volume launch.

Uploads are limited to eight per revision, eight MB per file and forty MB per session. File access requires its draft session or an owner session. Download responses are attachments with sandboxing; uploaded CAD is never rendered as HTML or executed. Image/PDF signatures are checked, but files are not malware-scanned. There is no automated retention policy or account recovery flow yet. Operational access, backups, disk limits and retention need to be set for the chosen host.

### Backups and safe restoration

Run these from the repository in PowerShell. Use a private location outside Git; never upload a backup to this public repository.

```powershell
.\runtime\node.exe scripts/backup.mjs ..\private-backups\quote-desk-2026-11-09.sqlite
.\runtime\node.exe scripts/restore-backup.mjs ..\private-backups\quote-desk-2026-11-09.sqlite ..\restored-quote-data
```

Backup includes requests, frozen revisions, owner records and attachment bytes using SQLite's online backup API. Existing filenames are refused. Restore checks integrity and relationships, requires a NEW directory, verifies record counts and revokes old sessions. It never replaces live data. Test the restored copy in isolation, then stop the server and deliberately switch `DATA_DIR` (or `QUOTE_DESK_LOCAL_DATA` for the launcher) to the verified directory. Preserve the old directory for rollback. Use a fresh timestamped backup for each run.

A local backup is not off-site protection. Before public launch, select a private encrypted backup destination, schedule daily backups and monitor restore success and disk use; this requires host/storage access and a retention decision.

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
