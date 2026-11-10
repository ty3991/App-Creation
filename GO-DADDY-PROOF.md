# Quote Desk with no additional monthly charge

The review build tests a browser-only design widget above a separate quote form. It uses the existing Three.js viewer, Manifold WASM, geometry version, and validation. The widget makes no network requests, needs no AI or asset hosting, and creates a text packet the owner can validate and reopen. The browser preview and form receiver below are local evidence. GoDaddy sign-in is required to verify what your actual editor accepts and where its form delivers.

## Review it locally

In File Explorer open the `repo` folder. Type `powershell` in the File Explorer address bar and press Enter. The generated snippet is already available at `build/godaddy/paste-into-godaddy.html` in the working checkout. To start the simulated page, run:

```powershell
.\runtime\node.exe scripts/godaddy-proof-review.mjs
```

Open `http://localhost:4180/` on this PC. Press Ctrl+C in the PowerShell window to stop it. This form only accepts fictional test data. It records the packet and the photo's filename, byte count and SHA-256 in the ignored `build/godaddy` folder. It does not retain the photo itself or send mail. On a fresh checkout with Node.js 24 and npm installed, use `npm ci` and `npm run build:godaddy-proof` first. The pinned esbuild dependency is only used to build the snippet.

1. Select **Mounting plate**. Enter width 139.7, depth 88.9, hole diameter 6.35, horizontal spacing 95.25 and vertical spacing 50.8, all in millimeters. Leave thickness at 5 and rows and columns at 2. Confirm the preview dimensions.
2. Select **Prepare quote packet**, then **Copy packet**. Paste into the separate Message field. If clipboard access is blocked, the widget selects the packet text for the device's Copy command. **Download packet** is an alternate path and a way to keep a retry copy. Each generated packet keeps its ID until the design is edited.
3. Select a fictional PNG or JPEG and **Simulate send**. The success status shows the packet ID and photo size. A repeat send is rejected by this simulator and leaves the packet in the form. In the proposed GoDaddy flow, the manual handoff adds prepare, copy and paste before the ordinary attachment and Send steps. The real form’s retry and duplicate behavior must be checked separately.
4. Take the saved packet text and reopen it using the owner command below. Reference attachments are passed separately. Store any real requests privately, outside this review folder and outside Git.

```powershell
.\runtime\node.exe scripts/open-quote-packet.mjs 'C:\path\quote-packet.txt' 'C:\path\quote.stl'
```

For a custom idea, use a `.txt` output name and add each reference file path after it. The tool preserves unknown fit measurements, lists the reference names, and writes the CAD prompt. Output files are never overwritten. The packet ID is useful for matching a retry to a received email. It is not a server receipt or an authenticity signature. Material and finish remain preferences for owner review.

## Unpublished GoDaddy test and rollback

1. Open [GoDaddy My Products](https://account.godaddy.com/products) and sign in privately. Under **Websites + Marketing**, choose **Manage → Edit Website** for `printelligentdesigns.com`. Check the current product/plan and whether the editor exposes **HTML** and **Contact Form** without an upgrade. Use a separate unpublished test page with navigation visibility disabled. Leave the live Get a Quote form and its recipient in place.
2. Choose **Add Section → HTML → Add**. Open the generated `build/godaddy/paste-into-godaddy.html` in Notepad and copy its entire text into **Custom Code**. It is approximately 1.46 MB because it carries its own JavaScript and WASM. Preview before saving any launch decision. Try the mobile preview and inspect the iframe and browser console for truncation, script/WASM blocks, blocked downloads or clipping. Use the HTML section's **Forced Height** only if needed. If the editor rejects or truncates the snippet, record the observed limit.
3. On the test page add a **Contact Us** section. In **Contact Form**, set **Send Message To** to an authorized test inbox, enable **Attachments**, and retain a **Message** field. Use fictional data. Test copying the packet and selecting a PNG. GoDaddy documents the HTML section as an iframe, and its public docs do not offer a supported bridge to populate the separate native form. The local proof relies on explicit copy/paste rather than accessing parent form internals. Verify actual behavior and the number of actions in the editor.
4. From **Preview**, attempt a single test submit only if preview explicitly supports it and the recipient is authorized. Verify actual receipt, compare the recovered packet and photo with the source, then retry a failed send and check whether the draft survives. If Preview disables sending, inbox delivery requires a separately approved live test. A preview success message alone is not delivery evidence. The documented native cap is below 10 MB per file and below 15 MB total. `.txt` and common photo types are supported. STL is not on the published allowlist.
5. The inbox approach needs TJ's approval before adoption because the GoDaddy form would replace the online owner queue and there is no verified server-side duplicate protection or immutable audit log. Keep existing Quote Desk data intact. If the trial fails or TJ prefers the existing workflow, remove the two draft sections or the unpublished test page in the editor and leave the draft unpublished. If an approved published integration is later rolled back, remove the widget and republish the prior form layout. No DNS changes are needed for this native approach.

Official guidance: [Add an HTML section](https://www.godaddy.com/help/add-html-or-custom-code-to-my-site-27252), [iframe limits](https://www.godaddy.com/help/troubleshoot-html-or-custom-code-not-displaying-properly-28025), [contact form settings and file limits](https://www.godaddy.com/help/customize-my-contact-us-section-20113).

## Free backend candidate

Cloudflare Pages Functions on Workers Free with D1 Free is a candidate if GoDaddy fails the handoff. A Pages subdomain supports a CNAME at the current GoDaddy DNS provider. The public terms cover entities, subject to service terms and the acceptable-use policy. No account eligibility, terms acceptance, private hosted data settings, or live cost/CPU behavior was verified in an authenticated Cloudflare dashboard. Avoid R2 because its included usage can roll into paid metering. Verify that the account stays on Workers Free and enables no paid products before any deployment.

D1 Free documents 500 MB per database, a 2 MB row or BLOB limit, seven days of point-in-time recovery, and query failures when free daily quotas or storage limits are reached. Workers Free documents 10 ms CPU per request and 100,000 daily requests. Retention and a separate export plan still matter. The local emulator accepted the actual 356-byte plate packet with its 68-byte test PNG, and separately preserved an 8 MiB binary fixture in eight chunks with exact bytes on readback. A 403 blocked anonymous reads. An application capacity check rejected a write atomically with 507 and left earlier data readable. These are real local Workerd/D1 calls, with a deliberately simulated storage cap. Local wall-clock duration is not Cloudflare CPU time. A live representative photo upload still needs measured CPU evidence. Keep geometry in the browser and do not move the existing Node/SQLite server to this runtime unchanged.

The test requires local Miniflare, installed outside the app. Reproduce with `scripts/probe-free-d1.mjs` and arguments for Miniflare’s `dist/src/index.js`, a received quote packet `.txt`, and a fictional reference PNG. The probe uses a short-lived test bearer secret and never deploys an endpoint. A production port would need real owner authentication, a budget for each read/write and upload, file lifecycle limits, authenticated exports, and the existing revision and idempotency behavior. No hosted adapter is claimed ready.

Sources: [Cloudflare terms](https://www.cloudflare.com/terms/), [Pages subdomains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 quota behavior](https://developers.cloudflare.com/d1/platform/pricing/), [R2 billing](https://developers.cloudflare.com/r2/pricing/).

## Verification

| Check                                        | Result                  | Evidence                                                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile 3D preview                            | Pass, local             | 390 × 844 browser viewport. Sandboxed `srcdoc` rendered real WebGL, no console warnings or errors during the tested edit. Plate updated to 139.7 × 88.9 × 5 mm without horizontal overflow.                                        |
| Exact design and reference handoff           | Pass, simulated         | Packet `724871599706f1dd43976f59604d2500` retained generator `pd-geometry-1.0.0`, all four hole settings and preferences. Reference SHA-256 matched the selected PNG. Clipboard copy succeeded.                                    |
| Retry and private file controls              | Pass, local             | Simulator rejected duplicate packet and retained Message. Existing server test denied a second session access, returned 507 at storage capacity, and preserved the accepted file.                                                  |
| Plate STL and scale                          | Pass, local             | Recovered STL had 1,052 triangles and no invalid edges or degenerate faces. Its SHA-256 matched the prior review's STL imported into Bambu Studio at 5.5 × 3.5 × 0.19685 inches. No second import was required to check the bytes. |
| D1 candidate                                 | Pass, local feasibility | Local emulator round trip for packet and photo, 8 MiB chunking, private read denial, and atomic simulated quota failure. Real hosted performance, terms acceptance and billing settings pending.                                   |
| Real GoDaddy editor, inbox and PC-off access | Blocked                 | Account page requested sign-in. Cannot establish editor entitlement, snippet acceptance, native attachment delivery, or public uptime from local tests.                                                                            |

The local proof is separate from the original quote queue. Tests use only fictional data. Publishing, production DNS and merging require TJ's approval.
