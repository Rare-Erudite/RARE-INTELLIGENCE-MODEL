# MODEL_REGISTRY

**Last updated:** 2026-10-28
**Status:** selection made and justified; one model verified running, others are
*planned* and explicitly marked as not downloaded.

> **Rule for this file:** a model is listed as `verified` only if this repository
> has actually loaded it and generated tokens from it. Everything else is
> `candidate` (researched, not run) or `planned`. No benchmark number appears
> here unless it is either (a) measured by this repo and recorded in
> TEST_REPORT.md, or (b) quoted from the vendor's own publication with the
> source named.

---

## 1. The hardware envelope (measured, not assumed)

Measured on the build host on 2026-10-28:

| Resource | Value | Command |
|---|---|---|
| CPU | AMD EPYC 9254, 48 visible cores | `nproc`, `/proc/cpuinfo` |
| **CPU quota** | **1.0 core** (`100000 100000`) | `cat /sys/fs/cgroup/cpu.max` |
| **RAM limit** | **2 GiB** (`2147483648`) | `cat /sys/fs/cgroup/memory.max` |
| **Disk** | **4.0 GB** overlay, ~4.0 GB free | `df -h /workspace` |
| GPU | none (`no nvidia-smi`, no `/dev/nvidia*`) | — |
| Inference runtimes | `llama-cpp-python 0.3.36` only | `python3 -c "import llama_cpp"` |
| Absent runtimes | no `torch`, no `transformers`, no `ollama`, no `llama-cli` | — |
| Measured throughput | **~0.08 tok/s** on Qwen3-0.6B Q4_K_M | TEST_REPORT.md |

### What that envelope actually permits

The binding constraint is **2 GiB of RAM**, not disk. A GGUF must be fully
resident to be useful, and llama.cpp needs the weights plus KV cache plus the
Python process.

| Model size (Q4_K_M) | Weights on disk | Fits in 2 GiB with KV cache? |
|---|---|---|
| 0.6B | ~0.40 GB | **Yes**, comfortable |
| 1.7B | ~1.1 GB | Marginal — leaves <0.9 GB for KV cache + Python |
| 4B | ~2.5 GB | **No** — exceeds the RAM limit before KV cache |
| 8B | ~4.9 GB | **No** — also exceeds the 4 GB disk |
| 14B+ | 9 GB+ | **No** |

So on *this* host the practical ceiling is **0.6B–1.7B**. That is a hardware
fact, not a preference. Any claim that this box can run a 7B model would be
false.

---

## 2. Candidate matrix

All licences and context lengths below are from the vendors' own model cards /
technical reports (sources in §5). "Fits here" is computed against §1.

| Model | Params | Context | Licence | Fits this host | Status |
|---|---|---|---|---|---|
| **Qwen3-0.6B** | 0.6B | 32K | Apache-2.0 | ✅ yes | **verified** (loaded, generated) |
| Qwen3-1.7B | 1.7B | 32K | Apache-2.0 | ⚠️ marginal (RAM) | candidate |
| Qwen3-4B-Instruct-2507 | 4B | 128K | Apache-2.0 | ❌ no (RAM) | candidate |
| Qwen3-8B | 8B | 128K | Apache-2.0 | ❌ no (RAM+disk) | candidate |
| Qwen3-30B-A3B (MoE) | 30B total / 3B active | 128K | Apache-2.0 | ❌ no | candidate |
| DeepSeek-R1-Distill-Qwen-1.5B | 1.5B | 32K | MIT (per HF card) | ⚠️ marginal | candidate |
| DeepSeek-R1-Distill-Qwen-7B | 7B | 32K | Apache-2.0 (Qwen2.5 base) | ❌ no | candidate |
| Llama-3.2-1B-Instruct | 1.23B | 128K | Llama 3.2 Community | ⚠️ marginal | candidate |
| Llama-3.2-3B-Instruct | 3.21B | 128K | Llama 3.2 Community | ❌ no | candidate |
| Mistral-7B-Instruct | 7B | 32K | Apache-2.0 | ❌ no | candidate |

### Licence notes that matter for a product

- **Qwen3 family: Apache-2.0** across all sizes, including 0.6B → 235B. Cleanest
  option for commercial use; no MAU clause, no acceptable-use addendum.
- **Llama 3.2: custom Community Licence**, not OSI-approved. Includes a
  700M-monthly-active-user clause requiring a separate grant from Meta, plus an
  Acceptable Use Policy. Usable, but it is a legal review item, not a
  drop-in.
- **DeepSeek-R1 distills inherit their base licence.** The Qwen-based distills
  are Apache-2.0 (Qwen2.5 base); the Llama-based ones carry the Llama licence.
  The 1.5B card is reported as MIT — verify against the actual card before
  shipping, since secondary sources disagree.

---

## 3. Selection

### Selected for this host: `qwen3-0.6b-instruct-q4km`

**Verified.** Loaded and generated through `LlamaCppAdapter`; see
TEST_REPORT.md → "Real-model suite".

Why:

1. **It is the only size that fits 2 GiB with real headroom.** 0.40 GB of
   weights leaves ~1.6 GB for KV cache, Python and the task store.
2. **Apache-2.0** — no licence review needed to ship.
3. **32K context** is far more than the engine uses (4096 configured), so
   context is not the limit; RAM is.
4. **It is a smoke-test model, not the intelligence target.** Its job is to
   prove the whole loop works end to end on real weights. A 0.6B model will
   not reliably do multi-step tool use, and this repo does not claim it does.

### Selected for real work: a remote OpenAI-compatible endpoint

The engine's `openai_compat` adapter is the intended production path. Point
`RARE_OPENAI_BASE_URL` at vLLM / TGI / Ollama / a hosted API and the same
orchestrator runs a 7B–70B model. **This path is unit-tested but has never been
called against a live endpoint** — that is the single largest untested claim in
the project, and it is recorded as such in STATUS.md.

### Recommended upgrade order (when hardware allows)

| Step | Model | Trigger |
|---|---|---|
| 1 | Qwen3-1.7B Q4_K_M | ≥4 GiB RAM |
| 2 | Qwen3-4B-Instruct-2507 Q4_K_M | ≥8 GiB RAM, ≥8 GB disk |
| 3 | Qwen3-8B or DeepSeek-R1-Distill-Qwen-7B | ≥16 GiB RAM or a 12 GB GPU |
| 4 | Qwen3-30B-A3B (MoE, 3B active) | 24 GB GPU — best quality/latency ratio |

Step 2 is the first size where multi-step tool use becomes plausible. Below
4B, expect the orchestrator's repair loop to do most of the work.

---

## 4. Registry entries (machine-readable)

```yaml
models:
  qwen3-0.6b-instruct-q4km:
    status: verified
    params: 0.6B
    quant: Q4_K_M
    bytes: 396705472
    context_window: 32768        # configured to 4096 in engine.yaml
    license: Apache-2.0
    upstream: Qwen/Qwen3-0.6B
    gguf_source: unsloth/Qwen3-0.6B-GGUF
    adapter: llamacpp
    verified_loading: true
    verified_generation: true
    measured_tok_per_s: 0.08     # 1 CPU quota
    role: smoke-test / offline development

  qwen3-1.7b-instruct-q4km:
    status: candidate
    params: 1.7B
    context_window: 32768
    license: Apache-2.0
    upstream: Qwen/Qwen3-1.7B
    adapter: llamacpp
    requires_ram_gib: 4
    role: first upgrade step

  qwen3-4b-instruct-2507-q4km:
    status: candidate
    params: 4B
    context_window: 131072
    license: Apache-2.0
    upstream: Qwen/Qwen3-4B-Instruct-2507
    adapter: llamacpp
    requires_ram_gib: 8
    role: first size where agentic tool use is realistic

  deepseek-r1-distill-qwen-1.5b-q4km:
    status: candidate
    params: 1.5B
    context_window: 32768
    license: MIT (verify on card)
    upstream: deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B
    adapter: llamacpp
    requires_ram_gib: 4
    role: reasoning-heavy alternative at small size

  llama-3.2-1b-instruct-q4km:
    status: candidate
    params: 1.23B
    context_window: 131072
    license: Llama-3.2-Community
    upstream: meta-llama/Llama-3.2-1B-Instruct
    adapter: llamacpp
    requires_ram_gib: 4
    role: alternative; licence review required

  echo:
    status: test-only
    role: deterministic adapter for CI; excluded from all benchmark claims
```

---

## 5. Sources

- Qwen3 release + sizes + Apache-2.0: <https://qwenlm.github.io/blog/qwen3>
- Qwen3 technical report (context lengths, layer counts): <https://arxiv.org/html/2505.09388v1>
- Qwen3-1.7B model card (32K context): <https://huggingface.co/Qwen/Qwen3-1.7B>
- Qwen3-4B-Instruct-2507 model card (benchmarks, Apache-2.0): <https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507>
- DeepSeek-R1 distills (base models, licences): <https://github.com/deepseek-ai/deepseek-r1>
- DeepSeek-R1-Distill-Qwen-7B card: <https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B>
- Llama 3.2 Community Licence (700M MAU clause): <https://dev.meta.ai/llama/llama3_2/license>
- Llama 3.2 3B card: <https://huggingface.co/meta-llama/Llama-3.2-3B>

Vendor-published benchmark figures are **not** reproduced here as this
project's results. Where a comparison is needed, see COMPETITIVE_BENCHMARKS.md,
which labels every number as `vendor-published` or `measured-here`.
