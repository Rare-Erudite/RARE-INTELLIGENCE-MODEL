# KNOWN_LIMITATIONS

**Last updated:** 2026-10-28 · **Version:** 0.2.0

Every limitation below is real and observed. None is hypothetical, and none is
hidden in a footnote elsewhere. If a limitation is fixed, it moves to CHANGELOG.

---

## 1. Hardware: 1 CPU, 2 GiB RAM, 4 GB disk, no GPU

Measured on the build host:

```
$ cat /sys/fs/cgroup/cpu.max
100000 100000          # 1.0 core, despite 48 visible
$ cat /sys/fs/cgroup/memory.max
2147483648             # 2 GiB
$ df -h /workspace
overlay  4.0G
$ nvidia-smi
not found
```

**Consequences:**

- Measured throughput is **~0.08 tok/s**. A 40-token reply takes ~470 s.
- Only 0.6B–1.7B models fit. A 4B Q4 model needs ~2.5 GB of weights and cannot
  be resident in 2 GiB.
- The real-model test suite takes 15m39s.
- The evaluation suite has **never been run against a real model** — 25 tasks
  would take many hours.

This is a host limit, not an engine defect. The engine is correct at 0.08 tok/s;
it is simply not interactive.

## 2. A timed-out generation cannot be interrupted

`asyncio.wait_for` releases the coroutine, but the llama.cpp C call keeps
generating in its worker thread until it finishes its token loop. The engine
reports the timeout correctly; the CPU keeps burning in the background.

**Impact:** on a slow host, a timed-out step still costs wall-clock time.
**Not fixed because:** interrupting inside the C call needs a llama.cpp API that
llama-cpp-python 0.3.36 does not expose.

## 3. The OpenAI-compatible adapter has never been called live

It is unit-tested for request/response shaping only. No endpoint or key was
available. **This is the largest untested claim in the project** — the
"model-agnostic" property is designed and unit-tested, but not demonstrated
end to end.

**Fix:** set `RARE_OPENAI_BASE_URL` + `RARE_OPENAI_API_KEY`, or run a local
vLLM/Ollama server.

## 4. The `research` eval suite is gameable

Echo scores **5/5** on `research` because the answer appears in the prompt, so a
component that merely echoes passes. It measures extraction, not retrieval.

**Impact:** research scores must not be read as retrieval capability.
**Fix:** a retrieval suite where the answer is *not* in the prompt (ROADMAP
Phase 4).

## 5. No streaming

`generate` is request/response only. On a slow host this means no partial output
and no early cancellation.

## 6. Single writer per task

JSON files, not SQLite. Two processes writing the same task would race. The
atomic write prevents corruption of a single writer's file, not concurrent
writers.

**Fix:** the SQLite backend in ROADMAP.

## 7. The sandbox is not a security sandbox

It blocks `../` traversal, absolute paths outside the root, and symlink escapes
— all tested. It is a boundary for **the model's own actions**, not a defence
against a hostile process running as the same user. The shell tool is off by
default for this reason.

## 8. CI has never executed

`.github/workflows/ci.yml` is written and lint-verified locally, but there is no
remote, so it has never run on GitHub. Its correctness is asserted by reading,
not by a green check.

## 9. A 0.6B model cannot reliably do multi-step tool use

The default local model is a smoke test. It proves the loop works; it does not
prove the engine is capable. Expect the repair loop to do most of the work, and
expect `tool_use` and `completion` eval scores near zero.

## 10. No concurrency, no queue, no scheduler

One task at a time per process. There is no task queue, no worker pool and no
scheduling. `rare run` blocks until the task reaches a terminal state.

## 11. Not integrated with the existing application

`Rare-Erudite/COMPLETED` is untouched. `INTEGRATION_CONTRACT.md` describes a
future integration; it is not applied and requires explicit authorization.
