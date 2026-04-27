# /screenshots

Marketing-surface screenshots embedded by the homepage and the docs.

The PNGs in this directory are **placeholders** until the screenshot
pipeline (`apps/web/scripts/capture-screenshots.ts`) runs against a
deployed preview URL. Each placeholder is a 96×54 flat-colour PNG —
small enough that the build doesn't ship a heavy asset by accident,
large enough that the `<img>` tag has dimensions to render against.

Re-generate the real PNGs (1920×1080 retina-doubled, light + dark
variants) with:

```bash
E2E_BASE_URL=https://preview-xyz.vercel.app \
E2E_API_BASE_URL=https://ai.aldo.tech \
ALDO_SCREENSHOT_PASSWORD=… \
  pnpm --filter @aldo-ai/web exec tsx scripts/capture-screenshots.ts
```

The script seeds a fixture set (3 composite agents, runs, a 2x3
sweep, a dashboard, an alert rule), captures the nine screens listed
in `STRIP_SHOTS`/`buildShots`, emits dark-mode companions, and tears
down the fixtures.

Slugs (each ships a `<slug>.png` and a `<slug>-dark.png`):

- `home` — `/` (full page)
- `agent` — `/agents/architect`
- `run` — `/runs/<seeded-id>` (flame graph)
- `run-inspector` — `/runs/<seeded-id>` with the inspector panel open
- `sweep` — `/eval/sweeps/<seeded-id>`
- `observability` — `/observability`
- `dashboard` — `/dashboards/<seeded-id>`
- `swagger` — `/api/docs`
- `docs` — `/docs/quickstart`

LLM-agnostic: the fixtures use capability classes
(`reasoning-large`, `tool-use`) — no provider names appear on the
captured surfaces.
