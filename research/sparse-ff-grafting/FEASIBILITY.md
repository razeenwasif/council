# Feasibility memo — Grafting sparse / topic-addressable feed-forward layers into a pretrained LLM

**Status:** exploratory (2026-06-16). Design + feasibility analysis.
**Author:** Razeen Wasif · drafted with Claude (Opus 4.8)
**Relation to thesis:** *adjacent, not core.* The thesis is information-preserving
quantization of domain-specialist fine-tunes. This is a **different efficiency axis**
(conditional computation / sparse parameter access). It only earns thesis time if it
bridges back via the **quantization angle** (§7) — otherwise it is a separate paper.

> **Reconciled with the verified lit map ([`LITERATURE.md`](./LITERATURE.md), run `w7u8nbu3q`
> — 18 claims confirmed / 7 refuted).** Citations below are now grounded. The biggest update is
> **§6**: *cloned-FFN upcycling empirically fails to specialize by topic* — a hard, cited
> finding that reshapes the mechanism choice. Where the two files ever disagree, trust
> `LITERATURE.md`. Remaining `⚠️ UNVERIFIED` tags mark genuine evidence gaps (= novelty, §9).

---

## 1. The idea (restated precisely)

> "Awaken only the parameters relevant to a topic — index them and retrieve them like a
> lookup table. Graft this into an existing model (Gemma 4) instead of training from scratch:
> freeze the attention layers, swap the feed-forward layers, recover with knowledge distillation."

The correct name for this family is **conditional computation / sparse parameter access**.
The proposal is **architecture surgery by module replacement + distillation recovery**. Both
halves have real precedent — this is not a from-scratch research bet (see §4).

## 2. Grounding fact (a free first experiment)

The mainstream instantiation of "awaken a relevant parameter subset per input" is
**Mixture-of-Experts**, and **Gemma 4 26B — already in the local Ollama fleet — is itself a
MoE (3.8 B of 26 B active per token).** So the architecture is not hypothetical; an instance
is sitting locally. Before building anything, **probe whether its router specialises by topic**
(Experiment 1, §8). If it does, the premise is evidenced for the cost of an afternoon.

## 3. The three candidate "sparse FF" mechanisms

| mechanism | one-line | granularity | closeness to the "lookup table" mental model | maturity |
|---|---|---|---|---|
| **MoE** (Mixture-of-Experts) | router picks top-k of N expert FFNs | coarse (dozens) | medium | **battle-tested** |
| **PKM / memory layers** (Product-Key Memory) | top-k nearest-neighbour over millions of key→value slots in ~√N time | very fine (millions) | **highest** — literally a differentiable lookup table | revived, less common |
| **FFF** (Fast Feedforward) | FFN → differentiable balanced binary tree; only ~log(N) neurons fire | fine | medium | **least proven at scale** |

Key references (verified — see `LITERATURE.md` §1):
- **MoE grafting (CONFIRMED prior art)** — *Sparse Upcycling* (ICLR 2023, `arXiv:2212.05055` —
  *duplicate* FFN→experts); *MoEfication* (ACL Findings 2022, `arXiv:2110.01786` — *partition*
  FFN→disjoint experts, train only routers, >95% quality); *LLaMA-MoE* (EMNLP 2024,
  `arXiv:2406.16554` — partition LLaMA-2-7B). **All recover via continued pretraining, NOT KD.**
- **PKM** — Lample et al. 2019; *Memory Layers at Scale* (Meta 2024). **⚠️ graft-recovery
  UNVERIFIED** — no surviving evidence anyone grafted these into a pretrained LM and recovered.
  Literal key→value lookup best matches the "lookup table" goal → cleanest novel gap (§9).
- **FFF** — Belcak & Wattenhofer 2023; UltraFastBERT. **⚠️ graft-recovery UNVERIFIED** here.

## 4. Verdict: GRAFT, don't build from scratch

**Graft (confirmed).** From-scratch discards Gemma's pretraining; "reuse the FFN, recover by
continued training" is established (Sparse Upcycling, MoEfication, LLaMA-MoE — `LITERATURE.md`
§1). Three caveats the lit map adds:

- **Partition > duplicate for *our* goal.** MoEfication-style *partitioning* (disjoint experts)
  is the cheapest entry (routers only, ~minutes/GPU) **and** sidesteps the weight-homogeneity
  that cripples specialization in *cloned-FFN* upcycling (§6).
- **GeGLU tax.** The ">95% quality at 10% neurons" result is **ReLU-T5**; GeLU/BERT needed
  30–40% of neurons + a GeLU→ReLU adaptation step. **Gemma is GeGLU** → expect the harder case.
- **KD is the unproven extension.** Prior art recovers via continued pretraining, *not*
  teacher-student KD — your KD-recovery framing is novelty (§9), not a solved step.

**Why the FFN is the right target:** attention mixes information *across tokens*; the FFN/MLP
holds most of the *knowledge* (~2/3 of params) — exactly where this line of work concentrates.

## 5. The recipe — and the four things that make or break it

Proposed: *freeze attention · swap FF · distill*. Sound in outline, with these caveats (these
are the difference between "recovers in days" and "never recovers"):

1. **Warm-start the new FF from the old FFN — never random-init.** Biggest single lever.
   Upcycling works *because* experts start as copies of a competent FFN. A random PKM/FFF
   block is a capacity chasm KD can't cross on a hobby budget. (PKM: init values from
   clustered FFN activations; FFF: init tree leaves from FFN neurons.)
2. **Don't *hard*-freeze attention.** Swapping the FFN shifts the residual-stream
   distribution; attention's statistics — especially **LayerNorms/scales** — must
   re-equilibrate. Freeze the attention *weight matrices* if you like, but let LayerNorms
   train and put a **small LoRA on attention**. Fully-frozen attention is the most common
   reason these recoveries plateau. `[verify intensity]`
3. **Distill hidden states layerwise, not just final logits.** Keeping the backbone aligned
   gives free per-layer correspondence → match hidden states layer-by-layer (TinyBERT /
   MiniLM / DistilBERT style). Far stronger supervision than logit-KL alone, and it's what
   makes frozen-backbone surgery tractable.
4. **Routing is the hard, non-differentiable part.** PKM key selection / FFF tree splits / MoE
   routers all **collapse** (all traffic → a few slots) without **load-balancing aux losses**.
   Budget real debugging time here.

## 6. The honest gap — now EVIDENCE-BACKED, and it's the key result ⭐

"Awaken params for a **topic**" implies a **topic → param-set** index. The lit map turns this
from a caution into a hard, cited finding (`LITERATURE.md` §3):

- **Cloned-FFN upcycling empirically FAILS to specialize by domain** (OLMoE, ICLR 2025,
  `arXiv:2409.02060`): Mixtral routes *near the uniform baseline across all layers and domains*;
  dense-init experts "all start from the same local optimum," which *limits* specialization.
  Drop-Upcycling (`arXiv:2502.19261`) names the cause: cloned-FFN init → weight homogeneity →
  router can't differentiate experts.
- **Even from-scratch MoEs specialize only *partially*** — the clean "one expert per topic"
  claim (arXiv tokens → expert-0) was **refuted 0-3**. There is no free lookup table.

**So the cheapest graft (cloned upcycling) is the WRONG mechanism for *your* goal.** Three
designs actually serve topic-addressability, in increasing novelty:
1. **Partition, don't duplicate** (MoEfication) — disjoint experts dodge weight homogeneity.
2. **Engineer it** — initialize/partition experts from **pre-clustered domain corpora**
   (cluster-aware / Drop-Upcycling / Branch-Train-Mix-style) so routing keys are *explicitly*
   topic-indexed. (BTM/BTX/c-BTM ⚠️ unverified here — confirm.)
3. **PKM / memory-layers** — a literal key→value lookup; closest to the dream; graft-recovery
   unverified anywhere → most novel.

**Experiment 1 measures the *upper bound*** a learned router reaches — it probes *from-scratch*
OLMoE; an *upcycled* Gemma graft would specialize **less**. Read its number as a ceiling.
**Result (OLMoE, 2026-06-16):** topic signal is **real and highly significant** (NMI **+0.042**
over the independence-null, z≈119, p<0.0005, deep-layer-concentrated) but **weak** — only ~4–7%
of the topic↔expert MI ceiling. The ceiling is low; the cheap graft would be lower. **Verdict:
engineer addressability, don't hope for it.** Full result: [`experiments/RESULTS.md`](./experiments/RESULTS.md).

## 7. The thesis bridge (this is what makes it worth your time) ⭐

Your thesis is *information-preserving quantization of domain specialists*. The lit map gives
this leg real evidence (`LITERATURE.md` §4):

- **MoE/sparse weights quantize *better* than dense** — MoQE (EMNLP-F 2023, `arXiv:2310.02410`):
  2-bit dense FFN collapses (~−91% BLEU) vs 2-bit experts ~−12%; QMoE (MLSys 2024,
  `arXiv:2310.16795`) reaches 0.8 bits/param. **But robustness is component-specific** — shared
  experts + routers are fragile (QuantMoE-Bench `arXiv:2406.08155`), and quantization **flips
  router top-k**, so EAQuant (`arXiv:2506.13329`) needs explicit *routing-consistency alignment*.

The slice that is *both* novel *and* thesis-continuous:

> **Graft + recover a sparse FFN from Gemma-4 E4B, then 4-bit quantize.** Do the MoQE/QMoE
> expert-robustness results hold at **decoder-only ~4B** (the evidence base is encoder-decoder
> MT, not LLMs), and does **routing-consistency degradation become the binding constraint on
> topic-addressability *after* quantization**? That clause fuses §6 (addressability) with the
> quantization thesis — and nobody has measured it.

## 8. De-risk ladder (cheap → expensive; stop early if signal is bad)

1. **Zero training — router probe. ✅ DONE (2026-06-16).** Ran against the **OLMoE-1B-7B**
   proxy (Gemma 4 26B blocked: Ollama opacity + `gemma4` not in transformers 4.51.3). Result:
   topic signal real but weak (NMI +0.042 over null, z≈119, deep-layer-concentrated) — see
   [`experiments/RESULTS.md`](./experiments/RESULTS.md). Re-point at Gemma 4 26B after the
   transformers upgrade; probe an *upcycled* MoE next to confirm the from-scratch>upcycled gap.
2. **Low training — MoEfication on Gemma 4 E4B.** Does its FFN cluster into clean experts with
   ~no retraining? Measures graftability.
3. **Single-layer pilot.** Graft FFF/PKM into *one* mid-stack layer + layerwise-distill it;
   measure recovery before committing the whole model.
4. **Full graft + KD** — only if 1–3 are green. Then the quantization study (§7).

## 9. Publishability (verified novelty gaps — `LITERATURE.md` §8)

Ranked by novelty × thesis-fit:
1. ⭐ **Quant × graft at decoder-only ~4B** (§7) — most defensible, continuous with the thesis,
   and unmeasured: does expert-quant-robustness survive at LLM scale, and does post-quant router
   drift cap topic-addressability?
2. **PKM / memory-layer graft + cheap recovery** — graft-recovery **unverified anywhere**;
   literal addressable lookup best matches the goal. Highest novelty, highest risk.
3. **KD-recovery vs continued-pretraining for FFN-swap on a decoder-only LLM** — the entire KD
   axis lacks prior art; a clean, single-4090-sized comparison.
4. **Engineered domain-addressability** (cluster-partitioned experts) beating uniform-routing
   collapse — directly attacks the §6 finding.
- "Upcycle dense → MoE" bare: **done** (Sparse Upcycling / MoEfication / LLaMA-MoE), not novel.

## 10. Risks / blockers

- **Compute reality.** Full FFN-replacement + KD recovery on a 7–12 B model is *heavier* than
  fine-tuning — and we just spent a session fighting OOM on a 7 B QLoRA on one 4090. The
  de-risk ladder (§8) exists to avoid burning a month before the premise is validated.
- **`gemma4` transformers pin.** Blocks both the Gemma-4 specialist *and* probing Gemma 4 26B.
  Tracking the upgrade separately; it unblocks both. Proxy MoE (OLMoE) sidesteps it for now.
- **Router collapse / non-differentiable selection** (§5.4).
- **Catastrophic forgetting** if distilled on a narrow corpus — use a broad distillation mix.

## 11. Open questions

- PKM vs FFF vs MoE for a single-4090 budget — which recovers best under frozen-backbone KD?
  (→ `LITERATURE.md` recommendation + §8.3 pilot.)
- Is topic-addressability better served by a *learned* router or an *explicit* domain router
  over expert banks? (→ Experiment 1 result decides.)
- Does the quantization-robustness question have any prior art at all? (→ `LITERATURE.md` §4.)

## 12. Next actions

- [x] Deep-research lit map → `LITERATURE.md` (run `w7u8nbu3q`) — done; `[verify]` tags reconciled.
- [~] Run Experiment 1 against OLMoE-1B-7B (running now; result appended to this thread).
- [ ] Decide go/no-go on step 8.2 (MoEfication-*partition* on E4B) from Experiment 1 + lit map.
- [ ] Scope the thesis-aligned slice (§9.1): graft → recover → 4-bit quantize → measure router drift.
