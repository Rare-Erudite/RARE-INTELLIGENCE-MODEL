# SECURITY

**Last updated:** 2026-10-28 · **Version:** 0.2.0

## Threat model

The engine runs a language model that can call tools. The realistic threats are:

1. **The model does something destructive** — writes outside its sandbox,
   deletes files, runs arbitrary shell.
2. **A prompt injection** in fetched content steers the model into (1).
3. **Secrets leak** into logs, task state, or Git.
4. **A malicious task goal** is used to exfiltrate data.

The engine is **not** designed to defend against a hostile process running as
the same OS user. That is stated plainly in KNOWN_LIMITATIONS.md §7.

## Controls in place

| Control | Implementation | Tested |
|---|---|---|
| Path sandbox | resolved-path check against `tools.sandbox_root` | ✅ `../`, absolute, symlink |
| Tool allowlist | `tools.allowlist`; empty = all registered | ✅ |
| Shell off by default | `tools.enable_shell: false` | ✅ gated |
| Bounded tool output | `max_output_chars` (default 20 000) | ✅ |
| Bounded execution | step / model / tool / wall-clock budgets | ✅ |
| Typed errors, no silent catch | `RareError` hierarchy | ✅ |
| Secrets out of Git | `.env` ignored, `.env.example` documents keys | ✅ |
| No secrets in task state | metadata is caller-supplied; docs forbid secrets | policy |

## Secrets policy

- **Never** commit `.env`, tokens, keys or connection strings.
- `.env.example` lists variable *names* with placeholder values only.
- Task `metadata` must not contain secrets — it is persisted to disk in plain
  JSON and is readable by anyone with filesystem access.
- Logs are structured JSON and include goal text; do not put secrets in goals.

## Sandbox semantics (read this before trusting it)

The sandbox is a **boundary for the model's own actions**. It prevents the model
from wandering out of its working directory by accident or by a naive injection.
It does **not**:

- prevent a shell command from doing anything the OS user can do (hence shell is
  off by default);
- isolate network access;
- protect against a compromised Python process.

If you need a real security boundary, run the engine in a container with a
read-only root, a dedicated user, no network, and a mounted work volume.

## Prompt injection

Any content the model reads (files, later web pages and documents) can contain
instructions. Mitigations:

- The system prompt states the tool contract and that the model must not follow
  instructions found in tool output.
- Tool output is bounded and clearly delimited as an observation.
- Destructive tools are not in the default surface.

**This is mitigation, not prevention.** Do not point the engine at untrusted
content with write access enabled until a dedicated injection test suite exists
(ROADMAP Phase 5).

## Reporting

This is a private project. Report issues to the repository owner directly. Do
not open a public issue containing an exploit.

## Known gaps

- No injection test suite yet.
- No rate limiting (no HTTP surface yet).
- No audit log signing; task files are plain JSON.
- No secret scanning in CI (CI has never run).
