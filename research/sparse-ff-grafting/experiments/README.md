# Experiment 1 — Topic→Expert routing probe

**Goal:** zero-/low-training test of the premise behind "topic-addressable parameters."
In a *trained* MoE, does the router awaken **topic-specialised** experts, or does it route
on surface/positional features? This is the cheapest possible signal on whether the whole
grafting idea (see [`../FEASIBILITY.md`](../FEASIBILITY.md)) is worth real compute.

- **Strong topic specialisation** → zero-training evidence the "lookup-table-of-parameters"
  intuition is real; grafting a sparse-retrieval FFN is worth pursuing.
- **Topic-agnostic routing** → a *learned per-token* router is **not** a topic index. The
  design to pursue instead is **explicit** domain routing (Branch-Train-Mix-style expert
  banks), not "hope the router specialises."

---

## ⚠️ Why this does NOT run against `gemma4:26b-council` today

Three independent blockers — all documented so we don't rediscover them:

1. **Ollama is a black box.** It returns tokens, not router selections. You cannot observe
   expert routing through Ollama. You need the model in HuggingFace `transformers` with the
   MoE layers exposed (`output_router_logits=True`).
2. **`transformers==4.51.3` (the pinned thesis stack) doesn't recognise `gemma4`.** The same
   pin that blocked the Gemma-4 fine-tune blocks loading Gemma-4 26B for probing. (Tracking
   the `gemma4` → newer-transformers upgrade separately; that upgrade unblocks *both* the
   Gemma-4 specialist and this probe.)
3. **The 4090 is busy** with the Mistral v2 run; loading a second model now risks OOM.

→ Validate the premise **and** this harness **now** against a proxy MoE, then re-point
`--model` at Gemma 4 26B once `gemma4` lands in transformers and the GPU is free. The
harness is model-agnostic.

## Recommended proxy: `allenai/OLMoE-1B-7B-0924`

Why this one: fully open, **built for routing analysis**, 16 MoE layers × **64 experts**,
top-8; ~7B total / ~1B active; supported by `transformers` 4.51.3; small enough to run on
CPU or 4-bit-coexist on the GPU. Alternatives the harness also handles: `Qwen/Qwen1.5-MoE-A2.7B`,
`mistralai/Mixtral-8x7B-v0.1` (large).

---

## Run

```bash
# After the Mistral run frees the GPU (4-bit, fast):
cd ~/Council/research/sparse-ff-grafting/experiments
~/Research/council-specialists/.venv/bin/python router_probe.py \
    --model allenai/OLMoE-1B-7B-0924 --load-in-4bit --out runs/olmoe

# OR on CPU while the GPU is busy (slow but safe; ~16 GB RAM in bf16, trim prompts):
~/Research/council-specialists/.venv/bin/python router_probe.py \
    --model allenai/OLMoE-1B-7B-0924 --device cpu --dtype bfloat16 --max-prompts 3 --out runs/olmoe_cpu
```

First run downloads OLMoE (~13 GB). Uses the existing `council-specialists` venv (has
`transformers` + `bitsandbytes`) — no new environment needed.

## Output (`runs/<name>.{json,csv,txt}`)

- **`.txt`** — human summary: mean `NMI(topic;expert)`, mean purity, per-layer table, and
  the top topic-specialised `(layer, expert, topic)` cells.
- **`.json`** — full per-layer `[topic × expert]` count matrices + metrics + metadata.
- **`.csv`** — tidy `(layer, expert, topic, count)` for plotting a heatmap.

## How to read it

| metric | meaning | premise verdict |
|---|---|---|
| **NMI(topic;expert)** | normalised mutual info, [0,1]; how much expert identity determines topic | `<0.05` agnostic · `0.05–0.20` mild · `>0.20` strong |
| **purity** | mean dominant-topic share per expert; 1 = each expert serves one topic | higher = more specialised |

**Caveat baked into the script's own output:** these bands are heuristics. For a defensible
number, run a **shuffled-topic-label control** (same matrices, topics permuted) to get the
null NMI from finite-sample noise, and report the gap. Routing is also known to be more
topic-specialised in **deeper** layers — watch the per-layer table, don't just read the mean.

## Known follow-ups (logged, not yet built)

- Shuffled-label null control + bootstrap CI on NMI.
- Heatmap renderer (`matplotlib` not assumed present; CSV is plot-ready).
- Gate-hook fallback for archs that don't surface `output_router_logits` (OLMoE/Mixtral/
  Qwen-MoE all do, so not needed for the proxies above).
- Re-run against Gemma 4 26B once the `gemma4` transformers upgrade lands.
