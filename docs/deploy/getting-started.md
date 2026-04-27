# Deploying ALDO AI for the first time

A click-by-click checklist that takes you from a fresh GitHub repo to a
running URL on free tiers. Should take ~30 minutes.

You'll end up with:

- **Web** at `https://<your-project>.vercel.app` (Vercel free tier)
- **API** at `https://ai.aldo.tech` (Fly.io free tier)
- **Postgres** on Neon (free tier, with branches per PR)
- **Trace + replay artifacts** on Cloudflare R2 (free tier, no egress fees)

All four are real free tiers, not trials.

## 0. Prerequisites

- A GitHub account that owns the public ALDO AI repo.
- Vercel, Fly.io, and Neon accounts (free).
- A Cloudflare account if you want R2 (optional for v0).
- The `flyctl` CLI installed locally if you want to run the first
  `fly launch` from your laptop. (CI handles every subsequent deploy.)

## 1. Provision Postgres on Neon

1. Sign up at <https://neon.tech>. Free tier: 0.5 GB, generous.
2. Create a project named `aldo-ai`. Region: pick whichever is closest
   to where Fly.io will run (`iad` ≈ US East).
3. Copy the **Pooled** connection string from the dashboard. It looks
   like:
   ```
   postgres://<user>:<pass>@ep-foo-bar.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Save it as `DATABASE_URL` — you'll paste it into Fly.io secrets and
   into Vercel's env vars.

Branching for PR previews comes free — Neon's GitHub integration
auto-creates a branch per PR. Hook it up later via Settings → GitHub.

## 2. Deploy the API to Fly.io

From your laptop:

```bash
cd apps/api
fly launch --copy-config --no-deploy
# When prompted: app name `aldo-ai-api`, region `iad`, no Postgres
# (we use Neon), no Redis. Accept the auto-detected Dockerfile.

fly secrets set \
  DATABASE_URL="postgres://..." \
  CORS_ORIGINS="https://ai.aldo.tech,https://aldo-ai-pr-*.vercel.app"

# Optional provider keys:
fly secrets set \
  GROQ_API_KEY="gsk_..." \
  GEMINI_API_KEY="..." \
  ANTHROPIC_API_KEY="sk-ant-..." \
  OPENAI_API_KEY="..."

fly deploy
```

Visit `https://ai.aldo.tech/health` — should return
`{"ok":true,"version":"0.0.0"}`.

### Wire the Fly.io GitHub Action (optional but recommended)

So future deploys happen on every push to `main`:

1. In your Fly.io dashboard: **Tokens → Create deploy token** for the
   `aldo-ai-api` app.
2. In GitHub: **Settings → Secrets and variables → Actions**:
   - Add a **Repository secret** `FLY_API_TOKEN` with the token.
   - Add a **Repository variable** `DEPLOY_API_ENABLED` set to `true`.
3. Push to `main` — `.github/workflows/deploy-api.yml` does the rest.

## 3. Deploy the Web app to Vercel

1. Vercel dashboard → **Add New → Project** → import your GitHub repo.
2. **Framework preset**: Next.js (auto-detected).
3. **Root directory**: `apps/web`.
4. **Environment variables**:
   - `NEXT_PUBLIC_API_BASE` → `https://ai.aldo.tech`
5. Click **Deploy**.

Vercel auto-deploys on every push to `main` and creates a preview URL
for every PR. No additional GitHub Action needed — Vercel's built-in
integration is enough.

### Update the API CORS allowlist

Once Vercel gives you a project URL (like `https://ai.aldo.tech`),
make sure your `CORS_ORIGINS` Fly secret includes it:

```bash
fly secrets set CORS_ORIGINS="https://ai.aldo.tech,https://aldo-ai-pr-*.vercel.app"
```

(The PR preview URLs use predictable patterns like
`aldo-ai-git-<branch>-<scope>.vercel.app`. The wildcard above only
works if your reverse proxy supports it; if not, list specific origins
or set `CORS_ORIGINS=*` for development only.)

## 4. Verify end-to-end

```bash
curl -s https://ai.aldo.tech/health
# {"ok":true,"version":"0.0.0"}

curl -s https://ai.aldo.tech/v1/models | head -c 200
# {"models":[{"id":"claude-opus-4-7",...}]}
```

Open `https://ai.aldo.tech` in your browser. You should see the
Runs page (empty list with `No runs yet`). Click **Models** in the
sidebar — you should see the model registry populated from the
gateway fixtures, with `available` flipping to `true` for any
provider whose key you set on Fly.

## 5. Optional: artifact storage on R2

For replay bundles (>0.5 GB Postgres limit will bite eventually):

1. Cloudflare dashboard → **R2 Object Storage** → create bucket
   `aldo-artifacts`. Free tier: 10 GB, no egress fees.
2. Generate API token with **Object Read & Write**.
3. Add to Fly secrets:
   ```bash
   fly secrets set \
     S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com" \
     S3_REGION="auto" \
     S3_ACCESS_KEY_ID="..." \
     S3_SECRET_ACCESS_KEY="..." \
     S3_BUCKET="aldo-artifacts"
   ```

(R2 wiring is wave 5+. The env vars are read by `apps/api` once the
replay-bundle writer ships.)

## 6. Optional: trace backend

Self-host **Langfuse** on Fly.io (or use Langfuse Cloud's free tier),
point `OTEL_EXPORTER_OTLP_ENDPOINT` at it. Wave 5+.

## 7. Cost guardrails

- **Per-run hard cap**: set `ALDO_RUN_USD_CAP` (default `1.00`) on Fly
  secrets to cap any single agent run.
- **Default privacy tier**: `ALDO_DEFAULT_PRIVACY=internal`. Sensitive-
  tier work can only hit local-locality models, even on Fly.io. (You'd
  need a local-model backend reachable from Fly — out of scope for free
  tier; do sensitive work locally with `aldo run --provider ollama`.)

## What this deployment does NOT support yet

- Authentication (no Clerk/Supabase wiring; the API is open).
- Multi-tenant isolation (single-tenant only).
- Replay debugger UI (wave 5).
- Real PR-preview environments for the API (Vercel PR previews work;
  Fly per-PR machines need additional CD).
- GPU workloads.

Everything above is fine for a public demo and design-partner trials.
For production tenants, see the (forthcoming) `docs/deploy/production.md`.
