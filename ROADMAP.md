# Implementation Roadmap — Quantized Domain Specialists for Multi-Agent Scientific Reasoning

> Research and engineering plan for extending Council with locally-hosted, fine-tuned, quantized domain-specialist models that serve as a verification layer alongside frontier API models, with MCP-grounded tool use for factual + computational checking.

**Status**: Planning. Engineering not yet started.
**Author**: Razeen Wasif
**Last updated**: 2026-06-02
**Companion docs**: `WEEKLY_PLAN.md` (week-by-week todos), `RESEARCH_PROPOSAL.md` (formal thesis), `LITERATURE_REVIEW.md` (sourced background).

---

## 0. Executive Summary

### Thesis

> *Aggressive quantization of small domain-specialist fine-tunes — when used as a verification layer rather than as a primary reasoner — preserves enough domain-relevant knowledge to detect specific failure modes that frontier models systematically miss, at a fraction of the per-query cost.*

The wider claim, decomposed:

1. **Frontier API models (Claude, Gemini, GPT) remain the primary reasoners.** They are not being replaced. They drive the multi-agent debate (Council, `/discover`).
2. **Local Gemma-4-31B fine-tunes act as verifiers.** Each specialist is a domain expert ("physics", "ML systems", "signal processing", "mathematics") that critiques frontier outputs within its domain.
3. **MCPs (arXiv, Wolfram, code-execution) supply factual + computational grounding.** They are the second line of defense against the math-slip / hallucination class of failure.
4. **Quantization is the load-bearing research contribution.** How much can the specialists be compressed (FP16 → Q8 → Q4 → Q3 → Q2) before they stop being useful verifiers? Where on the curve is the cost-quality knee? Can quantization-aware training (QAT) push the knee further than post-training quantization (PTQ)?

The system has tangible engineering value (cheaper, more accurate `/discover` runs) *and* publishable scientific value (a controlled ablation study on quantization × specialization × multi-agent reasoning).

### What this roadmap is NOT

- It is not a plan to replace frontier models with local ones.
- It is not a plan to build *N* specialists in parallel. The pilot builds *one*, validates it, then scales.
- It is not a guarantee of paper-worthy results. Phases 2–4 have explicit decision gates; a null result is acceptable and itself publishable.

---

## 1. Target Architecture

The end-state system, with all three tiers in place.

```
                                    ┌────────────────────────────────────────┐
                                    │           USER / SCIENTIST             │
                                    │   "Does Δ phase bias from 4-bit PE     │
                                    │    accumulate constructively in matched │
                                    │    filtering for GW chirp templates?"  │
                                    └────────────────────┬───────────────────┘
                                                         │
                                                         ▼
                                ┌────────────────────────────────────────────────┐
                                │      ROUTER  (heuristic + LLM-classifier)      │
                                │  decides: solo? council? /discover? co-sci?    │
                                └────────────────────┬───────────────────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          │ engineering task         │ research question        │
                          ▼                          ▼                          ▼
                  ┌──────────────┐          ┌─────────────────┐         ┌────────────────┐
                  │  COUNCIL     │          │   /discover     │         │  CO-SCIENTIST  │
                  │ (7 roles)    │          │ (4 roles + Synt) │         │ (planned, see  │
                  │              │          │                  │         │  CO-SCI.md)    │
                  └──────┬───────┘          └────────┬─────────┘         └────────┬───────┘
                         │                           │                            │
                         └───────────┬───────────────┴────────────────────────────┘
                                     │
                                     ▼ frontier voices spawn
        ┌──────────────────────────────────────────────────────────────────────────┐
        │                       FRONTIER  TIER  (API)                              │
        │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
        │  │  Claude  │  │  Gemini  │  │   GPT    │  │ Mistral  │  │ DeepSeek │    │
        │  │ Opus 4.7 │  │ 3.5 Pro  │  │  4.1 mini│  │  Large   │  │   Chat   │    │
        │  │ Sonnet 4.6│  │   Flash  │  │          │  │          │  │          │    │
        │  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘    │
        └────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────┘
                 │             │             │             │             │
                 │  each voice produces a Position / Proposal / Review   │
                 ▼             ▼             ▼             ▼             ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │                  VERIFICATION  LAYER  (LOCAL, QUANTIZED)               │
        │                                                                         │
        │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
        │   │  Physics-FT    │  │   Math-FT      │  │  ML-Systems-FT │   . . .   │
        │   │  Gemma-4-31B   │  │  Gemma-4-31B   │  │  Gemma-4-31B   │           │
        │   │  +LoRA (GW,    │  │  +LoRA (math   │  │  +LoRA (ML     │           │
        │   │  quantization) │  │  derivations)  │  │  systems)      │           │
        │   │  Q4_K_M        │  │  Q4_K_M        │  │  Q4_K_M        │           │
        │   └───────┬────────┘  └───────┬────────┘  └───────┬────────┘           │
        │           │                   │                   │                     │
        │           └───────────────────┼───────────────────┘                     │
        │                               │                                         │
        │           Verifiers receive frontier position + claim list,             │
        │           flag domain-specific errors before brief synthesis            │
        └───────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼  flagged claims trigger…
        ┌──────────────────────────────────────────────────────────────────────────┐
        │                       GROUNDING  TIER  (MCP)                             │
        │  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────────────┐   │
        │  │  arXiv MCP   │   │  Wolfram MCP     │   │  Code-execution MCP     │   │
        │  │  search +    │   │  symbolic +      │   │  Python sandbox         │   │
        │  │  abstract +  │   │  numeric +       │   │  (Modal / E2B / local)  │   │
        │  │  PDF fetch   │   │  unit checking   │   │                         │   │
        │  └──────────────┘   └──────────────────┘   └─────────────────────────┘   │
        └──────────────────────────────────┬───────────────────────────────────────┘
                                           │
                                           ▼
                                ┌────────────────────────┐
                                │   SYNTHESIST / FINAL   │
                                │   Frontier model       │
                                │   (Claude / Gemini)    │
                                │   produces brief w/    │
                                │   verifier annotations │
                                └────────────┬───────────┘
                                             │
                                             ▼
                                ┌────────────────────────┐
                                │  TELEMETRY + LEDGER    │
                                │  (Phase 1 of self-     │
                                │   improvement plan)    │
                                │  ~/.openclaude/        │
                                │  - usage.jsonl         │
                                │  - council-runs.jsonl  │
                                │  - verifier-flags.jsonl│
                                └────────────────────────┘
```

### Three tiers, three roles

| Tier              | Role                                         | Cost/call | Latency | Capability |
| ----------------- | -------------------------------------------- | --------- | ------- | ---------- |
| **Frontier API**  | Primary reasoner — generates positions       | $$$       | low     | very high  |
| **Local quantized specialist** | Domain verifier — flags errors  | ~$0       | medium  | medium (domain), low (general) |
| **MCP**           | Factual / computational ground truth         | ~$0       | high    | exact within scope |

The system is designed so each tier compensates for the others' weaknesses. Frontier models reason broadly but hallucinate domain specifics. Specialists know the domain but can't reason as broadly. MCPs are exact but only within tightly scoped queries. The verification layer is the architectural innovation — most prior multi-agent work either uses *all* frontier voices or *all* local voices. The hybrid is rarer.

---

## 2. Verification Layer — Detailed View

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │              FRONTIER VOICE OUTPUT (e.g. /discover Hypothesizer)       │
   │  ┌───────────────────────────────────────────────────────────────────┐ │
   │  │ ## Headline                                                       │ │
   │  │   Δ phase from 4-bit PE accumulates as O(√N) under matched filter│ │
   │  │ ## Position                                                       │ │
   │  │   For N=10⁵ samples, expected RMS phase error from 4-bit PE is   │ │
   │  │   ≈0.18 rad per sample. Under matched filtering, errors add in   │ │
   │  │   quadrature → total ≈0.057 rad, well below 0.1 rad chirp        │ │
   │  │   coherence threshold. So 4-bit PE is safe.                       │ │
   │  └───────────────────────────────────────────────────────────────────┘ │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
                                       ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                    CLAIM EXTRACTOR (lightweight LLM call)              │
   │   Parses position → list of quantitative claims:                       │
   │   • C1: "RMS phase error from 4-bit PE ≈ 0.18 rad"                     │
   │   • C2: "Errors add in quadrature under matched filtering"             │
   │   • C3: "Total ≈ 0.057 rad for N=10⁵"                                 │
   │   • C4: "0.1 rad is the chirp coherence threshold"                     │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
                                       ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                LOCAL SPECIALIST (Physics-FT Gemma-4-31B Q4_K_M)        │
   │                                                                         │
   │  For each claim, output:                                                │
   │    • Verdict: CONSISTENT | INCONSISTENT | UNCERTAIN                    │
   │    • Reasoning: 1-2 sentences                                           │
   │    • Suggested MCP probe: arxiv? wolfram? code? none?                  │
   │                                                                         │
   │  Example:                                                               │
   │    C3 verdict: INCONSISTENT                                            │
   │    "Quadrature-sum √(N·σ²) for σ=0.18, N=10⁵ → ≈57 rad, not 0.057.    │
   │     Factor of 10³ error suggests the position confused N with N·σ²    │
   │     or dropped the √N scaling."                                        │
   │    Suggested MCP: wolfram (verify √(10⁵ · 0.18²))                     │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
                                       ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                          MCP PROBE  (if requested)                     │
   │   Wolfram → Sqrt[100000 * 0.18^2] = 56.92                              │
   │   Specialist verdict confirmed; original claim was ~10³× off.          │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
                                       ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │              ANNOTATED POSITION  →  forwarded to Synthesist            │
   │   ✗ C3: claim contradicted by specialist + Wolfram (factor 10³ error) │
   │   ⊘ C1, C2, C4: consistent or unverifiable                            │
   └────────────────────────────────────────────────────────────────────────┘
```

The verification layer is **deterministic, not generative**. It does not produce a competing position — it produces a structured *audit* of claims that the frontier voice made. This is why a small, fine-tuned, quantized model can be effective despite a lower capability ceiling: it isn't being asked to reason broadly. It's being asked to evaluate specific claims it has been trained on.

---

## 3. Experimental Design (the load-bearing research contribution)

The core ablation matrix. Each cell is a measurement against the eval harness (Phase 0).

```
                         ┌─────────────── Configuration ────────────────┐
                         │                                                │
            Baseline   Frontier   Frontier + MCP   Frontier + Specialist  Frontier + Specialist + MCP
              only       only      (arXiv,Wolf)        (FP16 / Q8 / Q4 / Q3 / Q2)
       ┌─────────────┬──────────┬───────────────┬───────────────────┬──────────────────────────┐
GW     │   score_00  │ score_01 │   score_02    │    score_03       │       score_04           │
DOMAIN │             │          │               │ × 5 bit-depths    │     × 5 bit-depths       │
       ├─────────────┼──────────┼───────────────┼───────────────────┼──────────────────────────┤
GEN    │   score_10  │ score_11 │   score_12    │    score_13       │       score_14           │
RSNNG  │             │          │               │ (out-of-domain    │   (out-of-domain         │
(MMLU) │             │          │               │  for specialist)  │    for specialist)       │
       └─────────────┴──────────┴───────────────┴───────────────────┴──────────────────────────┘

   Cell entries are tuples: (correctness, cost, latency, # spec interventions, # MCP calls)
```

### The four experimental axes

1. **Has specialist?** (boolean)
2. **Specialist bit-depth** (FP16, Q8, Q6, Q4, Q3, Q2 — six levels)
3. **Has MCPs?** (boolean)
4. **Evaluation domain** (in-domain GW physics vs. out-of-domain MMLU-Pro physics)

A full factorial would be 2 × 6 × 2 × 2 = 48 cells. In practice, Phase 0–2 only fill the first 4 columns (no quantization); Phase 3 expands to fill the full grid. Each cell needs ~30 evaluations to get stable averages; planning for ~1500 total evaluations.

**Optional 5th axis (follow-on, not v1) — compression *modality*.** The four axes above all compress along bit-depth (quantization). A natural extension adds a second compression modality — *distillation* (parameter count) — as a comparison baseline: train a small 1.5–3B student from the FP16 7B specialist and run it through the *same* grid. The interesting cells are the matched-budget head-to-heads (e.g. `7B-Q2` vs `1.5B-distilled` vs `1.5B-distilled-Q4` at comparable VRAM/latency) measured by the same verifier. This is deliberately scoped as a *comparison axis layered on the existing harness*, not a fifth pillar that displaces the quantization study — quantization stays the headline. Full framing in `RESEARCH_PROPOSAL.md` §11 follow-on #4; engineering sketch in `~/Research/council-specialists/BACKLOG.md` ("Knowledge distillation as a second compression axis") + `HARDWARE.md` §5–§7.

### Expected curves (predictions to test)

```
   Correctness on
   in-domain GW eval
        ▲
   1.0 ┤   ┌── frontier + Wolfram ──┐
        │   │                       │
        │   │ ╭── frontier + specialist FP16  ← top of curve
        │   │ │
   0.8 ┤   │ ╰── frontier + specialist Q8     ← knee?
        │   │   ╲
        │   │    ╲── frontier + specialist Q4 ← still useful?
        │   │     ╲
   0.6 ┤   │      ╲── frontier + specialist Q3 ← degraded
        │   ●── frontier only baseline
        │       ╲── frontier + specialist Q2  ← worse than no spec
   0.4 ┤
        │
        └───┬────┬────┬────┬────┬────┬────────►
          FP16  Q8   Q6   Q4   Q3   Q2
                Specialist bit-depth
```

The interesting finding will be the *shape* of the curve and the location of the knee. If the knee is at Q4 the result is enthusiastic (huge cost savings possible). If the curve drops monotonically the result is sobering but still publishable (negative results on the limits of specialization-under-compression).

---

## 4. Phased Plan

```
Phase 0 ────► Phase 1 ────► Phase 2 ────► Phase 3 ────► Phase 4 ────► Phase 5
Eval har-     Baseline      Single        Quantization  MCP            Additional
ness          characteri-   specialist    study         integration    specialists
              zation        (FP16)        (PAPER)
~1 week       ~1 week       ~2 weeks      ~1-2 weeks    ~1 week        ~2-3 wk/spec
$0            $10-30 API    $50-150 GPU   $20-50 GPU    $5-20 API      Conditional
              compute       + API         + API         + GPU          on P2 result

Gate 0:       Gate 1:       Gate 2:       Gate 3:       Gate 4:        Gate 5:
Can I score   Are there     Does FP16     Does the      Does adding    Does each new
two briefs    failures      specialist    quantization  MCPs further   specialist
consistently  specialist    beat base-    curve have    improve over   beat baseline
a week        could plau-   line on GW    a useful      specialist     in its domain?
apart?        sibly help?   eval by 10%?  knee?         alone?
```

### Phase 0 — Eval Harness (Week 1)

**Goal**: a measurement instrument that survives the project. Without it, every later phase is a guess.

**Deliverables**:
- 15–25 hand-graded research-question briefs (GW physics + general physics + general CS subsets)
- Scoring rubric: factual correctness, math correctness, citation quality, novelty, structural completeness — each scored 0–3
- Inter-rater reliability check: blind re-grade after 7 days, target Cohen's κ ≥ 0.6 against yourself

**Decision gate**: do you have a rubric where you'd score two different briefs differently with high reliability against yourself a week apart?

**Tooling**: hand-graded spreadsheet (Google Sheets or Excel). Resist the temptation to build a tool.

### Phase 1 — Baseline Characterization (Week 2)

**Goal**: know what we're improving on. Run the current Council + `/discover` against the eval. Identify failure-mode classes.

**Deliverables**:
- Baseline score per cell (frontier-only) across all eval items
- Failure-mode taxonomy: math slips, citation hallucinations, domain knowledge gaps, structural errors, etc.
- Per-failure-class hypothesis: which class would a specialist plausibly catch? Which would only MCP catch?

**Decision gate**: is there ≥1 failure-mode class where a specialist would plausibly help — *distinct from what MCPs alone would catch*? If everything reduces to "needs Wolfram" or "needs arXiv," skip Phase 2–3 and just ship the MCPs (Phase 4 only).

### Phase 2 — Single Un-Quantized Specialist (Weeks 3-4)

**Goal**: prove the specialist concept *at all* before any quantization. Train one LoRA on Gemma-4-31B in the GW + quantization domain (the user's own domain). Wire as a verification layer in `/discover`. Compare against baseline.

**Deliverables**:
- LoRA adapter trained on:
  - User's existing literature review (`~/Research/TinyML-Quantization_Induced_GW_SNR_Degradation/Literature_Review_Final_Draft.md`)
  - arXiv abstracts from `gr-qc`, `astro-ph.IM`, `eess.SP` (~50K papers)
  - Selected sections of relevant textbooks (Maggiore, Creighton & Anderson)
  - Any of the user's unpublished notes + derivations
- Claim-extractor module (lightweight, can use frontier model)
- Verifier service exposed as an OpenAI-compatible endpoint via Ollama or vLLM
- Integration into `/discover` Empiricist + Hypothesizer roles as a post-generation verifier
- Side-by-side comparison: baseline vs. baseline + verifier on the same 15 eval items

**Decision gate**: does the un-quantized verifier improve in-domain eval scores by ≥10% (absolute) on the GW subset? If no, the *specialist concept itself* is in trouble — stop before quantizing.

### Phase 3 — Quantization Study (Weeks 5-6)

**Goal**: the paper. Take the validated Phase 2 LoRA. Quantize at FP16 → Q8 → Q6 → Q4 → Q3 → Q2 (via llama.cpp GGUF formats: Q8_0, Q6_K, Q4_K_M, Q3_K_M, Q2_K). Measure on eval at each step.

**Sub-experiment**: compare *post-training quantization* (PTQ) vs. *quantization-aware training* (QAT). For QAT, retrain the LoRA at target bit-depth using LLM-QAT-style synthetic data distillation, then compare to PTQ of the FP16 LoRA.

**Deliverables**:
- 12 quantized model variants (6 bit-depths × {PTQ, QAT})
- Eval scores per variant across in-domain + out-of-domain subsets
- Compute curves: degradation per bit, plotted; identify the knee
- Error-type breakdown: which kinds of errors does each bit-depth start missing?
- Latency + memory profile per variant
- Draft of the quantization study writeup (this is the publishable artifact)

**Decision gate**: does the curve show a knee where QAT meaningfully extends usefulness beyond PTQ? If yes — strong paper. If the curve is monotonically smooth and PTQ = QAT — still publishable as a negative result on the limits of specialization-under-quantization.

### Phase 4 — MCP Integration (Week 7)

**Goal**: validate that MCPs improve over specialist-alone, and measure the *interaction* between specialist + MCP. (Are they additive? Redundant?)

**Deliverables**:
- arXiv MCP wired into Empiricist verifier
- Wolfram MCP wired into Hypothesizer verifier (claims with numbers → auto-probe)
- Eval cells filled: frontier+MCP, frontier+spec+MCP
- Interaction analysis: where does MCP catch things the specialist missed? Where redundant?

**Decision gate**: does MCP-augmented specialist > specialist-only by a meaningful margin? If yes, the system architecture is validated end-to-end.

### Phase 5 — Additional Specialists (Weeks 8+, conditional)

**Goal**: only if Phase 2–3 succeeded for GW. Add one more domain specialist for an adjacent area where the user has data + intuition. Each new specialist is a separate experimental cell in the paper — an ablation across domains.

**Candidate specialties (pick 1 first, more later)**:
- Numerical methods / signal processing (close to GW; reuses some data)
- ML systems (model serving, inference optimization — user's CS background)
- Mathematical derivations (Qwen-Math-7B base might outperform Gemma here — flag for comparison)

Each specialist gets the same eval harness expansion + quantization curve.

---

## 5. Decision Flow Across Phases

```
                    ┌────────────┐
                    │  Phase 0   │
                    │ Eval harn  │
                    └─────┬──────┘
                          │
                  ┌───────▼─────────┐
                  │ Rubric reliable │
                  │   Cohen's κ≥0.6 │
                  └───┬─────────┬───┘
                  yes │         │ no
                      ▼         ▼
              ┌─────────┐   ┌─────────────────┐
              │ Phase 1 │   │ Tighten rubric  │
              │baseline │   │ +5 days TOPS    │
              └────┬────┘   │ then commit     │
                   │        └─────┬───────────┘
                   ▼              │
        ┌──────────────────┐      │
        │ Failure-mode     │◄─────┘
        │ class for spec?  │
        └──┬──────────┬────┘
        no │          │ yes
           ▼          ▼
   ┌────────────┐  ┌──────────┐
   │ Skip to    │  │ Phase 2  │
   │ Phase 4    │  │ Single   │
   │ MCP only   │  │ spec FP16│
   └────────────┘  └────┬─────┘
                        │
                ┌───────▼─────────┐
                │ Verifier >+10%  │
                │ on GW subset?   │
                └───┬─────────┬───┘
                 no │         │ yes
                    ▼         ▼
            ┌───────────┐  ┌──────────┐
            │ Pivot:    │  │ Phase 3  │
            │ MCP-only  │  │ Quant    │
            │ architec- │  │ study    │
            │ ture is   │  │ ← PAPER  │
            │ the artif.│  └────┬─────┘
            └───────────┘       │
                        ┌───────▼─────────┐
                        │ Useful knee?    │
                        └───┬─────────┬───┘
                            │         │
                       Q4-Q3│         │only Q8
                       knee │         │usable
                            ▼         ▼
                   ┌─────────────┐ ┌────────────┐
                   │ Strong      │ │ Negative   │
                   │ positive    │ │ result —   │
                   │ result —    │ │ still      │
                   │ scale to    │ │ publish-   │
                   │ Phase 5     │ │ able       │
                   └─────────────┘ └────────────┘
```

---

## 6. Resource Plan

### Compute

| Phase | Activity | GPU type | Hours | Approx cost (rented) |
| ----- | -------- | -------- | ----- | -------------------- |
| 0     | Eval grading (no GPU) | none | 0 | $0 |
| 1     | Baseline runs (API only) | none | 0 | $0 |
| 2     | LoRA training, Gemma-4-31B, FP16 | 1× A100 80GB | ~12-24 | $20-50 |
| 2     | Verifier inference (eval pass) | local (user's GPU) | ~10 | $0 |
| 3     | PTQ quantization (no training) | local CPU/GPU | ~2 | $0 |
| 3     | QAT runs × 6 bit depths | 1× A100 80GB | ~36-60 | $75-150 |
| 3     | Eval inference passes × 12 variants | local | ~20 | $0 |
| 4     | MCP-augmented eval | local + API | ~5 | $5-20 |
| 5     | Each new specialist | 1× A100 | ~30 | $60-100 |

**Total compute through Phase 4**: ~$100-250 (rented GPU) + $30-50 (API).

**If user has local 24GB+ GPU**: most inference is free; only training rentals are needed → ~$100-200 total.

### Memory / disk

- Gemma-4-31B at FP16: ~62GB on disk, ~62GB VRAM to serve
- Q4_K_M quantization: ~18-20GB on disk + VRAM
- Q8_0 quantization: ~32GB on disk + VRAM
- LoRA adapter: ~150-500MB per domain
- Eval data + telemetry: <10GB

User's existing Gemma 4 31B via ollama already covers the inference path.

### API budget

- Phase 1 baseline runs: 15 evals × 4 voices × ~$0.50 = ~$30
- Phase 2-3 specialist comparison runs: similar magnitude = ~$60
- Phase 4 with MCPs: API + MCP cost; Wolfram costs ~$0.005/call → negligible at this scale = ~$20
- **Total API spend**: $100-150 over the full project, well within Claude + Gemini Pro subscription limits

### Time

| Phase | Calendar weeks | Focused work hours |
| ----- | -------------- | ------------------ |
| 0     | 1              | 15-25              |
| 1     | 1              | 15-20              |
| 2     | 2              | 40-60              |
| 3     | 2              | 50-70              |
| 4     | 1              | 15-25              |
| **Total to first paper draft** | **~7 weeks** | **~135-200 hours** |
| 5+    | open-ended     | 30-50 / specialist |

Realistic calendar: 8-10 weeks accounting for delays, debug time, and paper writing overlap.

---

## 7. Tooling Stack

| Layer | Choice | Why |
| ----- | ------ | --- |
| Base model | Gemma-4-31B (user's existing) | already on disk; 31B is a reasonable spec ceiling at Q4 → ~18GB VRAM |
| Fine-tuning | LoRA via HF `peft` + `transformers`, or Unsloth for speed | Unsloth gives ~2× speedup on consumer GPUs; standard PEFT for portability |
| Training compute | RunPod / vast.ai / Modal (rented A100) | Cheaper than local 4090 for 24h jobs |
| QAT | LLM-QAT-style synthetic distillation, or LoRA + fake-quant ops | LLM-QAT is the closest published prior art |
| PTQ | llama.cpp GGUF (Q8_0, Q6_K, Q4_K_M, Q3_K_M, Q2_K) | Standard, fast, well-tested; matches ollama's serving format |
| Local serving | Ollama (already running) | OpenAI-compatible API, integrates with existing Council shim provider |
| Specialist endpoint | Ollama with custom Modelfile per quantization variant | Easy A/B swap |
| Eval harness | Hand-graded spreadsheet → JSONL → Python scoring | Resist the temptation to build a tool in Phase 0 |
| MCPs | arXiv-mcp (`andybrandt/mcp-simple-arxiv`), Wolfram Alpha MCP, E2B code-execution | All exist; pick + wire |
| Telemetry | `~/.openclaude/council-runs.jsonl` (Phase 1 of self-improving council backlog) | Already in BACKLOG; this project drives that work too |
| Plotting | matplotlib for paper figures | Standard |
| Paper writing | LaTeX (Overleaf) or Markdown→Pandoc | Either fine |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| **Phase 0 rubric never tightens** (can't reliably grade self) | medium | blocks everything | hard-stop at 2 weeks; commit to imperfect rubric and proceed |
| **Phase 2 LoRA fails to beat baseline at FP16** | medium-low | kills the specialist concept | most likely cause: insufficient data → aggressively pre-scrape arXiv + user's notes; second cause: wrong base model → swap to Qwen2.5-7B-Math for math-heavy claims |
| **Quantization curve is boring** (degrades smoothly with no knee) | medium | weaker paper | this is itself a publishable negative result; reframe as "the limits of small-model specialization under PTQ" |
| **Gemma 4 31B is not actually what user has** (might be Gemma 3 27B) | low | minor — switch base model | methodology is base-agnostic; rerun with 27B if needed |
| **Local GPU insufficient for serving 31B** | medium | inference must be rented | Q4_K_M of 31B is ~20GB → fits a single 24GB consumer GPU; only training needs rental |
| **MCP latency eats fault-tolerance margin** | medium | retries fail, runs incomplete | benchmark per-MCP latency before wiring; cache aggressively; raise voice timeout |
| **Catastrophic forgetting during FT** | medium | specialist loses general reasoning | mix 20-30% general instruction data during FT; validate against MMLU-Pro subset at each epoch |
| **Three months of infra, zero experiments** | medium-high | the highest risk | time-box Phase 0–1 hard to 2 weeks total. Imperfect measurement beats no measurement. |
| **Goodhart on the rubric** | low | inflated results | held-out eval set never seen during prompt iteration |
| **Paper rejection** | medium (always) | delays publication | aim for workshop submission first (NeurIPS ENLSP, ICLR ME-FoMo, etc.) then main venue |

---

## 9. Success Criteria

The project has succeeded if **any one** of the following is true at the end of Phase 4:

1. **System success**: the integrated system (frontier + verifier + MCPs) measurably beats the frontier-only baseline on the GW eval by ≥15% absolute, at <2× the cost per query.
2. **Research success**: the quantization curve has a useful knee at Q4 or better, and QAT extends the useful range by at least one bit-depth over PTQ. Publishable result.
3. **Negative-result success**: the quantization curve does *not* have a knee — specialists at Q4 and below are worse than no specialist — and this is the first carefully-controlled study to show that result. Still publishable as a workshop paper.

Project has failed only if:
- The eval harness is never reliable enough to draw conclusions, AND
- We did not publish anything from the experiments we did run.

That floor is low. The project is designed so that any path through Phase 0–4 yields *some* publishable artifact, even if it's a negative result or a system-paper rather than the headline quantization-curve result.

---

## 10. Outputs

### Engineering artifacts

- Trained Gemma-4-31B LoRA adapters (GW domain, then optional others)
- 12 quantization variants of the GW specialist as GGUF files
- Verifier service (Ollama Modelfile + Council integration)
- arXiv + Wolfram MCP wiring
- Eval harness + held-out test set
- Telemetry JSONL ledger

### Research outputs

- **Headline paper**: "Information-Preserving Quantization for Domain-Specialist Verification in Multi-Agent Scientific Reasoning" (target: NeurIPS Efficient Natural Language and Speech Processing workshop, or ICLR Mathematical and Empirical Foundations workshop, or main venue if results are strong enough)
- **System paper / workshop demo**: "Council + Co-Scientist: A Hybrid Frontier-Local Architecture for Cheap Scientific Debate" (target: NeurIPS demo track)
- **Open-source release**: full Council repo + specialist weights + eval harness + reproducibility scripts (a credibility multiplier for PhD applications)
- **Blog post / preprint** summarizing findings for non-academic audience

### Portfolio value

For PhD / research-job applications, this project produces all of:
- Problem identification (research question framing)
- System design (architecture + multi-tier integration)
- Empirical work (ablation study, reproducible experiments)
- Writing (paper + open-source documentation)

That fourfold demonstration of competence is much stronger than any individual piece.

---

## 11. What this roadmap depends on (and what it does not)

### Depends on

- User's existing Gemma 4 31B (via ollama)
- User's existing Claude + Gemini subscriptions (covers all API spend)
- User's existing literature review + research notes on GW quantization (the unique proprietary data)
- User's local GPU being ≥24GB VRAM, OR willingness to rent A100s for training (~$100 total)

### Does NOT depend on

- A specific advisor or institutional affiliation (helpful, not blocking)
- Any premium API tier (free/Pro tiers of Claude + Gemini are enough)
- Any custom infrastructure beyond ollama + git + a Python venv
- Co-Scientist being built (the verification-layer concept stands alone)
- The self-improving-council telemetry being live (we add it as part of Phase 1 to support this project)

---

## 12. Open questions to resolve before Phase 0

1. **Is "Gemma 4 31B" actually that, or is it Gemma 3 27B?** Run `ollama list` and confirm. Methodology survives either way but `BASE_MODEL_ID` everywhere must be the real name.
2. **What's the user's local GPU?** Determines whether Phase 2 fine-tuning can be done locally or needs rental.
3. **Will the user pre-commit to a specific submission venue?** Affects writing style + deadline pressure. Recommended: pick a workshop with a deadline ~8-10 weeks out as a forcing function.
4. **Is there an advisor / peer to involve for the rubric-design step?** Independent rubric scoring at Phase 0 is the single highest-value external input.
5. **Are there any IRB / data-sharing constraints?** Probably not (no human subjects, public arXiv data), but worth confirming if any of the user's notes were obtained under collaboration agreements.
