# Sandboxing tool execution — landscape & v0.1 plan

Scope: isolating agent tool calls (shell, code interpreter, browser,
untrusted MCP servers) across local dev, self-hosted, and cloud.

## Comparison

| Option | Isolation | Cold start | GPU passthrough | Snapshot/fork | License | Fit |
|---|---|---|---|---|---|---|
| **Docker (rootless)** | Namespaces + cgroups, shared kernel; user-NS helps but kernel surface is huge. | 200–800 ms | Yes (NVIDIA toolkit) | `docker commit`; CRIU experimental | Apache-2.0 | Dev default; unsafe alone for untrusted code. |
| **Podman** | Same primitives; daemonless, rootless by default. | 200–800 ms | Yes | CRIU built-in | Apache-2.0 | Drop-in Docker; better local-dev ergonomics. |
| **gVisor (runsc)** | User-space kernel intercepts syscalls; defence-in-depth without VM cost. | ~150 ms | Partial CUDA | Checkpoint/restore | Apache-2.0 | Strong for shell/code-interp; perf hit on heavy syscalls. |
| **Firecracker** | KVM microVM, minimal device model. | 100–250 ms | None (no PCI passthrough) | First-class snapshot/restore <100 ms | Apache-2.0 | Gold standard for cloud-side tool execution. |
| **Kata** | QEMU/Cloud-Hypervisor microVM, OCI-compatible. | 500 ms–2 s | Yes (vfio) | Yes | Apache-2.0 | VM isolation + GPU + k8s. |
| **nsjail / bubblewrap** | Namespaces + seccomp-bpf, no daemon. | <50 ms | Host GPU | None | Apache-2.0 / LGPL | Fast wrapper for trusted binaries only. |
| **WASM/WASI (wasmtime)** | Capability-based; no syscalls unless granted. | <10 ms | WASI-NN, limited | wizer pre-init; fork-cheap | Apache-2.0 | Best for pure compute; ecosystem thin (no full Python). |
| **V8 isolates / Deno** | In-process JS isolates; perm flags gate FS/net. Shared process. | ~5 ms | None | V8 startup snapshots; no live fork | MIT | JS/TS only; fine for declarative tools, not arbitrary code. |
| **E2B** | Managed Firecracker microVMs. | ~150 ms | Beta | Pause/resume API | Apache-2.0 SDK, hosted | Easiest cloud code-interpreter; vendor risk. |
| **Daytona** | Dev-container/VM workspaces, OSS control plane. | seconds | Yes | Workspace snapshots | AGPL/Apache mix | Long-lived dev envs; heavy per-tool-call. |
| **Modal** | gVisor + Firecracker hybrid. | 1–4 s, sub-s warm | Yes (A100/H100) | Memory checkpointing | Proprietary | Best for GPU ephemeral jobs; closed. |
| **Cloudflare Sandbox / Containers** | Workers isolates + DO-bound Linux containers. | ms (isolate) / s (container) | No | DO state; no live fork | Proprietary | Edge tier; opaque internals. |

## Tiered recommendation

We split workloads into three tiers; the gateway tags each tool call with a
tier, and the executor picks the runtime.

- **T1 — short-lived pure compute** (math, JSON munging, regex, embeddings
  pre-proc, deterministic transforms). **WASM (wasmtime)** in-process when
  the tool is authored as a component; fall back to **nsjail+seccomp** for
  trusted native binaries. Sub-10 ms overhead, no kernel exposure.

- **T2 — shell / code-interpreter / browser / file IO**. **Firecracker
  microVM** with a thin guest (Alpine + agent-runtime). gVisor is the
  acceptable substitute when KVM isn't available (e.g. nested cloud).
  Per-call cold start budget: 250 ms; we keep a warm pool.

- **T3 — untrusted third-party MCP servers / arbitrary user containers**.
  **Kata** (or Firecracker-backed Kata) so we get OCI compatibility plus VM
  isolation. Network egress default-deny. No host-mounted secrets, ever.

GPU jobs (vision, local-model tool fine-tunes) bypass T1/T2 and run on
**Kata + vfio** or **Modal** in cloud mode, gated by `privacy_tier`.

## Network policy

Three-layer model, picked per tier:

- **CNI + NetworkPolicy** (Cilium) is the substrate for the cluster — gives
  us identity-aware default-deny between pods.
- **eBPF (Cilium / Tetragon)** does L7 filtering and observability:
  per-syscall + per-flow audit, DNS allowlists, egress shaping. This is
  how we enforce "agent X may only reach `api.github.com`".
- **Egress proxy (mitmproxy-style or Squid + auth)** for cloud LLM /
  model-gateway traffic so we can log, redact, and stamp every request
  with the agent run-id. T3 workloads are *required* to go through it;
  direct internet is blocked at the CNI layer.

Local dev uses a single eBPF policy bundle plus a loopback proxy — no CNI.

## Snapshot + fork story (replay)

Replay needs cheap fork from an arbitrary checkpoint so we can re-run a
single tool call with a different model.

- **Firecracker** — best fit: snapshot (memory + device state) is a few
  hundred ms, restore <100 ms, and we can fan out N forks from one snapshot
  (copy-on-write memory via UFFD).
- **gVisor** — checkpoint/restore works, slower, no fan-out.
- **Kata** (Cloud-Hypervisor backend) — snapshot is fine, fork-from-snapshot
  is supported but heavier than FC.
- **WASM (wizer + component model)** — pre-initialised snapshots are
  trivially forkable; ideal for T1 replay.
- **Podman/Docker (CRIU)** — works but flaky on modern kernels; do not
  rely on for replay.
- **E2B / Modal** — vendor APIs expose pause/resume; usable but locks us
  in.

Decision: replay store keys a `(snapshot-id, tool-call-id)` tuple. T1 →
WASM snapshot. T2/T3 → Firecracker snapshot. Anything else degrades to
"re-execute from inputs" replay.

## Local dev story (`aldo dev`)

No Kubernetes. The CLI brings up:

1. A **Podman** rootless machine (Linux native, `podman machine` on macOS,
   WSL2 on Windows) as the OCI runtime.
2. A **wasmtime** binary in `$PATH` for T1 tools.
3. A local **Firecracker** jailer when `--vm` is requested and KVM is
   present; otherwise we transparently fall back to gVisor or plain
   Podman with a loud warning that isolation is degraded.
4. A loopback **egress proxy** the gateway points at by default.
5. The model gateway, eval harness, and replay store all run as plain
   Podman containers wired through a single compose file.

Goal: `aldo dev up` on a fresh laptop in <60 s, no root, no daemon.

## v0.1 stack (exact)

**Podman (rootless) as the OCI runtime everywhere; wasmtime for T1
compute tools; Firecracker (via `firecracker-containerd`) for T2 shell /
code-interpreter / browser tools, with gVisor as the no-KVM fallback;
Kata Containers for T3 untrusted MCP servers and GPU jobs (vfio
passthrough); Cilium CNI + Tetragon for eBPF-enforced default-deny
networking; a single egress proxy (mitmproxy-based) stamps every
outbound LLM/tool call with the run-id; snapshot/replay uses
Firecracker UFFD snapshots for VMs and wizer pre-init for WASM, keyed
in the replay store. Cloud burst tier is E2B (T2) and Modal (GPU);
both behind the gateway so swapping them is config.**

## Open questions

1. Do we ship our own Firecracker guest image, or adopt Kata's rootfs
   and slim it? Affects boot time and CVE surface.
2. gVisor's CUDA support — mature enough by 0.2 to retire Kata for
   single-GPU T3 jobs?
3. WASM Python (componentized CPython / RustPython / Pyodide) — usable
   as a real T1 code-interpreter, or do we always escalate Python to
   T2?
4. Where does the egress proxy terminate TLS for local-model traffic
   (Ollama, vLLM)? mTLS to in-cluster endpoints feels mandatory but
   complicates `aldo dev`.
5. Replay fan-out cost: how many concurrent FC forks per host before
   memory dedup (KSM/UFFD) stops paying off?
6. Do we expose Cloudflare Sandbox as an edge tier for ultra-low-latency
   tool calls, or is the proprietary lock-in incompatible with
   constraint #1 (LLM/runtime-agnostic)?

Status: proposed
