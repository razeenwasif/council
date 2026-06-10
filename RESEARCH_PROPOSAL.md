# Research Proposal

## Information-Preserving Quantization of Domain-Specialist Fine-Tunes for Verification in Multi-Agent Scientific Reasoning Systems

**Principal Investigator**: Razeen Wasif
**Date**: 2026-06-02
**Target venue**: workshop submission at NeurIPS ENLSP 2026, ICLR ME-FoMo 2026, or ICML AI4Science 2026 (final venue selection pending Phase 2 results)
**Duration**: 8–10 weeks to first paper draft; 12–14 weeks to submission-ready
**Companion documents**: `ROADMAP.md`, `WEEKLY_PLAN.md`, `LITERATURE_REVIEW.md`

---

## Abstract

Multi-agent large language model (LLM) systems improve reasoning, factuality, and domain coverage over single-model baselines, but at substantial cost — running multiple frontier models per query is expensive and excludes researchers without API budgets. We propose a hybrid architecture in which frontier API models serve as primary reasoners while **locally-hosted, fine-tuned, aggressively-quantized open-weights models act as a verification layer**, auditing domain-specific claims that frontier voices make. We hypothesize that *aggressive quantization of a small domain-specialist fine-tune — when used for verification rather than open-ended generation — preserves enough domain-relevant knowledge to detect specific failure modes that frontier models systematically miss*. Using Gemma-4-31B (~31B parameters, the user's existing local model) fine-tuned via LoRA on a gravitational-wave + signal-processing + quantization corpus, we will conduct a controlled ablation across six bit-depths (FP16, Q8, Q6, Q4, Q3, Q2) comparing post-training quantization (PTQ) and quantization-aware training (QAT). The contribution is threefold: (1) a system architecture for cost-efficient hybrid frontier-local scientific debate; (2) a quantization-degradation curve identifying the practical floor of usable specialist-as-verifier capability; (3) a comparative study of PTQ vs. QAT in the specialist-verifier regime.

---

## 1. Background and Motivation

### 1.1 The cost-quality bottleneck in multi-agent scientific AI

Multi-agent LLM systems are now a leading paradigm for AI-assisted scientific reasoning. Google's AI Co-Scientist (Gottweis et al., 2025) — six Gemini-2.0 agents in a closed-loop tournament — demonstrated novel hypotheses in biomedical discovery [1]. The "Council" and `/discover` modes of the Council system (the author's prior engineering work) implement debate-style multi-agent reasoning for code review and research-question deliberation. Across this paradigm, **the per-query cost is dominated by frontier-model API calls**: each voice in an N-voice debate requires its own frontier inference.

This cost structure has two consequences:

1. **Excludes researchers without API budgets.** A single `/discover` run can cost $1–3 across seven frontier API calls.
2. **Penalizes high-volume inner-loop operations.** In Co-Scientist's tournament structure, Reflection and Ranking agents run dozens of times per cycle.

Aggressive cost reduction would unlock single-graduate-student-budget access to scientific multi-agent systems — a meaningful democratization of the methodology.

### 1.2 Why local quantized models are not (currently) drop-in replacements

The natural alternative — replacing frontier models with local quantized models — fails empirically. Frontier models on benchmarks like GPQA [9] and MMLU-Pro [10] outperform 30B-class open-weights models by 15–30% absolute on graduate-level scientific reasoning. The capability gap is real and disproportionately affects the *generation* and *novel reasoning* roles where breadth matters most.

Recent work by Liu et al. (2025) [4] further showed that quantization disproportionately damages mathematical reasoning compared to general language ability — AWQ/GPTQ introduce up to **32.39% accuracy degradation** on math benchmarks vs. mild impact on commonsense tasks. *Quantization is not a free cost reduction for reasoning-heavy work.*

### 1.3 The architectural insight

Frontier models and quantized specialists are not in direct competition; they have complementary failure modes:

- **Frontier models** reason broadly but confidently hallucinate domain specifics — including arithmetic slips, wrong scaling laws, and misremembered constants. The author has directly observed these failure modes in `/discover` runs over the GW-quantization research domain.
- **Quantized domain specialists** have narrower knowledge but can be tuned to *flag* domain-specific errors without needing to *generate* novel content.

This suggests a hybrid: frontier reasoners produce candidate positions; a quantized specialist *verifies* their domain-specific claims. The specialist is not asked to do what it cannot (reason novelty); it is asked only to recognize what it has been trained on (correctness of specific claims in its domain).

### 1.4 The quantization research opportunity

A specialist's value to the system depends on how much capability survives quantization. Liu et al. (2025) showed that small-scale fine-tuning (~545 examples) can restore much of the quantization damage on a *narrow* reasoning task. **What is unknown** is how that finding extends to the specialist-as-verifier setting in a multi-agent context — where the specialist is asked structured claim-evaluation questions rather than open-ended math problems.

If the quantization-degradation curve has a knee at Q4 or below, the system architecture becomes practical for any researcher with consumer-grade hardware. If the curve is monotonic-with-no-knee, the result is sobering but informative for the field. **Either result is publishable.**

### 1.5 The author's contextual fit

The author's prior research is on quantization-induced SNR degradation in gravitational-wave detection trigger pipelines — directly applying rate-distortion theory to scientific signal processing. The methodological skills required (controlled quantization sweeps, evaluation against ground truth, characterization of degradation modes) transfer directly to LLM-weight quantization. The author also possesses domain expertise sufficient to grade the eval rubric authoritatively in the GW domain, which is the load-bearing methodological requirement of the project.

---

## 2. Research Questions

The project addresses four nested questions in decreasing scope.

### RQ1 (system-level, primary)

> **Does augmenting a frontier-model multi-agent reasoning system (Council / `/discover`) with a quantized domain-specialist verification layer improve domain-specific output quality at a meaningful improvement in cost-quality Pareto frontier?**

Operationalization: measure absolute and relative improvement in eval rubric scores (5-dimensional, 0–3 each) on a held-out set of GW-domain research questions, comparing (a) frontier-only, (b) frontier + specialist (FP16), (c) frontier + specialist (each of Q8 / Q6 / Q4 / Q3 / Q2), (d) all of the above + MCP grounding.

### RQ2 (quantization curve, the headline contribution)

> **What is the shape of the quality-vs-bit-depth degradation curve for a domain-specialist verifier, and at what bit-depth does the specialist stop being useful?**

Operationalization: measure eval rubric scores per bit-depth, identify discontinuities ("knees"), characterize *which classes of errors* the specialist starts missing at each bit-depth. Provide a public quantization-curve figure with confidence intervals.

### RQ3 (PTQ vs. QAT)

> **Does quantization-aware training (QAT) extend the useful bit-depth range beyond post-training quantization (PTQ) by a meaningful margin in the specialist-verifier regime?**

Operationalization: at four critical bit-depths (Q8, Q4, Q3, Q2), train QAT variants alongside PTQ variants. Compare eval scores. Quantify how many bits of additional headroom QAT provides.

### RQ4 (interaction with tool use)

> **How does augmenting the verification layer with external tool use (arXiv MCP, Wolfram MCP) interact with specialist quantization — is it additive, multiplicative, or substitutive?**

Operationalization: measure 2 × 2 × 6 cells (specialist on/off × MCP on/off × 6 bit-depths). Identify per-failure-class whether MCP catches things the specialist misses or vice versa.

---

## 3. Hypotheses

We pre-register the following predictions (to be evaluated against Phase 3-4 results):

**H1**: Adding an un-quantized specialist (FP16) to the frontier-only baseline improves GW-domain eval scores by ≥10% absolute. *Tested in Phase 2.*

**H2**: The quantization-degradation curve has a knee between Q4 and Q3 (i.e., Q8/Q6/Q5/Q4 are roughly equivalent in usefulness; Q3 and below show steep decline). *Tested in Phase 3.*

**H3**: QAT extends the usable bit-depth range by approximately one bit-depth versus PTQ (i.e., QAT-Q3 ≈ PTQ-Q4 in usefulness). *Tested in Phase 3.*

**H4**: MCP augmentation and specialist verification are *complementary* (different error classes), so frontier + MCP + specialist > frontier + MCP > frontier + specialist > frontier alone. *Tested in Phase 4.*

**Null-results explicitly accepted**:

- H1 failure would falsify the entire specialist-verifier concept; this is itself a publishable finding ("specialization in this regime requires more than a 31B base + LoRA can deliver").
- H2 failure (monotonic degradation, no knee) is the most likely *boring* outcome but still publishable as a characterization of the practical limits.
- H3 failure (QAT = PTQ) would be an important negative result for QAT advocates in the specialist regime.

---

## 4. Methodology

### 4.1 Base model and fine-tuning approach

**Base**: Gemma-4-31B (or fallback Gemma-3-27B if 31B is not actually available — methodology is base-agnostic; see ROADMAP §12).

**Fine-tuning**: LoRA via HuggingFace PEFT (or Unsloth for speed). Initial hyperparameters: rank 64, alpha 16, learning rate 1e-4, batch size 4 with grad accumulation 4, target modules {q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj}. Hyperparameters refined in Phase 2 via held-out eval.

**Corpus** for the GW-quantization specialist:
- arXiv abstracts from `gr-qc`, `astro-ph.IM`, `eess.SP` (last 5 years, ~30K abstracts; full text where OA permits)
- Author's existing literature review on GW + quantization SNR degradation
- Author's unpublished derivations and notes (highest per-token value because not in any frontier training set)
- Selected textbook sections (Maggiore, Creighton & Anderson)
- General instruction data (FLAN/Alpaca, 20-30% mix) to mitigate catastrophic forgetting [17]

**Target corpus size**: 50–150M tokens after dedup. Phase 2 will validate this is sufficient via held-out perplexity.

### 4.2 Quantization protocols

**Post-Training Quantization (PTQ)**: GGUF formats via llama.cpp:
- FP16 (reference)
- Q8_0 (~8-bit)
- Q6_K (~6.5-bit)
- Q4_K_M (~4.5-bit, the production sweet spot for most deployments)
- Q3_K_M (~3.5-bit)
- Q2_K (~2.5-bit, experimental regime)

**Quantization-Aware Training (QAT)**: LLM-QAT-style methodology [3]:
- Synthetic data distillation from the FP16-fine-tuned teacher
- Quantize during training; weights, activations, and KV cache
- Train at 4 critical bit-depths (Q8, Q4, Q3, Q2) — skip intermediates for time

### 4.3 Verification-layer architecture

The verifier operates on extracted claims, not whole positions:

1. Frontier voice produces a position.
2. A *claim extractor* (lightweight frontier-model call) parses the position into a JSON list of quantitative or factual claims.
3. For each claim, the specialist outputs `{verdict: CONSISTENT | INCONSISTENT | UNCERTAIN, reasoning: ..., suggested_probe: arxiv | wolfram | code | none}`.
4. Suggested probes are dispatched to MCPs (Phase 4).
5. Annotated position is forwarded to the Synthesist for final brief generation.

This deliberately keeps the specialist's task *structured and bounded*. The hypothesis is that a small quantized model can do "evaluate this claim against my domain training" even when it cannot do "generate a novel hypothesis."

### 4.4 Evaluation

**Primary eval set**: 25 hand-curated research-question briefs spanning GW physics (in-domain), general physics (adjacent), CS/ML (out-of-domain). Manually scored against a 5-dimensional rubric (factual correctness, math correctness, citation quality, novelty, structural completeness), each scored 0–3. **Rubric reliability validated via blind re-grade at 7-day interval (target Cohen's κ ≥ 0.6) and peer blind-grade on 5-item subset.**

**Secondary eval set**: MMLU-Pro [10] physics + chemistry subsets (10 questions each) as the out-of-domain reference. Provides general-reasoning anchor independent of the hand-curated GW set.

**Per-cell sample size**: 25 (in-domain) + 20 (MMLU-Pro). Bootstrap confidence intervals reported for all key comparisons.

**Eval blinding**: rubric scoring done blind to which configuration produced the brief. Order randomized.

### 4.5 Ablation matrix

Full factorial: 2 (specialist on/off) × 6 (bit-depth, including FP16) × 2 (MCP on/off) × 2 (domain). In practice, ~30 cells are filled (some combinations not informative). Each cell × ~25 evals = ~750 total grading operations, manageable within the 7-week timeline.

### 4.6 Statistical analysis

- **Per-cell**: mean rubric score per dimension, with bootstrap 95% CIs.
- **Pairwise comparisons**: paired comparison (same eval items) between cells; report effect size + p-value with Bonferroni-corrected α = 0.05 / (number of comparisons).
- **Quantization curves**: scores plotted vs. effective bits per parameter, with shaded CI band.

### 4.7 Reproducibility

All artifacts will be open-sourced:
- LoRA adapter weights (HuggingFace Hub)
- Quantized GGUF variants (HuggingFace Hub)
- Eval set + rubric + scoring scripts (GitHub)
- Training and inference scripts (GitHub, this repo)
- Frozen Python environment (requirements-lock.txt)
- Compute logs (GPU hours, peak memory) for cost-replication

---

## 5. Expected Contributions

### 5.1 Empirical

- **First controlled quantization sweep of a domain-specialist verifier in a multi-agent context** (across 6 bit-depths, PTQ + QAT, both in-domain and out-of-domain evaluation).
- **Cost-quality Pareto frontier** for hybrid frontier + local-specialist systems on scientific reasoning tasks.
- **Per-error-class degradation profile**: which kinds of errors the specialist starts missing at each bit-depth.

### 5.2 Methodological

- Reproducible eval harness for multi-agent scientific reasoning systems, including hand-graded rubric methodology with reliability validation.
- A claim-extractor + verifier interface design for plugging local specialists into existing multi-agent frameworks.

### 5.3 System / Engineering

- An open-source verification layer implementation for Council and `/discover`.
- MCP-augmented verifier wiring (arXiv + Wolfram).
- Per-domain specialist artifacts (starting with GW, extensible to additional domains in Phase 5).

### 5.4 Connections to author's existing research

The project directly extends the author's prior work on quantization-induced SNR degradation in GW trigger pipelines [internal lit review, not yet published] from *detector signal quantization* to *model weight quantization*, using a unified rate-distortion framework. This makes the project a coherent thesis-portfolio piece rather than a one-off engineering exercise.

---

## 6. Evaluation Plan

| Phase | Decision gate | Pass condition | Fail action |
| ----- | ------------- | -------------- | ----------- |
| 0     | Rubric reliability | Cohen's κ ≥ 0.6 | Extend Phase 0 by 1 week; commit even if imperfect |
| 1     | Failure-mode hypothesis | ≥1 class plausibly addressable by specialist | Pivot to MCP-only architecture (skip P2-P3) |
| 2     | FP16 specialist viability | ≥10% absolute improvement on GW eval | Diagnose; if no fix, pivot to MCP-only |
| 3     | Quantization curve shape | Knee identifiable OR clear monotone curve | Either is publishable; no fail action |
| 4     | MCP × specialist interaction | Measurable effect (positive or negative) | None — descriptive analysis only |

The project has multiple paths to publishable outcomes (system result, positive quantization result, negative quantization result). The only true failure mode is failing to produce any of those — which the Phase 0–1 design specifically guards against.

---

## 7. Timeline

Calendar weeks from start (assumed Week 0 = prep week):

| Week | Phase | Milestone | Output |
| ---- | ----- | --------- | ------ |
| 0    | Prep  | Environment ready | Locked deps, GPU verified, venue picked |
| 1    | P0    | Eval harness locked | Rubric v1, 25 briefs, κ check |
| 2    | P1    | Baseline characterized | Failure-mode taxonomy |
| 3    | P2.1  | Specialist data prepared | Training corpus + config |
| 4    | P2.2  | FP16 specialist validated | LoRA + Phase 2 writeup |
| 5    | P3.1  | PTQ sweep complete | 6 quantized variants + curve |
| 6    | P3.2  | QAT sweep + comparison | Headline figure + paper draft v1 |
| 7    | P4    | MCP integration | Final ablation cells + paper draft v2 |
| 8    | Submit | Paper submitted | Workshop submission |

Detailed weekly todos: see `WEEKLY_PLAN.md`.

---

## 8. Resources Required

### Compute
- 1× A100 80GB rental (RunPod / vast.ai / Modal): ~60-100 GPU-hours across all phases. **Estimated cost: $100-250.**
- Local 24GB+ GPU (or equivalent rented inference) for eval passes: ~50 GPU-hours total. Free if local.

### API budget
- Claude (Opus 4.7, Sonnet 4.6), Gemini (3.5 Pro, Flash): ~$100-150 across all phases. **Within existing subscription tiers.**

### Storage
- ~150 GB for model variants + corpus + eval. Already available.

### Human time
- ~135–200 hours of focused work over 8 weeks. Distributed roughly 30% eval-design + grading, 30% training + experiments, 40% writing.

### Tooling
- Ollama (existing), HuggingFace `transformers` + `peft` (or Unsloth), `llama.cpp` for GGUF quantization, `vllm` for serving FP16 variants, matplotlib for figures.

### Optional but valuable
- Peer or advisor for rubric blind-scoring (Phase 0) and paper draft review (Phase 7-8). Even informal mentorship from someone with an ML-paper-writing background materially improves the submission.

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Phase 0 rubric never reaches κ ≥ 0.6 | medium | blocks all downstream phases | hard time-box at 2 weeks; commit even if imperfect; document limitation |
| Specialist FP16 fails Gate 2 (H1 false) | medium-low | invalidates main hypothesis | diagnose (data quantity, base model, prompt design); if irreducible, paper becomes a negative result on specialist concept |
| Quantization curve has no knee | medium | weaker paper | reframe as "limits of small-model specialization under PTQ"; still publishable, possibly at a more specialized workshop |
| Gemma 4 31B doesn't actually exist | low | switch base model | methodology is base-agnostic; rerun with Gemma 3 27B or Qwen 2.5 32B |
| Local GPU insufficient | medium | inference must be rented | Q4_K_M of 31B fits in 24GB; only training needs rental, already budgeted |
| MCP layer breaks fault tolerance | medium | Phase 4 runs incomplete | benchmark MCP latencies before integration; raise timeouts; cache aggressively |
| Catastrophic forgetting in fine-tune | medium | specialist loses general reasoning | mix 20-30% general instruction data during FT (per [17]); validate against MMLU-Pro subset each epoch |
| Three months of infra, no experiments | medium-high | the highest risk | time-box hard at every phase; weekly writeups force discipline |
| Sample size insufficient for significance | medium | results inconclusive | n=25 in-domain + n=20 OOD; bootstrap CIs to detect noise vs. signal; reframe inconclusive findings honestly |
| Workshop submission deadline missed | low | delayed publication | flexibility across multiple targets (NeurIPS workshops, ICLR workshops, AAAI workshops); blog/preprint always available |
| Goodhart on the rubric | low | inflated results | held-out subset never used during prompt iteration; results reported on held-out only |

---

## 10. Ethics, Open Science, and Reproducibility Commitments

- **No human-subject data.** All training corpus is public arXiv + open-access textbooks + author's own notes.
- **No deceptive deployment.** The system is a research artifact; no claims will be made about its safety for clinical, financial, or other high-stakes uses.
- **Open release of all artifacts**: code, weights, eval set, scoring scripts, hyperparameter logs.
- **Reporting of negative results**: if Phase 2 fails Gate 2, the failure mode and diagnostic process will be documented and submitted as a negative-results paper rather than abandoning the project silently.
- **Pre-registration**: the four hypotheses in §3 above are pre-registered. Any post-hoc hypotheses introduced after seeing results will be clearly labeled as exploratory.
- **Compute disclosure**: all GPU hours and API costs reported in the paper's reproducibility section, including cost-replication estimates for readers.

---

## 11. Beyond the First Paper — Roadmap of Follow-On Work

If Phase 2–4 succeed, four natural follow-ups become available:

1. **Multi-specialist scaling study** (Phase 5 in `ROADMAP.md`): does the quantization curve generalize across domains, or is it domain-specific?
2. **Closed-loop Co-Scientist with quantized verifiers** (per `CO-SCIENTIST.md`): integrate the verification layer into the full 6-agent hypothesis-tournament architecture.
3. **Quantization-aware specialization methodology**: develop new training recipes that produce specialists *designed* to survive aggressive quantization, rather than first training FP16 then degrading.
4. **Distillation as a second compression axis**: the present paper studies compression along the *bit-depth* axis (quantization — same parameters, fewer bits). Distillation is the orthogonal *parameter-count* axis (train a small 1.5–3B student from the FP16 7B specialist as teacher). The same measurement apparatus — multi-channel verification detecting degradation that single-channel perplexity misses — applies unchanged. The contribution is the **head-to-head at matched VRAM/latency budget**: does quantizing 7B→Q2 or distilling 7B→1.5B preserve more *verifiable* reasoning, do they fail *differently* under the verifier, and does **distill-then-quantize** compound or compound-less (a distilled student's narrower output distribution may be more information-preserving under quantization — directly testing this paper's central hypothesis on a new model). This is framed deliberately as a *comparison axis*, not a co-equal pillar: quantization stays the headline so the contribution stays sharp, and distillation enters as the baseline-and-stacking study that completes the compression picture. A cheap v1 is nearly free given the existing pipeline — sequence-level distillation reuses the Council-bootstrap training data with a smaller base model (see `~/Research/council-specialists/BACKLOG.md` and `HARDWARE.md` §5–§7 for the engineering sketch and the size-reduction analysis).

Each follow-up could be a self-contained paper. The present proposal commits only to the first paper.

---

## 12. References

References here are a curated subset of the full bibliography in `LITERATURE_REVIEW.md`. Numbering matches that file.

[1] Gottweis, J., et al. (2025). *Towards an AI co-scientist*. [arXiv:2502.18864](https://arxiv.org/abs/2502.18864)

[2] Du, Y., et al. (2023). *Improving Factuality and Reasoning in Language Models through Multiagent Debate*. ICML 2024. [arXiv:2305.14325](https://arxiv.org/abs/2305.14325)

[3] Liu, Z., et al. (2023). *LLM-QAT: Data-Free Quantization Aware Training for Large Language Models*. ACL 2024. [arXiv:2305.17888](https://arxiv.org/abs/2305.17888)

[4] Liu et al. (2025). *Quantization Meets Reasoning*. [arXiv:2501.03035](https://arxiv.org/abs/2501.03035)

[5] Frantar, E., et al. (2022). *GPTQ: Accurate Post-Training Quantization*. [arXiv:2210.17323](https://arxiv.org/abs/2210.17323)

[6] Lin, J., et al. (2023). *AWQ: Activation-aware Weight Quantization*. MLSys 2024. [arXiv:2306.00978](https://arxiv.org/abs/2306.00978)

[7] Dettmers, T., et al. (2023). *QLoRA: Efficient Finetuning of Quantized LLMs*. NeurIPS 2023. [arXiv:2305.14314](https://arxiv.org/abs/2305.14314)

[8] Hu, E. J., et al. (2021). *LoRA: Low-Rank Adaptation of Large Language Models*. ICLR 2022. [arXiv:2106.09685](https://arxiv.org/abs/2106.09685)

[9] Rein, D., et al. (2023). *GPQA: A Graduate-Level Google-Proof Q&A Benchmark*. [arXiv:2311.12022](https://arxiv.org/abs/2311.12022)

[10] Wang, Y., et al. (2024). *MMLU-Pro: A More Robust and Challenging Multi-Task Language Understanding Benchmark*. NeurIPS 2024. [arXiv:2406.01574](https://arxiv.org/abs/2406.01574)

[11] Wu, C., et al. (2024). *LLaMA Pro: Progressive LLaMA with Block Expansion*. ACL 2024. [arXiv:2401.02415](https://arxiv.org/abs/2401.02415)

[12] Liu, S.-Y., et al. (2024). *DoRA: Weight-Decomposed Low-Rank Adaptation*. ICML 2024 Oral. [arXiv:2402.09353](https://arxiv.org/abs/2402.09353)

[13] Ma, S., et al. (2024). *The Era of 1-bit LLMs (BitNet b1.58)*. [arXiv:2402.17764](https://arxiv.org/abs/2402.17764)

[14] Liu, Z., et al. (2024). *SpinQuant: LLM Quantization with Learned Rotations*. ICLR 2025. [arXiv:2405.16406](https://arxiv.org/abs/2405.16406)

[15] Taylor, R., et al. (2022). *Galactica: A Large Language Model for Science*. [arXiv:2211.09085](https://arxiv.org/abs/2211.09085)

[16] Gururangan, S., et al. (2020). *Don't Stop Pretraining*. ACL 2020. [aclanthology.org/2020.acl-main.740](https://aclanthology.org/2020.acl-main.740/)

[17] Luo, Y., et al. (2023). *Catastrophic Forgetting in LLMs During Continual Fine-tuning*. [arXiv:2308.08747](https://arxiv.org/abs/2308.08747)

[18] Anthropic (2024). *Model Context Protocol Specification*. [modelcontextprotocol.io](https://modelcontextprotocol.io/specification/)

[19] Madaan, A., et al. (2023). *Self-Refine: Iterative Refinement with Self-Feedback*. NeurIPS 2023. [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)

[20] Manakul, P., et al. (2023). *SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection*. EMNLP 2023. [arXiv:2303.08896](https://arxiv.org/abs/2303.08896)

[21] Wu, Q., et al. (2023). *AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation*. [arXiv:2308.08155](https://arxiv.org/abs/2308.08155)

[22] Gemma Team (2025). *Gemma 3 Technical Report*. [arXiv:2503.19786](https://arxiv.org/abs/2503.19786)

[23] Yang, A., et al. (2024). *Qwen2.5 Technical Report*. [arXiv:2412.15115](https://arxiv.org/abs/2412.15115)

Full bibliography: see `LITERATURE_REVIEW.md`.
