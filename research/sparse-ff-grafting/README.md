# Research thread — Sparse / topic-addressable feed-forward grafting

Exploratory thread (opened 2026-06-16). **Can we graft a sparse, topic-addressable
feed-forward architecture into a pretrained dense LLM (Gemma 4) via knowledge distillation —
"awaken only the parameters relevant to a topic, like a lookup table" — instead of training
one from scratch?**

## Contents

| file | what |
|---|---|
| [`FEASIBILITY.md`](./FEASIBILITY.md) | Design + feasibility memo: the idea, mechanisms (MoE / PKM / FFF), graft-vs-scratch verdict, the make-or-break recipe, the thesis bridge (quantization), de-risk ladder, publishability. |
| [`LITERATURE.md`](./LITERATURE.md) | Fact-checked, adversarially-verified literature map (deep-research `w7u8nbu3q` — **18 claims confirmed / 7 refuted**). Headline: cloned-FFN upcycling *fails* to specialize by topic; MoE quantizes better than dense but routers are fragile. |
| [`PAPER_STRATEGY.md`](./PAPER_STRATEGY.md) | Publication plan: thesis-spine + folded-in quant chapter + a separate *gated* architecture paper; the A→B sequencing, decision gates tied to the de-risk ladder, venues, and the traps to avoid. |
| [`experiments/router_probe.py`](./experiments/router_probe.py) | Experiment 1 — topic→expert routing probe for open MoEs. Runnable. |
| [`experiments/null_control.py`](./experiments/null_control.py) | Independence-null for the probe NMI (subtracts the finite-sample floor). |
| [`experiments/RESULTS.md`](./experiments/RESULTS.md) | Experiment 1 result write-up (OLMoE) + null control + interpretation. |
| [`experiments/README.md`](./experiments/README.md) | How/when to run Experiment 1, the three blockers on probing Gemma 4 directly, and the OLMoE proxy. |

## TL;DR (see `FEASIBILITY.md` for the full argument)

- **Graft, don't build from scratch** — module-replacement + distillation recovery is an
  established pattern (Sparse Upcycling, MoEfication, UltraFastBERT).
- **Gemma 4 26B is already a MoE** — probe its router for topic specialisation *before*
  building anything (Experiment 1).
- **Make-or-break:** warm-start the new FFN from the old one; don't hard-freeze attention
  (let LayerNorms + an attention-LoRA adapt); distill hidden states layerwise; tame router
  collapse with load-balancing losses.
- **Key finding (cited):** the cheapest graft — *cloned-FFN upcycling* — empirically **fails to
  specialize by topic** (OLMoE, `arXiv:2409.02060`): dense-init experts start from one local
  optimum and route near-uniformly. So topic-addressability must be **engineered** (partition /
  cluster-init experts, or PKM literal-lookup), not hoped for from a learned router.
- **Thesis bridge:** MoE/sparse weights quantize **better** than dense (MoQE/QMoE) but routers
  are **fragile** under quantization (EAQuant). The slice worth your time: **graft → recover →
  4-bit quantize → does router drift cap topic-addressability?** — continuous with the thesis,
  and unmeasured.

## Status

- [x] Feasibility memo (`FEASIBILITY.md`) — reconciled with the lit map.
- [x] Experiment 1 harness written + documented (`experiments/`).
- [x] Literature map (`LITERATURE.md`) — deep-research `w7u8nbu3q`, 18 confirmed / 7 refuted.
- [x] Experiment 1 (OLMoE probe + independence-null) — topic signal **real but weak**: NMI
  **+0.042** over null (z≈119, p<0.0005), deep-layer-concentrated; an upcycled graft would be
  weaker → engineer addressability. Full result: [`experiments/RESULTS.md`](./experiments/RESULTS.md).
- [ ] Denser re-run + probe an upcycled MoE + carry the metric through 4-bit quantization (§9.1).
