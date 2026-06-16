# Literature map — Grafting sparse FF into a pretrained LLM (verified)

**Provenance:** deep-research run `w7u8nbu3q` (2026-06-16) — 6 search angles, 9 primary
sources fetched, 45 claims extracted, **25 adversarially verified (3-vote): 18 confirmed,
7 killed**. 14 additional source fetches failed to transient API rate-limiting, so coverage
of **PKM/memory-layers and FFF is thin** (flagged throughout). Claims below carry their
vote (e.g. `3-0`). This file supersedes the `[verify]`-tagged citations in `FEASIBILITY.md`.

> **How to read:** ✅ = verified-confirmed · ❌ = verified-**refuted** (kept on purpose — these
> are the over-claims the evidence does *not* support) · ⚠️ = not covered / unverified here.

---

## Verdict (evidence-backed)

**Graft, don't build from scratch — confirmed**, but with two sharp qualifications the bare
idea hides:
1. The cheapest, most domain-addressable-friendly entry is **MoEfication-style FFN
   *partitioning*** (disjoint experts), not cloned-FFN upcycling.
2. **Naive cloned-FFN upcycling actively *suppresses* the topic specialization you want**
   (§3) — the single most important finding for this project.

---

## §1 — Prior art on grafting (the core question) ✅

Three established mechanisms convert a **pretrained dense** checkpoint's FFN sublayers into a
sparse MoE **without scratch pretraining**. Two distinct init families:

| method | init family | recovery | cite |
|---|---|---|---|
| **Sparse Upcycling** | **duplicate** FFN → N identical experts + random router, continue pretraining | +10–60% of one dense pretrain run (T5-Large 46%, T5-Base 55%) | Komatsuzaki et al., **ICLR 2023**, `arXiv:2212.05055` ✅3-0 |
| **MoEfication** | **partition** FFN neurons → disjoint experts, **train only routers** | **>95%** of dense quality activating **10–30%** of FFN params; router fit ~**minutes/GPU** | Zhang et al., **ACL Findings 2022**, `arXiv:2110.01786` ✅3-0 |
| **LLaMA-MoE** | **partition** LLaMA-2-7B FFNs → experts, continual pretrain | 200B tokens → 3.5B-active model **beats** dense models of similar active-param count | Zhu et al., **EMNLP 2024**, `arXiv:2406.16554` ✅3-0 |

- **Recovery is cheap at small scale** ✅3-0: MoEfication's >95% band is for **ReLU T5**;
  **BERT (GeLU) needed 30–40%** of neurons **plus a GeLU→ReLU adaptation step**, and harder
  tasks (RACE) recover worse. *Gemma uses GeGLU — expect the BERT-like, not the T5-best, case.*
- **Graft can beat dense per active-FLOP** ✅3-0, but margins are modest: LLaMA-MoE-3.5B 57.7
  avg vs Sheared-LLaMA-2.7B 56.4 (**~1.2 pt**), MMLU near-random (~26.8) for all, and it used
  ~4× the tokens of the baseline (not compute-matched). Keep expectations sober.

**⚠️ PKM / Memory Layers and FFF — NOT covered by any surviving claim.** No verified evidence
that a Product-Key Memory layer (Lample et al. 2019) or a Fast Feedforward Network
(Belcak & Wattenhofer 2023) / UltraFastBERT has been **grafted into a pretrained dense LM and
recovered**. The rate-limited fetches hit exactly these. **This is the cleanest open gap**
(§8) — and PKM's literal key→value lookup matches the "indexed like a lookup table" goal far
more directly than soft MoE routing. *From-memory IDs to confirm independently before citing:
PKM `arXiv:1907.05242`; Memory Layers at Scale `~arXiv:2412.09764`; FFF `arXiv:2308.14711`;
UltraFastBERT `arXiv:2311.10770` — UNVERIFIED.*

## §2 — Grafting recipe / best practices

- **Warm-start from the original FFN** is the whole premise of all three methods above ✅ (each
  expert is a copy or a partition of the trained FFN — never random).
- **⚠️ The KD framing is an EXTENSION, not prior art.** *None* of the verified grafting work
  recovers via true teacher–student **knowledge distillation** — they use **continued
  next-token pretraining** (MoEfication: just router-fitting). The "recover via layerwise
  hidden-state / logit-KL distillation" recipe (TinyBERT/MiniLM-style) is **unattested here**
  → it is part of the novelty, not a solved step (§8).
- **⚠️ Attention freeze vs LoRA-adapt, router load-balancing details** — not isolated by any
  surviving claim. Treat the §5 recipe in `FEASIBILITY.md` as informed design, not cited fact.

## §3 — Topic/domain addressability ⭐ (the critical finding)

**Cloned-FFN upcycling fails to specialize by domain** ✅3-0 — this is the central tension
between *cheap grafting* and *topic-addressable parameters*:

- **OLMoE** (Muennighoff et al., **ICLR 2025**, `arXiv:2409.02060`), §4.1.5/§5.3: *"Experts in
  Mixtral are activated close to the uniform routing baseline for all layers and domains"*;
  *"initialization from a dense model may limit the amount of possible specialization… they all
  start from the same local optimum. This is likely why training from scratch eventually
  outperforms upcycling."*
- **Drop-Upcycling** (`arXiv:2502.19261`): cloned-FFN init *"leads to weight homogeneity,
  impeding the router's ability to differentiate experts."* **Mitigable** — Drop-Upcycling and
  cluster-aware/partial-reinit recover specialization, so the constraint is **not absolute**.
- **❌ REFUTED 0-3:** the clean *"from-scratch OLMoE shows ~100% domain specialization (arXiv
  tokens → expert-0)"* story. From-scratch specialization is **real but partial/graded**, **not**
  clean topic-addressability. **Do not expect a one-expert-per-topic lookup table to fall out.**
- **In the decoder-only regime you target, upcycling's advantage shrinks** ✅3-0: for an
  (overtrained) OLMo-1B, a from-scratch MoE catches up at **~500B tokens (25% of dense budget)**
  and overtakes by ~600B — vs the 120% Komatsuzaki reported for encoder-decoder/expert-choice.
  (❌ matched-budget upcycling-superiority refuted 1-2.)

**Implication:** if topic-addressability is the *goal*, naive MoE-upcycling is the **wrong**
mechanism. The evidence points to either (a) **PKM/memory-layers** (literal addressable
lookup — but graft-recovery unverified, §8) or (b) **engineered** addressability:
domain-partitioned / cluster-aware expert init (Branch-Train-Merge / BTX / c-BTM family —
**⚠️ named in the query but produced no surviving verified claims here**, confirm separately).

## §4 — Quantization interaction (the thesis bridge) ✅

**MoE / sparsely-activated weights are generally *more* robust to low-bit weight quantization
than dense FFNs** — a genuine bridge to the information-preserving-quantization thesis:

- **MoQE** (Kim, Fahim, Awadalla, **EMNLP Findings 2023**, `arXiv:2310.02410`) ✅3-0: *"expert
  layers… are much more robust to quantization than conventional FFN layers."* Head-to-head, no
  QAT: **2-bit dense FFN collapses (~−91% BLEU)** vs **2-bit MoE experts ~−12%**; 3-bit dense
  −9…−11% vs MoE ~−1%. 3-bit experts need **no training**; 2-bit needs QAT. 4-bit weight-only
  still **beats** the FLOPs-equivalent dense fp16 (+2.11% BLEU, ~68% memory cut, 1.24× speedup).
- **QMoE** (Frantar & Alistarh, **MLSys 2024**, `arXiv:2310.16795`) ✅3-0: 1.6T-param
  SwitchTransformer → **0.8 bits/param (20×)**, retraining-free GPTQ-style, **<1 day on one GPU**.
- **Robustness is NON-uniform** ✅3-0 — **shared/always-on experts + routers are fragile**:
  - **QuantMoE-Bench** (Li et al., `arXiv:2406.08155`): *shared experts need 4-bit vs 2-bit for
    token-conditioned experts; earlier MoE layers demand higher precision.*
  - **EAQuant** (Fu et al., `arXiv:2506.13329`): adds **routing-consistency alignment** (KL
    between fp/quant routing probs) because tiny router-logit errors **flip top-k selection**;
    reaches W4A4/W3A4/W2A4 (OLMoE W4A4 68.06% vs FP16 70.28%).
- **❌ REFUTED over-claims** (calibration): "experts fine at 2-bit while everything else breaks"
  (1-2); "dense bottoms out at 3-4 bit while MoE tolerates sub-1-bit" (0-3); "off-the-shelf PTQ
  *fails* on MoE" (0-3). Reality = **component-specific** robustness, not a blanket sparse-wins.

**⚠️ Scope:** nearly all the strongest quant numbers are **encoder-decoder MT on BLEU**, not
decoder-only ~4B LLMs. Treat extrapolation to a Gemma-4 graft as **plausible-but-unverified** —
which is precisely why "does this hold at decoder-only 4B?" is a real research question (§8).

## §5 — Interpretability tooling ⚠️ / empirically settled by us

Not covered by any surviving lit claim — **but independently verified locally** for Experiment 1:
`transformers==4.51.3` registers **`OlmoeForCausalLM`** and its `forward` accepts
**`output_router_logits=True`** (checked directly). `allenai/OLMoE-1B-7B-0924` = 64 experts,
top-8, built for routing analysis → the right probe target. Mixtral/Qwen-MoE expose the same
flag. See `experiments/`.

## §6 — What was REFUTED (read for calibration)

7 claims killed by 3-vote verification — the seductive over-statements to avoid in the paper:
1. ❌ Upcycling beats from-scratch at matched 100% dense budget (1-2).
2. ❌ from-scratch OLMoE ≈100% domain-specialized (0-3) — it's partial/graded.
3. ❌ MoE experts fine at 2-bit while other components break (1-2).
4. ❌ MoE within −0.3 BLEU @3-bit / −1.82 @2-bit as a general law (1-2).
5. ❌ Dense floor 3-4 bit vs MoE sub-1-bit as a clean gap (0-3).
6. ❌ Fine-grained mixed-precision uniformly beats GPTQ (1-2).
7. ❌ Off-the-shelf PTQ *fails* on MoE (0-3).

## §7 — Scope caveats (apply across the report)

1. **KD ≠ what was studied.** All grafting prior art uses continued pretraining / router-fit,
   **not** teacher-student KD. The KD-recovery axis is unproven → novelty, not foundation.
2. **Architecture/task scope.** Strongest evidence = T5/ViT (upcycling) and encoder-decoder MT
   (quantization). Decoder-only ~4B evidence is thin and, where it exists (OLMoE), *weakens*
   upcycling's advantage.
3. **PKM/Memory-Layers and FFF graft-recovery: no verified evidence here** (rate-limited).
4. **Branch-Train-Merge / BTX / c-BTM: no surviving verified claims** — confirm separately.
5. **Domain-addressability is the weakest leg** of the whole premise — see §3.
6. **Quant SOTA (EAQuant, Drop-Upcycling, DeepSeek-V4-Flash) is 2025-26 and moving fast** —
   numbers will date.

## §8 — Open gaps = candidate novelty (verbatim from the run + sharpened)

1. **PKM / Memory-Layer or FFF graft + cheap recovery** — *unverified anywhere*; memory layers
   give **literal key-addressable lookup**, matching the "indexed like a lookup table" goal far
   better than soft MoE. **Cleanest + most novel gap.**
2. **True KD-recovery (layerwise feature/logit-KL) vs plain continued-pretraining** for FFN-swap
   on a **decoder-only** LLM, single-4090 budget — entire axis lacks prior art.
3. **Engineered domain-addressability** — partition/init experts by **pre-clustered domain
   corpora** (cluster-aware upcycling / BTM-style) so routing keys are *explicitly* topic-indexed,
   overcoming uniform-routing collapse (§3).
4. **Quant × graft at the target** ⭐ *thesis-aligned* — graft + recover an MoE/memory-layer from
   Gemma-4 E4B, **then 4-bit quantize**: do MoQE/QMoE expert-robustness results hold at
   decoder-only ~4B, and does **routing-consistency degradation (EAQuant) become the binding
   constraint on domain-addressability after quantization**? This is the slice that is *both*
   novel *and* continuous with the quantization thesis.

## Sources (all primary / arXiv)

| id | paper | role |
|---|---|---|
| `2212.05055` | Sparse Upcycling (ICLR 2023) | graft prior art |
| `2110.01786` | MoEfication (ACL Findings 2022) | graft prior art (cheapest) |
| `2406.16554` | LLaMA-MoE (EMNLP 2024) | decoder-only graft |
| `2409.02060` | OLMoE (ICLR 2025) | specialization + upcycling-vs-scratch + probe target |
| `2502.19261` | Drop-Upcycling | specialization fix |
| `2401.04088` | Mixtral | routing analysis |
| `2502.03009` | Scaling Laws for Upcycling MoE | catch-up dynamics |
| `2310.02410` | MoQE (EMNLP Findings 2023) | MoE quant robustness |
| `2310.16795` | QMoE (MLSys 2024) | extreme MoE compression |
| `2406.08155` | QuantMoE-Bench | component-specific bits |
| `2506.13329` | EAQuant | routing-consistency under quant |

*Unverified (from memory, confirm before citing): PKM `1907.05242` · Memory Layers at Scale
`~2412.09764` · FFF `2308.14711` · UltraFastBERT `2311.10770`.*
