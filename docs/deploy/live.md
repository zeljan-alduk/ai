# Live deploy — current state

This page tracks the actual production deployment of ALDO AI as it
evolves. It is the source of truth for what is up, what is half-up,
and what still needs a click.

## Status snapshot (2026-04-25)

| Surface | State | URL |
|---|---|---|
| **Neon Postgres** | live, project `aldo-ai` (id `super-wind-07291109`) | `ep-tiny-sea-aei2ge4e-pooler.c-2.us-east-2.aws.neon.tech` |
| **Fly.io API** | app created, secrets staged, image **not yet built** | `https://aldo-ai-api.fly.dev` (will return ENOENT until first deploy) |
| **Vercel web** | project created, `NEXT_PUBLIC_API_BASE` env set, **no successful deployment yet** | `https://aldo-ai-web.vercel.app` (when the first deploy lands) |

## What was provisioned successfully from the sandbox

### Neon — done
- Org `org-holy-feather-65421590`.
- Project `aldo-ai` in region `aws-us-east-2`, Postgres 17, 0.5 GB free
  storage, branch `br-plain-frog-aewv6727`.
- Database `neondb`, role `neondb_owner`.
- Pooled connection string captured. (Stored in the sandbox at
  `/tmp/aldo-deploy/neon.env`; ephemeral. Re-grab from Neon dashboard
  or via the API on next session.)

### Fly.io — app + secrets
- App `aldo-ai-api` created on the personal org.
- Secrets staged (will land on first deploy):
  - `DATABASE_URL` — pooled Neon URL.
  - `CORS_ORIGINS` — `https://aldo-ai.vercel.app,http://localhost:3000`.
- `apps/api/fly.toml` configured: `iad` region, `shared-cpu-1x` 256 MB,
  auto-stop on idle, `/health` check every 30s.

### Vercel — project + env + settings reset
- Project `aldo-ai-web` (id `prj_TgLXaABnCqzVj0zbHt22TkXof57L`) under
  the `zeljanalduk-3047s-projects` team.
- Env var `NEXT_PUBLIC_API_BASE=https://aldo-ai-api.fly.dev` set for
  Production.
- Project settings reset to Vercel defaults (rootDirectory = `apps/web`,
  framework = nextjs, no custom build command). This makes the project
  ready for Vercel's standard Next.js + monorepo flow once the GitHub
  integration is connected.

## What still needs a click (sandbox can't do these)

### 1. Connect Vercel to GitHub (≈ 1 minute)
The Vercel CLI cannot connect to a GitHub repo unless your Vercel
account already has a GitHub login connection. From the sandbox we
got `Failed to link zeljan-alduk/ai. You need to add a Login
Connection to your GitHub account first.`

Click path:
1. <https://vercel.com/account/login-connections> → **GitHub** → Authorise.
2. <https://vercel.com/zeljanalduk-3047s-projects/aldo-ai-web/settings/git>
   → **Connect Git Repository** → choose `zeljan-alduk/ai`, branch
   `main`.
3. Vercel auto-deploys on every push to `main`. The `aldo-ai-web`
   URL becomes live.

After that, deploys are automatic — every push to `main`, every PR
gets a preview URL.

### 2. Build & deploy the Fly image (one of two paths)

The sandbox can't reliably build Docker images for Fly because
Docker Hub auth, npm registry, and Alpine CDN all hit cert-chain or
503 issues from inside the build container. Fly was deployed
**from your laptop** in seconds; alternatively use GitHub Actions.

**Path A — from your laptop (~30 s):**
```bash
brew install flyctl   # or curl -L https://fly.io/install.sh | sh
flyctl auth login     # browser flow
cd <repo>/apps/api
flyctl deploy --app aldo-ai-api --remote-only
```
Visit `https://aldo-ai-api.fly.dev/health` → `{"ok":true,...}`.

**Path B — via GitHub Actions:**
We already shipped `.github/workflows/deploy-api.yml`. To enable:
1. <https://github.com/zeljan-alduk/ai/settings/secrets/actions>
   → **New repository secret** → `FLY_API_TOKEN` = your Fly access
   token (from <https://fly.io/user/personal_access_tokens>).
2. Same page → **Variables** tab → **New variable** →
   `DEPLOY_API_ENABLED` = `true`.
3. Push any commit to `main`, or
   <https://github.com/zeljan-alduk/ai/actions/workflows/deploy-api.yml>
   → **Run workflow**. Builds on a clean Ubuntu runner with no
   network restrictions, deploys to Fly, takes ~3 min.

### 3. (Optional) Update CORS origin once Vercel deploys
The Vercel URL will likely be `aldo-ai-web.vercel.app` (or a hashed
preview-style URL on first deploy). Once it stabilises:
```bash
flyctl secrets set --app aldo-ai-api \
  CORS_ORIGINS="https://aldo-ai-web.vercel.app,https://aldo-ai-web-*-zeljanalduk-3047s-projects.vercel.app,http://localhost:3000"
flyctl deploy --app aldo-ai-api  # to apply the secret change
```

### 4. **Rotate the tokens you shared during deploy**
- Neon API key: <https://console.neon.tech/app/settings/api-keys> → revoke `napi_japjo8...`.
- Fly access token: <https://fly.io/user/personal_access_tokens> →
  delete the deploy token (the one that starts with
  `FlyV1 fm2_lJPECAAAAAAAE6Aq...`).
- Vercel token: <https://vercel.com/account/tokens> → delete
  `vcp_5YAPWVrFux...`.

Future automatic deploys via GitHub Actions don't need the tokens
above — the Action uses its own short-lived `FLY_API_TOKEN` repo
secret.

## Why the sandbox couldn't finish each piece

| Surface | Sandbox blocker | Workaround |
|---|---|---|
| Neon | none — full API access works | n/a, done |
| Fly.io | Docker Hub auth 503 from inside build; npm registry TLS errors; Alpine CDN cert-chain issues | Build elsewhere (laptop or CI runner) |
| Vercel | CLI couldn't connect Git OAuth; tarball upload + monorepo confused Vercel's framework auto-detect with the workspace layout | One-time GitHub OAuth click in the dashboard |

These are sandbox-specific (TLS / network policies); they won't
recur once the deploys run from a real machine or CI runner.

## After everything is up

- Visit `https://aldo-ai-web.vercel.app`. Sidebar → Models. You should
  see ~10 models, with `available: false` on most until you set
  provider keys. (`flyctl secrets set --app aldo-ai-api GROQ_API_KEY=...`
  unlocks Groq's two free-tier Llama models.)
- Visit `https://aldo-ai-api.fly.dev/v1/models` directly to confirm the
  API.
- The runs and agents pages will be empty until you actually run an
  agent (the CLI's `aldo run` writes to the same Neon DB). That's
  wave 5+.
