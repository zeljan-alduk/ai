# /demo

90-second product walkthrough embedded in the homepage hero
(`components/marketing/demo-video-placeholder.tsx`).

The PNG poster in this directory is a **placeholder** until the
recorder script (`apps/web/scripts/record-demo.ts`) runs against a
deployed preview URL. The webm/mp4 files don't ship with the repo —
they're generated on-demand and uploaded to the CDN edge by CI; if
they're absent the `<video>` tag falls back to the poster image and
the player surfaces a "download" link.

Re-record with:

```bash
E2E_BASE_URL=https://preview-xyz.vercel.app \
E2E_API_BASE_URL=https://aldo-ai-api.fly.dev \
ALDO_SCREENSHOT_PASSWORD=… \
  pnpm --filter @aldo-ai/web exec tsx scripts/record-demo.ts
```

The script drives a scripted 90-second flow (signup → seed agency →
agents gallery → agent detail → runs list → flame graph + replay
scrubber → eval matrix → observability → Swagger UI) using
Playwright's built-in `recordVideo` context option, then optionally
shells out to `ffmpeg` to convert the WebM to an MP4 fallback for
Safari. Without ffmpeg on PATH the script still emits the WebM and
prints a one-line warning.

Outputs:

- `aldo-90s.webm` — Chromium/Firefox preferred source
- `aldo-90s.mp4`  — Safari fallback (only if ffmpeg installed)
- `aldo-90s-poster.png` — single frame at t=2s (this file's
  placeholder is overwritten by the recorder)

LLM-agnostic: the recorded flow only uses capability classes —
no provider names appear on screen during the recording window.
