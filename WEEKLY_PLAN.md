# Weekly Plan — Quantized Domain Specialists for Multi-Agent Reasoning

> Companion to `ROADMAP.md`. Breaks the 5-phase plan into concrete week-by-week todos with hour estimates and decision gates. Format: each week has a goal, deliverables, todos with size estimates, and a *Friday check-in* question to ask yourself.

**Start date placeholder**: `__YYYY-MM-DD` (set when Week 0 prep is done)
**Target paper-ready milestone**: end of Week 7
**Total estimated focused-work hours**: 135-200

---

## Week 0 — Prep (3-5 days, can run alongside another project)

**Goal**: remove every blocker that would derail Week 1.

### Todos

- [ ] **Confirm base model identity** (15 min) — `ollama list`, copy exact model name. Document as `BASE_MODEL_ID` in `RESEARCH_PROPOSAL.md`.
- [ ] **GPU inventory** (15 min) — `nvidia-smi`, note VRAM. Decide: local training vs. RunPod/vast.ai. If local <24GB, sign up for RunPod and load $50 of credit.
- [ ] **Pick a target workshop venue + deadline** (30 min) — survey NeurIPS workshops, ICLR workshops, AAAI workshops with deadlines 8-12 weeks out. Bookmark CFP. (Recommended candidates: NeurIPS ENLSP, ICLR ME-FoMo, ICML AI4Science.) Put deadline on calendar.
- [ ] **Set up reproducibility hygiene** (1-2h) — fresh git branch `research/specialist-verifier`. Lock Python venv with `uv` or `poetry`. Pin transformers/peft/llama-cpp-python versions. `requirements-lock.txt` in repo.
- [ ] **Read 5 key sources to internalize methodology** (4-6h):
  - QLoRA (Dettmers et al. 2023)
  - LLM-QAT (Liu et al. 2023)
  - DAPT "Don't Stop Pretraining" (Gururangan et al. 2020)
  - AWQ (Lin et al. 2023)
  - Du et al. 2023 multi-agent debate
- [ ] **Identify 1-2 peer reviewers for the eval rubric** (1h) — ideally a domain peer (physics/ML) you can ask to blind-score 5 briefs in Phase 0. Even an undergrad with the right background works.

**Friday check-in**: *do I have everything I need to start Week 1 on Monday with zero "I should set up X first" friction?*

---

## Week 1 — Phase 0: Eval Harness

**Goal**: build the measurement instrument. No code. No model training. **The hardest week in disguise.**

### Todos

- [ ] **Draft initial rubric** (2-3h) — 5 dimensions: factual correctness, math correctness, citation quality, novelty, structural completeness. Each scored 0/1/2/3. Document edge cases in `eval/rubric.md`.
- [ ] **Generate / collect 25 candidate briefs** (4-6h) — run `/discover` on 25 research questions spanning GW physics, general physics, ML systems, mathematics. Save as `eval/briefs/01.md` through `25.md`.
- [ ] **First-pass scoring** (3-4h) — score all 25 briefs yourself. Write rubric edge-case notes as you go.
- [ ] **Refine rubric** (1-2h) — based on edge cases that confused first pass.
- [ ] **Second-pass scoring** (3-4h) — 7 days after first pass, re-score 5 randomly selected briefs (don't look at original scores). Compute Cohen's κ.
- [ ] **Peer blind-score** (1h of your time + 2h of theirs) — give peer 5 briefs (different from the κ subset). Compare their scores to yours; identify which rubric dimensions had highest disagreement and tighten those.
- [ ] **Final rubric lock** (1h) — commit `eval/rubric_v1.md` and don't change it for the rest of the project unless something is fundamentally broken.

### Friday check-in

*Cohen's κ ≥ 0.6 between my passes a week apart? If no — I extend to Week 1.5 max, then commit even if imperfect.*

### Deliverables

- `eval/rubric_v1.md` (locked)
- `eval/briefs/01.md` … `25.md`
- `eval/scores_pass1.csv`, `eval/scores_pass2.csv`
- `eval/notes.md` (rubric edge cases, peer feedback)
- κ computation in `eval/reliability_check.ipynb`

---

## Week 2 — Phase 1: Baseline Characterization

**Goal**: know exactly what the current `/discover` system gets right and gets wrong, by *type* of error.

### Todos

- [ ] **Score current `/discover` runs against rubric** (3-4h) — using the locked Week 1 rubric, formally score all 25 baseline runs.
- [ ] **Classify failures** (2-3h) — for each rubric dimension that scored ≤1, write a 1-sentence diagnosis. Cluster into failure-mode classes (math slip, citation hallucination, missing domain term, structural error, etc.).
- [ ] **Failure-mode counts table** (1h) — how many briefs had each class? Plot as a histogram. This is the central artifact of the week.
- [ ] **MCP vs. specialist hypothesis split** (2h) — for each failure-mode class, ask: would a Wolfram/arXiv MCP catch it? Would a domain specialist catch it? Both? Neither?
- [ ] **Cost + latency baseline** (1h) — capture per-run cost and per-voice latency from `/spend --today` and existing telemetry. We need these to compare against in Phase 2+.
- [ ] **Write up Phase 1 findings** (3-4h) — `phase1_baseline.md` in repo. ~3 pages. This is paper-quality writing; it will be reused.

### Friday check-in

*Is there a failure-mode class (≥3 of 25 briefs) where a specialist would plausibly help, distinct from what MCPs alone catch?*

- **If yes**: Phase 2 is justified. Proceed to Week 3.
- **If no**: skip Phase 2-3, jump to Phase 4 (MCP-only architecture). Rewrite roadmap with a pivot note.

### Deliverables

- `eval/baseline_scores.csv`
- `eval/failure_classes.md`
- `phase1_baseline.md` (writeup)
- Hist plot: failure-mode counts

---

## Week 3 — Phase 2 (Part 1): Data Prep + LoRA Setup

**Goal**: have everything ready to fire a LoRA training run.

### Todos

- [ ] **Corpus assembly for GW specialist** (8-12h, the biggest task of the week):
  - Scrape arXiv abstracts from `gr-qc`, `astro-ph.IM`, `eess.SP` (last 5 years, ~30K abstracts) — use the `arxiv` Python library
  - Optionally: full-text where OA license permits (`gr-qc` is usually fine)
  - Include user's literature review + unpublished notes (highest-value per token)
  - Selected textbook sections: Maggiore Vol 1 Ch 7-8 (data analysis), Creighton & Anderson relevant chapters
  - Format as JSONL with `{text, source, domain}` fields
  - Target: 50-150M tokens after dedup
- [ ] **Mix-in general instruction data** (1-2h) — 20-30% from FLAN or Alpaca to prevent catastrophic forgetting per Phase 1 risk register.
- [ ] **Set up training script** (3-4h) — based on Unsloth or HF PEFT examples. Document hyperparams in `training/config.yaml`: rank, alpha, learning rate, batch size, target modules.
  - Reasonable starting point: rank 64, alpha 16, lr 1e-4, batch size 4, grad accum 4, target modules q_proj/k_proj/v_proj/o_proj/gate_proj/up_proj/down_proj
- [ ] **Smoke test training** (1-2h) — 100 steps on a tiny subset, verify loss decreases. Save checkpoint, load it, verify it generates.
- [ ] **Prepare evaluation harness adapter** (2-3h) — wire the LoRA-loaded model as an OpenAI-compatible endpoint via vLLM or Ollama, accessible from Council shim provider.

### Friday check-in

*Could I kick off the real training run tomorrow without surprises?*

### Deliverables

- `training/corpus.jsonl` (~50-150M tokens, deduped)
- `training/config.yaml`
- `training/train.py` (smoke-tested)
- `training/eval_endpoint.md` (how to serve)

---

## Week 4 — Phase 2 (Part 2): Train + Validate FP16 Specialist

**Goal**: trained specialist, evaluated, decision gate hit.

### Todos

- [ ] **Full LoRA training run** (12-24h compute, ~2h hands-on) — A100 80GB rental. Monitor loss curve. Save checkpoint every 500 steps.
- [ ] **Train-eval split sanity check** (1h) — held-out 5% of corpus, verify the LoRA actually learned (perplexity should drop meaningfully on in-domain text).
- [ ] **Build claim-extractor module** (3-4h) — small wrapper that takes a frontier-voice output, asks a frontier model to extract quantitative claims as a JSON list. Used by the verifier downstream.
- [ ] **Wire verifier into `/discover`** (4-6h) — new role between Hypothesizer output and Synthesist input. Receives position, calls claim-extractor, calls specialist for each claim, annotates position with verifier verdicts.
- [ ] **Run eval pass on all 25 briefs with verifier enabled** (4-5h compute, mostly hands-off) — score against locked rubric.
- [ ] **Side-by-side analysis** (2-3h) — baseline scores vs. specialist-augmented scores. Per-failure-class delta. Did the specialist catch what we hypothesized in Phase 1?
- [ ] **Compute cost + latency overhead** (1h) — how much did adding the verifier cost / slow down?
- [ ] **Write up Phase 2 findings** (3-4h) — `phase2_specialist.md`. Paper-quality.

### Friday check-in / Gate 2

*Does the FP16 specialist improve in-domain eval scores by ≥10% absolute on the GW subset?*

- **YES**: proceed to Week 5 with confidence. The specialist concept is validated.
- **NO**: stop. Three possible diagnoses to investigate before pivoting:
  1. *Insufficient data* — corpus was too small or noisy. Re-scrape, retrain.
  2. *Wrong base model* — Gemma 4 31B may be too general; try Qwen2.5-7B-Math or DeepSeek-Math-7B-RL.
  3. *Architectural problem* — verifier prompt is bad, claim-extractor is missing things. Debug.
  - Budget 1 week max for diagnosis. If no fix found, pivot to MCP-only architecture (jump to Week 7).

### Deliverables

- `training/checkpoints/gw-specialist-fp16/` (LoRA adapter)
- `verifier/claim_extractor.py`, `verifier/specialist_verifier.py`
- `eval/phase2_scores.csv`
- `phase2_specialist.md` (writeup)

---

## Week 5 — Phase 3 (Part 1): Post-Training Quantization Sweep

**Goal**: PTQ curve across all bit-depths. The straightforward half of the quantization study.

### Todos

- [ ] **PTQ conversion pipeline** (3-4h) — script that takes FP16 LoRA + base model, merges adapter, exports to GGUF at each bit-depth via llama.cpp's `quantize` tool. Output: 6 GGUF files (Q8_0, Q6_K, Q5_K_M, Q4_K_M, Q3_K_M, Q2_K).
  - Note: also include FP16 baseline for comparison even though it's not "quantization"
- [ ] **Memory + load-time benchmark** (1h) — record VRAM usage + time-to-first-token for each variant. Useful for the paper's efficiency claims.
- [ ] **Eval pass for each variant** (15-25h compute total) — re-run the 25-brief eval with each quantized specialist as the verifier. Critical: same eval items, same frontier outputs to verify, only the specialist changes.
- [ ] **Out-of-domain eval expansion** (5-8h) — add ~10 MMLU-Pro physics questions to the eval set, run each variant against them. Tests whether quantization disproportionately hurts in-domain expertise vs. general reasoning (the interesting comparison).
- [ ] **Per-bit-depth failure analysis** (3-4h) — at each bit-depth, what *kinds* of errors does the specialist start missing? "Q4 still catches direction-of-proportionality errors but loses unit-checking" — this kind of qualitative finding is the heart of the paper.
- [ ] **Initial degradation curve plot** (2h) — preliminary version of the headline figure.

### Friday check-in

*Where is the knee? Is there a clear sweet spot in the curve?*

### Deliverables

- 6 GGUF files: `quants/gw-specialist-{q2_k,q3_k_m,q4_k_m,q5_k_m,q6_k,q8_0}.gguf`
- `quants/benchmarks.csv` (memory + latency per variant)
- `eval/phase3_ptq_scores.csv`
- `eval/failure_breakdown_per_bit.md`
- `plots/ptq_curve_v1.png` (preliminary)

---

## Week 6 — Phase 3 (Part 2): Quantization-Aware Training + Comparison

**Goal**: QAT counterpart to the PTQ curve. Compare PTQ vs. QAT at each bit-depth.

### Todos

- [ ] **Implement QAT training script** (4-6h) — LLM-QAT-style: distill from FP16 teacher (the Phase 2 specialist) into a quantized student. Or simpler alternative: LoRA + fake-quant ops on weights, train at target bit-depth directly.
  - Start with the simpler approach. If results are inconclusive, escalate to LLM-QAT.
- [ ] **QAT runs × 4 critical bit-depths** (24-48h compute total) — Q8, Q4, Q3, Q2. Skip intermediate Q5/Q6 unless time permits — the interesting comparison is the extreme regime.
- [ ] **Eval each QAT variant** (8-12h compute) — same protocol as Week 5 PTQ.
- [ ] **PTQ vs QAT comparison table + plot** (3-4h) — the central figure of the paper.
- [ ] **Statistical significance check** (1-2h) — at this sample size (25-35 evals per cell), bootstrap CI's; flag which differences are robust vs. noise.
- [ ] **Write up Phase 3 findings** (8-12h, parallel with other todos) — start *during* the experiments, not after. By end of week, draft of the quantization study should be ~6-8 pages.

### Friday check-in / Gate 3

*Does the curve have a useful knee at Q4 or better? Does QAT extend the useful range?*

- **Strong positive** (knee at Q4, QAT extends to Q3): celebrate, this is a NeurIPS-worthy result. Tighten Week 7 paper draft.
- **Moderate positive** (Q8 usable, Q4+ degrades): still publishable, frame as "specialization survives moderate quantization but breaks under aggressive PTQ; QAT recovers partial range." Workshop paper.
- **Negative** (curve drops monotonically, PTQ = QAT): publishable as negative result. "Limits of small-model specialization under quantization for multi-agent verification" — workshop / short paper.

### Deliverables

- `training/checkpoints/gw-specialist-qat-{q2,q3,q4,q8}/`
- 4 QAT GGUF files
- `eval/phase3_qat_scores.csv`
- `plots/ptq_vs_qat_curve.png` (headline figure)
- `paper/draft_v1.md` (~6-8 pages)

---

## Week 7 — Phase 4: MCP Integration + Paper Draft

**Goal**: final ablation cells filled (MCP + specialist), full paper draft, decision on Phase 5.

### Todos

- [ ] **Wire arXiv MCP** (3-4h) — install `andybrandt/mcp-simple-arxiv` or equivalent. Expose to Empiricist verifier. Verifier can issue paper-search queries when flagging citation claims.
- [ ] **Wire Wolfram MCP** (3-4h) — Wolfram Alpha account + MCP wrapper. Expose to Hypothesizer verifier. Automatically probe numerical claims.
- [ ] **Eval cells for MCP-augmented configs** (6-8h compute) — frontier+MCP (no specialist), frontier+specialist+MCP at best quantization level. Compare to Phase 2-3 results.
- [ ] **Interaction analysis** (2-3h) — where does MCP catch things the specialist missed? Where redundant? Where does specialist trigger MCP that wouldn't have been triggered otherwise?
- [ ] **Cost + latency analysis across all configs** (1h) — final efficiency table for the paper.
- [ ] **Paper draft v2** (16-24h, the dominant time sink of the week) — full structure: abstract, intro, related work (heavy use of `LITERATURE_REVIEW.md`), methodology, experiments, results, discussion, future work, references.
- [ ] **Share draft with peer for feedback** (1h your time) — same person who helped with Phase 0 rubric review, ideally. Their job: spot obvious holes, demand the figures explain themselves.
- [ ] **Decision on Phase 5** (1h reflection at end of week) — has Phase 2-3 result strength justified scaling to a second specialist? Or focus on tightening the paper instead?

### Friday check-in

*Is the paper draft good enough to submit to the chosen workshop with 2 more weeks of polish? If not, what specific thing is missing?*

### Deliverables

- MCP-integrated verifier (arXiv + Wolfram)
- `eval/phase4_mcp_scores.csv`
- `plots/final_ablation_matrix.png`
- `paper/draft_v2.md` (~10-14 pages, near-submission quality)
- Decision document on Phase 5

---

## Week 8 — Polish + Submit (or Phase 5 Start)

**Path A — Submit path** (if Week 7 paper draft is close to ready):

- [ ] **Address peer feedback** (4-6h)
- [ ] **Tighten figures** (4-6h) — every figure needs a 1-sentence caption that conveys the finding without reading the body
- [ ] **Related work polish** (3-4h) — use `LITERATURE_REVIEW.md` as base, ensure citations are properly placed in the paper
- [ ] **Reproducibility appendix** (3-4h) — hyperparams, hardware, exact compute used, links to checkpoints + code
- [ ] **Final read-through + spell-check** (2-3h)
- [ ] **Submit** (1h, the easy part)
- [ ] **Push everything to public repo** (2h) — code, models (via HuggingFace), eval set
- [ ] **Write blog post / preprint thread** (3-4h) — for the audience that won't read 14 pages

**Path B — Phase 5 start** (only if Phase 2-3 was strongly positive and submission deadline is far):

- [ ] **Pick second specialty** (1h) — recommended: numerical methods / signal processing (closest to GW)
- [ ] **Corpus assembly for second specialist** (8-12h, mirrors Week 3)
- [ ] **Training + eval** (~10-15h hands-on across the week)
- [ ] **Cross-specialist comparison** (4-6h) — does the specialization story replicate? Is there a domain effect we couldn't see with just one?
- [ ] **Update paper with second-domain ablation row** (4-6h)

---

## Week 9+ — Extension + Iteration

**If Path A in Week 8**: deadline pressure is off. Use this time to:

- Build the second specialist anyway (becomes follow-up paper or stronger camera-ready version)
- Wire the Co-Scientist closed-loop architecture from `CO-SCIENTIST.md` and run the system at scale
- Add the self-improving-council telemetry layer (Phase 1 of that backlog entry) as a longitudinal study

**If Path B in Week 8**: continue Phase 5 for one more specialist, then converge to Path A.

---

## Cumulative time budget tracking

| Week | Phase | Hands-on hours | Compute cost | API cost | Cumulative ($) |
| ---- | ----- | -------------- | ------------ | -------- | -------------- |
| 0    | Prep  | 8-12           | $0           | $0       | $0             |
| 1    | P0    | 15-25          | $0           | $0       | $0             |
| 2    | P1    | 12-18          | $0           | $10-30   | $10-30         |
| 3    | P2.1  | 15-22          | $0           | $0       | $10-30         |
| 4    | P2.2  | 25-35          | $20-50       | $30-60   | $60-140        |
| 5    | P3.1  | 20-28          | $5-15        | $5-15    | $70-170        |
| 6    | P3.2  | 30-40          | $50-100      | $5-15    | $125-285       |
| 7    | P4    | 30-40          | $5-15        | $20-40   | $150-340       |
| 8    | Subm./P5 | 20-30       | $5-50        | $5-30    | $160-420       |

**Headline numbers**: ~135-200 hands-on hours, $160-420 total spend, ~8 weeks to submitted paper.

---

## Working-style notes

### Calendar protection

- **Phase 0–1 are deceptively hard.** Resist the urge to compress them. The eval harness is the single most leveraged piece of infrastructure in the entire project.
- **Don't ship the LoRA the same week you trained it.** Sleep on results; the next-day re-read catches errors.
- **Weekly writeups are non-negotiable.** Even if rough. The paper draft is just the union of 7 weekly writeups + glue prose.

### When to ask for help

- *Rubric design (Week 1)*: domain peer with familiarity in the eval domain.
- *Hyperparameter sanity check (Week 3)*: anyone who has done LoRA before.
- *Statistical analysis (Week 6)*: someone who actually knows bootstrap CIs; common mistake to over-interpret n=25 results.
- *Paper feedback (Week 7-8)*: same domain peer; ideally an academic at any stage who has written ML papers.

### Anti-patterns to watch for

- **Tool-building in Phase 0.** If you find yourself writing more than 100 LOC for the eval harness in Week 1, stop. Use a spreadsheet.
- **Premature optimization in Phase 2.** First training run can be sub-optimal; the goal is signal, not perfection.
- **Hyperparameter tuning without held-out eval.** Every "let me try a smaller LR" needs a held-out check, or you're overfitting to the eval set.
- **Three failures in a row without diagnosis.** If experiments fail unexpectedly three times running, stop and write down what's going on. Don't just keep tweaking.

### Backup plans

- **If Gemma 4 31B doesn't quantize well at Q4** (some models are quantization-hostile): retry with Qwen2.5-7B + same LoRA pipeline. 7B at Q4 is more permissive; smaller model = less to compress poorly.
- **If RunPod/vast.ai is unavailable**: Modal and Lambda Labs are alternatives. Have a backup account loaded.
- **If MCP servers fail at Phase 4**: the Wolfram and arXiv probes can be implemented as direct API calls without MCP — same data, less protocol layer. Acceptable for the paper, just note as "MCP-equivalent direct integration."
