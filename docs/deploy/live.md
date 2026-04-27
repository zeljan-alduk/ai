# Live deploy — current state

**ALDO AI v0.2 is live end-to-end.** Web app pulls models from the API,
which reads from a Postgres-backed registry. All deploys are
auto-driven from the GitHub repo (Vercel via Git integration; Fly via
GitHub Actions).

## Live URLs (2026-04-25)

| Surface | URL |
|---|---|
| **Web (Vercel)** | <https://aldo-ai-7pogem9sm-zeljanalduk-3047s-projects.vercel.app> |
| Web alias | <https://aldo-ai-web-git-claude-ai-age-c0b147-zeljanalduk-3047s-projects.vercel.app> |
| **API (Fly.io)** | <https://aldo-ai-api.fly.dev> |
| API health | <https://aldo-ai-api.fly.dev/health> |
| API models | <https://aldo-ai-api.fly.dev/v1/models> |
| Postgres (Neon) | `ep-tiny-sea-aei2ge4e-pooler.c-2.us-east-2.aws.neon.tech` (private) |
| Image registry | `registry.fly.io/aldo-ai-api:deployment-...` |

The web URL is a Vercel preview alias — pushes to
`claude/ai-agent-orchestrator-hAmzy` redeploy automatically. To pin a
stable production URL, change the project's production branch to
`claude/ai-agent-orchestrator-hAmzy` (or merge the branch into `main`).

## Stack

```
                         GitHub: zeljan-alduk/ai
                                  │
            push to claude/ai-agent-orchestrator-hAmzy
                                  │
            ┌─────────────────────┼──────────────────────┐
            ▼                     ▼                      ▼
       Vercel git              GitHub Actions       (CodeQL, CLA,
       integration             deploy-api.yml         Dependabot)
            │                     │
       Vercel build              flyctl deploy
       (Next.js + pnpm)          (remote-only)
            │                     │
            ▼                     ▼
       aldo-ai-7pogem9sm        aldo-ai-api.fly.dev
       .vercel.app               (Hono + tsx)
            │                     │
            └────────────fetch────┘
                                  │
                                  ▼
                         Neon Postgres aldo-ai
                          (us-east-2, pgvector)
```

## CD pipeline

1. **Vercel**: Git integration on `zeljan-alduk/ai`. Push to feature
   branch → preview deploy at `aldo-ai-<hash>-zeljanalduk-3047s-projects.vercel.app`.
   `rootDirectory=apps/web`, `framework=nextjs`, all install/build/output
   commands cleared (Vercel auto-detects pnpm + Next.js).
   `NEXT_PUBLIC_API_BASE=https://aldo-ai-api.fly.dev` set for production,
   preview, and development targets. Deployment SSO protection
   disabled so URLs are publicly reachable.
2. **Fly.io**: GitHub Actions workflow `.github/workflows/deploy-api.yml`,
   triggered on push to main matching `apps/api/**` paths or via
   `workflow_dispatch`. Uses `FLY_API_TOKEN` repo secret + the
   `DEPLOY_API_ENABLED=true` repo variable as a safety gate.
   `flyctl deploy --remote-only` builds the image on Fly's depot
   builder and deploys to the `aldo-ai-api` app.
3. **Neon**: Postgres connection injected via Fly secret `DATABASE_URL`
   (pooled URL). On boot the API runs migrations against the database
   via the `@aldo-ai/storage` migrate runner.

## Recovery loop (already proven 4 times during this deploy)

When CI or Deploy fails:

1. Fetch the failing run's logs via the GitHub API (CI: `actions/jobs/<id>/logs`,
   Fly: `flyctl logs --app aldo-ai-api --no-tail`).
2. Identify the root cause (build context, runtime crash, registry
   crash, dependency missing, env var missing).
3. Apply a one-line fix in the repo. Avoid blanket workarounds; trace
   the bug to its actual source.
4. `git push origin <branch>` — auto-triggers CI. For Fly, also
   `workflow_dispatch` via the API so we don't wait for a paths-match.
5. Monitor via the deployments / runs API; iterate.

The four real bugs we fixed this session:

1. **Workflow build context**: deploy-api.yml ran `flyctl deploy` from
   `apps/api/` so the multi-stage Dockerfile couldn't COPY the
   monorepo. Fixed by running from repo root with explicit
   `--config apps/api/fly.toml --dockerfile apps/api/Dockerfile`.
2. **TypeScript at runtime**: workspace packages export
   `main: ./src/index.ts`; Node can't load TS. Switched the API
   container to run under `tsx` (a runtime dep) so all workspace TS
   imports resolve transparently.
3. **Neon SQL signature**: `@neondatabase/serverless@1.1.0` reserves
   the bare `sql(...)` callable for tagged-template form only.
   Updated `platform/storage/src/pool.ts` to use `sql.query(...)` for
   positional parameters.
4. **Missing fixture**: `/v1/models` reads
   `platform/gateway/fixtures/models.yaml` directly. The image only
   COPYed the api's declared workspace deps; gateway wasn't one.
   Added `COPY platform/gateway ./platform/gateway` to the Dockerfile.

## Next steps for the user

1. **Rotate the four tokens shared during this deploy**: Neon API key
   (`napi_...`), Fly access token (`FlyV1 fm2_...`), Vercel token
   (`vcp_...`), GitHub fine-grained PAT (`github_pat_...`). All four
   landed in chat history and should be revoked now that the deploy
   is in place. The CI workflow uses the `FLY_API_TOKEN` repo secret
   so future deploys keep working without these tokens.
2. **(Optional) Promote feature branch to production**: change the
   Vercel project's production branch to
   `claude/ai-agent-orchestrator-hAmzy`, or merge PR #1 into `main`.
   This pins a stable `aldo-ai-web.vercel.app` URL.
3. **(Optional) Set provider keys on Fly**: `flyctl secrets set
   --app aldo-ai-api GROQ_API_KEY=... GEMINI_API_KEY=...` flips the
   `available` flag on those models in `/v1/models`.
4. **Tighten the API's CORS** to match the actual Vercel preview URL
   pattern (currently allows `https://aldo-ai.vercel.app` +
   `http://localhost:3000`).

## What's NOT yet wired

- `/v1/runs` is empty because no real agent runs have been recorded
  yet — the CLI's `aldo run` writes to local registry only; wiring
  it to Postgres is a wave 5 task.
- Replay debugger UI (wave 5).
- Auth on the web (any visitor reaches the dashboard right now).
- Multi-tenant scoping (single-tenant only).
- Provider-key management UI (set them via Fly secrets for now).
