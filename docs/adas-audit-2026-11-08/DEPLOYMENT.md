# BlueLine deployment — 08/11/2026

- Production: https://blueline2026.pages.dev/
- Immutable deployment: https://5ac785c5.blueline2026.pages.dev/
- Deployment ID: `5ac785c5-96eb-4a43-a17a-a6408b3288ce`
- Cloudflare deploy stage: success, completed `2026-11-08T10:57:56.693892Z` (17:57:56 giờ Việt Nam).
- Previous production ID retained for rollback: `795b1c0e-db62-40cc-96eb-e4f87bb3ef40`.
- Only `dist` uploaded: 22 files, 29,521,935 bytes. Three changed assets uploaded; remaining assets reused. Largest file 11,778,688 bytes.
- Manifest: `upload-manifest.json`. Build output: `deploy-build.log`.
- Verified live app bundle: `index-RMQM1OaV.js`; stylesheet `index-Cs1N1xWW.css`.
- Live browser: loading finished, empty boot-error, no captured console errors. Held W before the stalled car: AEB HOLD, 0 km/h, approximately 6.5 m clearance, 0 collisions in this smoke test. Screenshot: `live-deployment.jpg`.

This is a direct upload of the already audited local production build. No repository or Pages source settings were changed. The GitHub source remains unsynchronized; its existing automatic production builds are still enabled and could replace this direct deployment when an old source revision is built. Keep this deployment ID for recovery and synchronize source before the next repository-triggered release.
