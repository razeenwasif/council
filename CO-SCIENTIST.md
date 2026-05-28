# Co-Scientist — Target Architecture

A multi-agent system for scientific research and discovery, inspired by Google's
AI Co-Scientist architecture (see `assets/Screenshot 2026-05-29 085929.png`).

Where **Council** (`COUNCIL.md`) optimizes for *engineering decisions* — fan out,
synthesize, write a diff — and **Debate** (the `/discover` flow shipped in
`feat/discover`) optimizes for *single-question position evolution*, Co-Scientist
optimizes for a much longer horizon: take a fuzzy research goal, generate many
hypotheses, evaluate them through repeated reflection + ranking + evolution
cycles, and surface a curated research overview the human scientist can act on.

Debate is a single-pass deliberation. Co-Scientist is a closed-loop tournament
that runs until the hypothesis pool stops improving (or budget runs out).

## Architecture

```
┌───────────┐                                                  ┌─────────────────┐
│ Scientist │──Research goal─→ Configuration ─→ Supervisor ─→  │ Research        │
└───────────┘                                       │          │ overview (with  │
      ▲                                             │          │ detailed hyps)  │
      │ Additional feedback                  Assign agents     └─────────────────┘
      │                                       to workers
      │                                             ↓
      │                              ┌──────────────────────────┐    ┌─────────┐
      │                              │  Co-Scientist agents     │    │ Worker  │
      │                              │  ┌───────────┐ ┌──────┐  │←→  │ Worker  │
      └──[AI]←──────────────────────│  │Generation │ │Proxi-│  │    │ Worker  │
                                     │  └─────┬─────┘ │mity  │  │    └─────────┘
                                     │        ↓       └──┬───┘  │
                                     │  ┌───────────┐   ┌▼─────┐│
                                     │  │Reflection │←──│Meta- ││    ┌─────────┐
                                     │  └─────┬─────┘   │review││    │ Context │
                                     │        ↓         └──┬───┘│    │ Memory  │
                                     │  ┌───────────┐   ┌──▼───┐│←─→ │         │
                                     │  │ Ranking   │──→│Evolu-││    └─────────┘
                                     │  └───────────┘   │tion  ││
                                     │                  └──────┘│
                                     └──────────────────────────┘
```

## Components

### Human-facing

| Component             | Role                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Scientist**         | Provides the research goal (free text), supplies optional context files, reviews the brief, gives feedback.  |
| **Configuration**     | Per-run knobs: tournament rounds, hypothesis-pool size, cost ceiling, allowed search tools, output format.   |
| **Research overview** | The final artifact — top hypotheses ranked, with reasoning, evidence, open questions, and suggested next experiments. Persisted as markdown. |
| **Additional feedback** | A second-pass loop where the scientist marks hypotheses as compelling / wrong / underexplored. The Supervisor re-runs targeted agents to act on that feedback. |

### Orchestration

| Component           | Role                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Supervisor**      | Plans which specialized agent to invoke next, allocates Workers, decides termination.             |
| **Workers**         | Parallel execution slots. The Supervisor enqueues agent invocations onto Workers.                 |
| **Context Memory**  | Append-only shared state: hypothesis pool, review notes, ranking scores, Elo ladder, run history. Every specialized agent reads + writes here. |

### Specialized agents (the inner loop)

These six are what makes Co-Scientist more than a Debate run. The Supervisor invokes them in a *loop* — not in a fixed pipeline — until termination.

| Agent             | Role                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Generation**    | Produces new hypotheses from the research goal + current literature + the Meta-review's "what's still missing" signal.               |
| **Reflection**    | Reviews each hypothesis individually: correctness, novelty, falsifiability, alignment with prior evidence. Produces a structured critique. |
| **Ranking**       | Tournament-style Elo comparisons between hypothesis pairs. Outputs a partial ordering of the pool.                                   |
| **Proximity**     | Clusters hypotheses by semantic similarity. Used to detect coverage gaps and to prevent the Evolution agent from collapsing diversity. |
| **Evolution**     | Refines the top-ranked hypotheses: simplification, recombination across clusters, sharpening of claims, fixing flaws Reflection caught. |
| **Meta-review**   | Aggregates across all Reflection outputs to find recurring failure modes, missing angles, and patterns the individual reviews missed. Feeds back into Generation. |

## Model recommendations

Model choice matters more here than in Council because the inner loop runs each
specialized agent dozens of times. A 5× cost-per-call difference in Ranking
agent compounds over a tournament.

Two columns: a default (good quality, sensible cost) and a budget tier (when running
many cycles or exploring a question that isn't worth opus-tier hypothesis cost).

| Agent          | Default                  | Budget                   | Why                                                                                                                                                |
| -------------- | ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supervisor** | `claude-sonnet-4-6`      | `gemini-3.5-flash`       | Orchestration loop — needs structured reasoning over the pool state, but is invoked frequently. Sonnet hits the cost/quality sweet spot.           |
| **Generation** | `claude-opus-4-7`        | `mistral-large-latest`   | Generative diversity is the bottleneck for the whole system. Pay for the strongest generative model you can afford — output quality compounds.    |
| **Reflection** | `gpt-4.1-mini`           | `gemini-3.5-flash`       | Critique is a high-volume, structured task. We already use `gpt-4.1-mini` as Critic in Council with strong results. Cheap + consistent matters more than raw power. |
| **Ranking**    | `gemini-3.5-flash`       | `gemini-3.5-flash`       | Pairwise comparisons must be *calibrated* and *cheap* — tournaments are O(n²) at worst. Don't burn opus tokens picking winners.                    |
| **Proximity**  | embeddings + cluster     | embeddings + cluster     | **Don't use an LLM** as the primary clusterer. Use an embeddings model (`text-embedding-3-large` or Gemini equivalent) + k-means / HDBSCAN. Only call an LLM to *name* clusters after the fact. |
| **Evolution**  | `claude-opus-4-7`        | `claude-sonnet-4-6`      | Recombination + refinement needs to hold many positions in working memory and rewrite without losing nuance. Opus's long-context handling is the differentiator. |
| **Meta-review**| `gemini-3.5-pro` (1M ctx) | `claude-opus-4-7` (1M ctx) | Aggregates hundreds of reflection outputs. Wants native long-context summarization. Gemini Pro 1M is the cheapest 1M-context option for this volume. |

### Total-cost calibration

For a 10-cycle run over a pool of 20 hypotheses:

- **Default tier**: ~$3–6 per run (dominated by Evolution + Generation).
- **Budget tier**: ~$0.50–1.50 per run.
- **All-Opus tier (don't)**: $20+, and the Reflection/Ranking outputs are not measurably better.

## Comparison to what's already shipped

| System            | Pattern                                       | Voices    | Rounds | Output                | When to use                                                          |
| ----------------- | --------------------------------------------- | --------- | ------ | --------------------- | -------------------------------------------------------------------- |
| **Council**       | Fan-out → synthesize → execute → review       | 7 + 1 + 1 | 2 (propose + review) | Code diff             | "Make me change X in this codebase."                                |
| **Debate** (`/discover`) | Fan-out × N rounds with position evolution | 4 + 1     | 2 → Synthesist | Research brief (markdown) | "Help me think harder about a single research question."           |
| **Co-Scientist** *(planned)* | Closed-loop tournament with 6 specialized agents over a hypothesis pool | 6 specialized + Supervisor | Many (until termination) | Research overview with ranked hypotheses + feedback loop | "Generate and evaluate many hypotheses for a fuzzy research goal — and iterate with my feedback." |

Co-Scientist subsumes Debate's use cases but with much higher cost — Debate
remains the right tool for a single sharp question with a known angle.

## Implementation roadmap

A reasonable order — each step is independently useful.

1. **Pool data model + Context Memory.** Append-only JSON/JSONL store of hypotheses with `{id, text, parents, scores, status}`. This is the load-bearing primitive; every agent reads and writes it.
2. **Single-shot Generation + Reflection.** Start with the simplest closed loop: Generation produces N, Reflection critiques each, output the critiqued pool. No tournament yet. This is essentially "Debate with a structured pool" and can reuse most of the debate adapters.
3. **Ranking via pairwise tournament.** Add the Elo ladder. Only `n × log(n)` matches per cycle, not full O(n²). The most non-trivial component to get right — calibration matters.
4. **Proximity (embeddings + clustering).** Add diversity tracking. Block Evolution from operating on a single cluster until coverage thresholds are met.
5. **Evolution.** Refinement of top-K. Crucially, *don't drop unrefined hypotheses* — keep them in the pool with a generation marker so Reflection can still surface them later if the pool collapses.
6. **Meta-review.** The signal back to Generation. This is what turns the system from a one-shot pool into an iterative search.
7. **Supervisor loop + termination.** Pool-stability heuristic: stop when top-K Elo hasn't reordered in two cycles, or cost ceiling reached, or `--max-cycles` hit.
8. **Scientist feedback loop.** Slash command (`/feedback <id> compelling|wrong|underexplored`) that targets Reflection + Evolution at marked items.

Each step ships its own slash command and brief format. By step 2 you have a
usable system; the later steps are quality improvements.

## Tunable constants (initial guesses)

These mirror the Debate constants pattern (see `R1_QUORUM`, `R2_QUORUM` in
`debate.ts`). Live-tune after the first few runs.

| Constant                     | Default | Reason                                                                  |
| ---------------------------- | ------- | ----------------------------------------------------------------------- |
| `POOL_SIZE_TARGET`           | 20      | Below 10, the tournament is noisy; above 30, costs explode.             |
| `GENERATION_BATCH`           | 5       | Per Supervisor decision.                                                 |
| `REFLECTION_PARALLELISM`     | 4       | Concurrent reviews; matches Worker count.                                |
| `RANKING_MATCHES_PER_CYCLE`  | `2n`    | Each hypothesis plays ~2 matches per cycle — enough to settle Elo over multiple cycles without blowing up cost. |
| `EVOLUTION_TOP_K`            | 5       | Number of hypotheses evolved per cycle.                                  |
| `MAX_CYCLES`                 | 8       | Termination guard; most runs converge by 5.                              |
| `COST_CEILING_USD`           | $5.00   | Above-budget runs should be opt-in via `--budget`.                       |
| `SUPERVISOR_TIMEOUT_MS`      | 300_000 | Same as Debate.                                                          |

## Fine-tuning a domain-specialist model

The model table above assumes off-the-shelf frontier models. A separate
investment worth tracking: **fine-tuning a single open-weights base model on a
combined Physics + Chemistry + Biology + Computer Science corpus**, then routing
the heavy-volume roles (Generation, Reflection, Meta-review) to it.

### Why

- **Domain density.** Frontier models are generalists. A 70B model fine-tuned on STEM papers will out-reason GPT-4-class generalists on in-domain hypotheses while staying cheap per call.
- **Cost compounding.** The inner loop runs Generation + Reflection dozens of times per cycle. A self-hosted 70B at ~$0.001/1k tokens replaces a Claude Opus call at ~$0.015/1k tokens — a 15× shift on the highest-volume call sites.
- **No data leakage.** Self-hosted means proprietary or unpublished hypotheses stay local. Matters more for the Scientist-feedback loop than for the initial generation.
- **Targeted weakness fixes.** Specific failure modes observed in `/discover` runs (e.g. the `V ∝ ρ⁻³` direction-of-proportionality slip in the GW quantization brief) can be addressed by training on the *exact* class of reasoning step that failed. Frontier models can't be patched this way.

### Corpus

| Domain          | Sources                                                                                            | Scale (rough)   |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| **Physics**     | arXiv (`physics`, `astro-ph`, `cond-mat`, `hep-th`, `gr-qc`, `quant-ph`)                            | ~2M papers      |
| **Chemistry**   | arXiv (`physics.chem-ph`), PubChem, ChemRxiv, selected JACS / Angewandte abstracts                 | ~500K papers    |
| **Biology**     | PubMed Central OA, bioRxiv, OpenAlex bio venues                                                    | ~5M papers      |
| **CS**          | arXiv (`cs.*`), ACL Anthology, top-tier conference proceedings (NeurIPS, ICML, ICLR, STOC, OSDI)   | ~1M papers      |
| **Textbooks**   | Open-access textbooks (LibreTexts, OpenStax) for foundational grounding                            | ~10K books      |
| **Reasoning traces** | Hand-curated step-by-step derivations + worked problems for SFT phase                          | ~50K examples   |

Total: ~100–200B tokens of raw corpus; ~10–20B after deduplication and quality filtering.

### Base model + training stack

| Choice                       | Recommendation                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base**                     | `Qwen2.5-72B` or `Llama-3.1-70B`. Both are open-weights, strong baseline, and have working long-context variants.                              |
| **Method**                   | Continued pretraining (CPT) on raw corpus → SFT on reasoning traces → DPO on hypothesis-quality pairs harvested from `/discover` runs.        |
| **Parameter-efficient?**     | LoRA / QLoRA for the first iteration (cheap, ~$5K compute). Full fine-tune only if LoRA shows measurable gains and is worth the ~$50K spend. |
| **Training infra**           | 8× H100 cluster rented (Lambda, RunPod, Modal). LoRA on 70B fits comfortably; full FT needs 16–32× H100.                                       |
| **Hosting**                  | vLLM or TGI behind an OpenAI-compatible shim — drops directly into the existing provider override pattern. Or Together/Fireworks if hosting in-house is overkill. |
| **Quantization for serving** | INT8 or AWQ for inference. (Relevant to the user's own research — gives a real downstream artifact for the GW quantization work.)             |

### Which roles to route to it

Not all roles benefit equally — orchestration and ranking want calibration over
raw domain knowledge.

| Role           | Use fine-tuned model? | Reason                                                                                                       |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Supervisor     | No                    | Orchestration logic is domain-agnostic. Stick with `claude-sonnet-4-6`.                                       |
| Generation     | **Yes**               | Highest value — domain priors compound. Replace `claude-opus-4-7` here first.                                 |
| Reflection     | **Yes**               | Critique benefits from knowing the domain's failure modes (e.g. unit slips, wrong scaling laws).             |
| Ranking        | No                    | Wants calibrated, consistent judgment. Off-the-shelf `gemini-3.5-flash` stays better-calibrated than a freshly-trained model. |
| Proximity      | N/A                   | Embeddings layer, not generation.                                                                            |
| Evolution     | **Yes**               | Recombination across domain-specific concepts is where a fine-tuned model differentiates from a generalist.   |
| Meta-review    | Maybe                 | Long-context aggregation; only worth it if the FT model's long-context retention is preserved post-training. Test before committing. |

### Risks + caveats

- **Catastrophic forgetting.** CPT on a narrow corpus can wreck general instruction-following. Mitigation: mix in 20–30% general instruction data during SFT, and validate against a held-out instruction-following benchmark each epoch.
- **Evaluation is hard.** "Better at physics" is not a benchmark. Build a held-out test set from existing `/discover` brief evaluations — Hypothesizer / Empiricist / Devil's Advocate outputs scored by you for correctness. Use this as the primary signal, not perplexity.
- **Training cost is up-front; inference savings only pay back after sustained use.** LoRA + serving at low volume probably doesn't pay back vs. just using Claude Opus. The break-even is somewhere around 1M+ tokens/day of Generation traffic.
- **Cutoff drift.** Fine-tuned model is frozen at its training cutoff. Frontier models keep updating. Plan for a quarterly refresh, or accept the staleness.

### Phased rollout

1. **Eval harness first.** Before training anything, build the held-out benchmark from existing `/discover` brief evaluations. Without it, you can't tell if a trained model is actually better.
2. **LoRA proof-of-concept on Qwen2.5-7B.** Cheap (<$200), fast (<24h on 4× H100). Goal: show that domain CPT moves the eval needle at all.
3. **LoRA on 72B.** ~$3K, ~3 days. If 7B showed signal, scale up. Wire as a provider override for the Generation role only. Run side-by-side `/discover` cost-comparison runs.
4. **Full fine-tune.** Only if (3) shows >2× cost-efficiency at equal quality on the eval harness. ~$30K–$50K compute.
5. **DPO loop.** Once the system is running, harvest position-quality preference pairs from `/discover` runs (highly-ranked vs. low-confidence Synthesist judgments) and use them as DPO training data. This is the closed-loop improvement step.

## Open questions

- **Reflection prompts.** Council's Critic + Skeptic prompts are the closest analogue, but reflection on a *scientific hypothesis* is a different mode than reflection on a *code change*. The prompts will need a research-domain rewrite — falsifiability, mechanism, prior-art alignment.
- **Embedding provider.** We don't currently call any embedding API. Adding one means a new provider integration; either pick something cheap (OpenAI `text-embedding-3-small`) or pure-LLM-call clustering with calibration on a small held-out set first.
- **Cost ledger granularity.** The Debate cost-ledger fix (commit `fd42a2c`) snapshots global cost via `getCurrentCost`; Co-Scientist will need per-cycle attribution to make Supervisor's termination heuristic budget-aware.
- **Tool access per agent.** Generation likely needs web search (literature). Reflection probably needs Read access to context files. Ranking + Proximity shouldn't have tools. Evolution probably no tools. Meta-review no tools. This shapes the AgentTool wiring.
