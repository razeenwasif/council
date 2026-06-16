# Experiment 1 — Results (2026-06-16)

**Probe:** `router_probe.py` · **null:** `null_control.py` · raw artifacts in `runs/olmoe.*`,
`runs/olmoe_null.txt`.

## Setup
- **Model:** `allenai/OLMoE-1B-7B-0924` (16 MoE layers, **64 experts, top-8**), 4-bit NF4, on
  the 4090 (GPU was free; Mistral v2 run was paused). **From-scratch** MoE → this is the
  *best-case* for learned-router topic specialization (an *upcycled* graft would be weaker —
  `LITERATURE.md` §3).
- **Stimuli:** 8 topics × 6 single-sentence prompts (physics, CS, biology, law, history,
  medicine, finance, mathematics). **651 tokens total** → 5 208 expert-selections/layer.
- **Metric:** NMI(topic; expert) per layer; purity = mean dominant-topic share/expert.
- **Null:** per-layer independence resampling (same marginals + total count, no association),
  2 000 bootstraps, to subtract the finite-sample NMI floor.

## Headline numbers

| metric | value |
|---|---|
| mean NMI(topic;expert) | **0.063** |
| independence-null floor | **0.021** (std 0.0004) |
| **genuine topic signal (excess)** | **+0.042** |
| significance | **z ≈ 119, p < 0.0005** (0 / 2000 bootstraps ≥ observed) |
| mean purity | 0.225 (vs ~0.125 uniform-routing baseline for 8 topics) |
| depth trend | excess rises **+0.011 (L0) → +0.07 (L14–15)**, monotone-ish |

## Interpretation

1. **The premise is real but weak.** Experts *do* carry topic information — highly significant
   (z≈119), every layer above null — but they realize only **~4–7 % of the topic↔expert MI
   ceiling**. This is *not* the clean topic→parameter lookup the original intuition imagined.
   (Consistent with the lit map: from-scratch MoEs specialize *partially/graded*; the
   "one expert per topic" story was refuted 0-3.)
2. **Specialization is a deep-layer phenomenon.** The signal more than doubles from early to
   late layers — so any topic-addressing structure to exploit lives in the **upper half** of
   the stack. A graft targeting addressability should weight deep layers.
3. **This is an upper bound.** OLMoE is trained from scratch. Per OLMoE §5.3, an *upcycled*
   (cloned-FFN) MoE — the cheap graft — specializes *less*. So a naive Gemma-4 upcycle would
   show **< 0.042** genuine signal. **Betting on the learned router to deliver topic-addressing
   is not supported.** → engineer it (partition / cluster-init experts, or PKM literal lookup).
4. The `share=1.00` experts in the probe's top-list are mostly **n=1 noise**; the trustworthy
   ones are high-n (e.g. L5 E29 CS n=65 @0.83, L7 E43 history n=65 @0.82, L12 E19 history
   n=26 @0.85) — history and CS lean hardest, which fits their distinctive vocabulary.

## Caveats / threats to validity
- **Small sample** (651 tokens, one-sentence prompts). The null control handles the *bias*, but
  a denser re-run (longer per-topic passages → more tokens) would tighten CIs and surface
  weaker per-expert effects. Cheap follow-up.
- **OLMoE ≠ Gemma**, **from-scratch ≠ upcycled** — this measures the *ceiling*, not the graft.
- Token-level routing aggregated to topic level; a per-document analysis might show more.

## Next
- [ ] Denser re-run (longer passages, ≥5 k tokens/topic) to tighten the estimate.
- [ ] Re-point at **Gemma 4 26B** (already MoE) once `gemma4` lands in transformers — compare
      its in-the-wild routing to OLMoE.
- [ ] Probe an **upcycled** MoE (e.g. a Sparse-Upcycled checkpoint) to confirm the
      from-scratch > upcycled specialization gap *locally* — directly motivates "engineer
      addressability" over naive grafting.
- [ ] (thesis-aligned) carry this metric *through 4-bit quantization* — does router drift
      (EAQuant) erode the +0.042 signal? That's the §9.1 paper in miniature.
