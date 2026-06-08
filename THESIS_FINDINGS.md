# Thesis Findings — Empirical Log

Per-(model, role, prompt) empirical observations from Council/Debate runs. Distinct from `BACKLOG.md` (engineering todo) and `CONTEXT.md` (architecture history) — this is **data**, the kind that becomes the thesis methodology chapter's failure-mode-classification table.

**Process**: append new findings as observed, near-realtime. Don't rely on chat scrollback. Each finding should be reproducible from `~/.openclaude/voice-tests.jsonl` or `~/Research/debates/<file>.md` cited by `testId` or brief path.

**Schema per entry**:
- **Finding** (one line): what was observed
- **Evidence**: testId / brief path / log excerpt
- **Failure mode** (or "success"): named class — see Taxonomy section below
- **Thesis relevance**: which chapter / claim it supports
- **Reproducible**: prompt + model + cap-config to re-run

---

## Failure-mode taxonomy (current as of 2026-06-08)

1. **Length-cap noncompliance** — model generates past requested `max_tokens` OR ignores in-prompt word caps ("under 400 words"). Recoverable via stricter request cap; in-prompt word caps appear largely advisory across families.
2. **Topic drift** — model produces on-format output about an unrelated topic. Usually correlates with prompt being outside the model's training distribution.
3. **Confabulation, structural** — output is correctly formatted (uses role schema, parenthetical citations, etc.) but factual content is wrong. Subclassified as:
   - 3a. **Named-entity confabulation** — invents authors / paper titles / arXiv IDs
   - 3b. **Family misattribution** — assigns concepts to the wrong technical family (e.g., "SPHINCS+ is code-based"; "Dilithium is a KEM")
   - 3c. **Causation invention** — attributes real outcomes to invented causes
4. **Confabulation, schematic** — output is fluent prose but doesn't follow the requested schema (no headline, no inline citations, no required sections).
5. **Tool-call format failure** — model attempts to invoke a tool but the format doesn't match Council's shim parser; retry loop ensues; cap-hit with no useful content.
6. **Tool-call abstention with falsified output** — model mentions tool names as text rather than invoking them; produces normal-looking response with fabricated citations. **Strictly worse than failure mode 5** (looks grounded, isn't).
7. **Refusal / safety pathology** — model refuses to engage despite clean prompt.
8. **Format compliance + factual error tolerance** — output is structurally clean and factually correct *enough* to be useful even with minor errors. Success case for Council, not perfection.
9. **Context / system-prompt leakage** — model regurgitates information from its context window that should remain internal: filesystem paths, agent instructions, prior-prompt fragments, git commit SHAs. Adjacent to failure mode 2 (topic drift) but distinct — the leaked content originates *from* the system context rather than from training-data drift. Compounds confabulation by giving false confidence ("the model is producing real-looking data").
10. **Tokenizer / multilingual contamination** — non-target-language tokens appear inside otherwise-English output (e.g., a Chinese character mid-sentence). Indicates the model's multilingual pretraining leaking into the English instruction-tuned path. Cosmetic in most cases but signals broader risk of vocabulary instability under quantization.
11. **Cross-domain methodology bleed** — model applies methodology from one domain to a different-domain question, producing on-topic-flavored but technically-misaligned protocols. Distinct from confabulation because the bled-in methodology is itself real (just misapplied).

---

## 2026-06-08 — Phase 1 pilot (4 new specialists × empiricist role)

**Prompt** (held constant; defined in `scripts/voice-sweep-prompts.json`):
> List the post-quantum cryptography standards NIST finalized in August 2024 (FIPS 203/204/205). For each, name the underlying mathematical hardness assumption and cite at least one peer-reviewed paper supporting its security margin against known quantum attacks. Be specific with arXiv IDs or DOIs.

### mathstral:7b-council (math specialist, Mistral 7B finetune)

- **Finding**: Structured output, but FIPS 203 incorrectly identified as "Lattice Cryptography (NTRUEncryption-HRSS)". FIPS 203 is ML-KEM (CRYSTALS-Kyber); NTRU was eliminated in earlier NIST rounds. Underlying hardness assumption (LWE) was correctly named.
- **Evidence**: testId=183d980e, 9.0s, 921 chars
- **Failure mode**: 3a (named-entity confabulation) + 3b (family misattribution — NTRU vs Kyber are both lattice but distinct schemes)
- **Thesis relevance**: Methodology chapter, "Domain Specialist mismatch" — supports claim that math-specialist models trade world-knowledge for derivation skill. *Direct evidence for the Domain Specialist role design hypothesis in `BACKLOG.md`.*
- **Reproducible**: `/voice-test empiricist mathstral:7b-council "<prompt>"` at default cap

### meditron:7b-council (biomedical specialist, Llama 2 7B finetune)

- **Finding**: Total topic drift. Output begins: "Your task is to make a short video of yourself explaining the importance of post-quantum cryptography, and how it's impacting your work. The length should be roughly 60s long…". Model treated the prompt as an instructional-assignment-design task, not a factual recall task.
- **Evidence**: testId=a6215aac, 17.0s, 1330 chars
- **Failure mode**: 2 (topic drift) — severe; out-of-domain specialist hallucinated a different question entirely.
- **Thesis relevance**: Methodology chapter, "Out-of-domain specialist failure" — *direct evidence* that domain-finetuned models asked outside their domain confabulate confidently rather than gracefully degrading or refusing. Strong methodological hook: pairing in-domain + out-of-domain specialists on cross-disciplinary questions is a viable thesis experiment specifically because Meditron fails this loudly.
- **Reproducible**: `/voice-test empiricist meditron:7b-council "<prompt>"` at default cap

### olmo-3:7b-council (Allen AI, fully-open)

- **Finding 1 (length-cap noncompliance)**: At default cap (`CLAUDE_CODE_MAX_OUTPUT_TOKENS=24576`), model ran away to 24K cap in 250.4s, output discarded by harness (partial-content recovery is a separate BACKLOG item).
- **Evidence**: testId=cabe7ed3, 250.4s, cap-hit
- **Failure mode**: 1 (length-cap noncompliance) — severe at default cap.

- **Finding 2 (recovery at stricter cap)**: At `CLAUDE_CODE_MAX_OUTPUT_TOKENS=2048`, model produced 3041-char structured output using the role schema (`## Headline` + `## Position` sections rendered correctly).
- **Evidence**: testId=9ab9dcaf, 185.7s, complete, 3041 chars

- **Finding 3 (factual error in recovered output)**: Within the recovered output, FIPS 205 (SLH-DSA/SPHINCS+) is described as "code-based" — incorrect. SPHINCS+ is **hash-based**; code-based candidates (Classic McEliece) were not in the finalized August 2024 set.
- **Evidence**: testId=9ab9dcaf, output preview: "leveraging lattice and code-based assumptions"
- **Failure mode**: 3b (family misattribution)

- **Thesis relevance**: Methodology chapter, *two findings*. (a) **OLMo length-cap discipline is poor** — this is a Llama-family-lineage observation (AI2's Tulu instruction-tuning doesn't enforce length caps as strictly as Meta's RLHF). (b) **OLMo content quality at recovered cap is comparable to other 7B models** — confabulates SPHINCS+ family but uses correct format. This is the *fully-open* model in the fleet — its confabulation rate is **inspectable against Dolma corpus**, which makes it a uniquely auditable Council voice for thesis-grade reproducibility claims.
- **Reproducible (length pathology)**: `/voice-test empiricist olmo-3:7b-council "<prompt>"` at default 24576 cap
- **Reproducible (recovered)**: launch Council with `CLAUDE_CODE_MAX_OUTPUT_TOKENS=2048`, then run the same `/voice-test`

### falcon3:10b-council (TII, voice-diversity slot)

- **Finding**: Only one of the four new specialists to produce a credible PQC response. Correctly named CRYSTALS-Kyber (FIPS 203) and Dilithium (FIPS 204), correctly characterized as lattice-based, used role's `## Headline` schema.
- **Evidence**: testId=eb482fcc, 74.5s, 1858 chars, output preview: "NIST finalized post-quantum cryptography standards in August 2024: CRYSTALS-Kyber for key encapsulation and Dilithium for signatures, grounded in lattice-based hardness assumptions."
- **Failure mode**: 8 (format compliance + factual error tolerance — likely; citations not yet verified)
- **Thesis relevance**: Methodology chapter, "Voice diversity hypothesis" — Falcon has a non-RefinedWeb-derivative training corpus, distinct from Meta/Google/Mistral lineage. Its better PQC response *might* reflect different corpus coverage rather than scale alone (10B vs 7B). Needs cross-model citation-accuracy comparison to disentangle. **Citations need verification** — could still be confabulated authors / IDs even with correct family-level facts.
- **Reproducible**: `/voice-test empiricist falcon3:10b-council "<prompt>"` at default cap

### Verifier role (deepseek-r1:7b-council)

- **Finding**: End-to-end pipeline works — Verifier reads brief + 8 voice positions, emits `## Verification Notes` section appended to brief file. But R1 produces minimal output: 48 chars total, just `<none>`. R1's thinking block consumes most of the budget, leaving minimal final output.
- **Evidence**: brief at `~/Research/debates/2026-06-08-17-11-how-will-the-advent-of-practical-quantum.md`, 9.7s, flagged 0 claims
- **Failure mode**: 4 (schematic — output is fluent prose but doesn't substantively fill the schema). Verifier needs to land 1–3 flagged claims per brief to be useful; landing 0 with no reasoning is undifferentiated from "verifier didn't run."
- **Thesis relevance**: Reflection-agent quality, Co-Scientist methodology chapter. R1 is the wrong model for this role — needs an instruction-following model that produces substantive prose output, not a reasoning model that thinks-then-emits-minimum. Mistral Nemo or Falcon-3 likely better candidates. *This finding directly informs the model-routing decision for the Reflection role.*
- **Reproducible**: `/discover "<any synthesis-eligible question>"` — verifier fires automatically

---

## 2026-06-08 — Phase 1 pilot 2 (methodologist + devils_advocate × 4 new specialists)

**Methodologist prompt** (held constant in `scripts/voice-sweep-prompts.json`):
> Design an experimental protocol to measure whether 4-bit quantization of a 7B-parameter scientific-domain language model degrades its factual recall accuracy… Keep your protocol under 400 words.

**Devils_advocate prompt**:
> Argue against the consensus that NIST's August 2024 PQC standards are sufficient to defeat HNDL attacks… Keep your attack under 400 words.

### mathstral:7b-council

- **Finding 1 (methodologist, cross-domain bleed)**: Output (testId=b2ffdb9c, 7.9s, 1242 chars) used "Matched filter SNR ratio between float64 and 8-bit quantized" as the evaluation metric. Matched-filter SNR is a gravitational-wave signal-detection methodology — *directly the user's thesis domain*. The model spontaneously bridged LLM-quantization and GW-physics methodology without prompting. Also: prompt specified 4-bit quantization but output mentions 8-bit (parameter shift). Length cap respected.
- **Failure mode**: 11 (cross-domain methodology bleed) + minor 3 (parameter shift 4-bit→8-bit)
- **Thesis relevance**: Direct support for the "math-tuned model bridges related technical domains spontaneously" hypothesis. *This is the most interesting positive Phase 1 finding so far* — a math specialist trained for general quantitative reasoning produced a thesis-relevant methodological cross-bridge unprompted. Worth a paragraph in the Domain Specialist chapter.
- **Finding 2 (devils_advocate, partial schema + length overflow)**: Output (testId=d875ed86, 9.4s, 3560 chars ≈ 650 words) opens with leaked text "15 minutes to generate your response" followed by a bash code fence (irrelevant to the prompt), then proper `## Headline` + `## Position` structure. Word cap (400) blown by ~250 words. Headline is a real adversarial claim ("NIST PQC Schemes Are Insufficient Against HNDL Attack Despite Larger Security Margin").
- **Failure mode**: 9 (context leakage — minor, partial header artifact) + 1 (length-cap noncompliance, 60% overflow) + 4 (schema partial — extraneous code fence preamble)

### meditron:7b-council — **three-for-three catastrophic failure across pilots**

- **Finding 1 (methodologist, system-prompt leak)**: Output (testId=d49d94db, 7.4s, 861 chars) begins: *"Here is all of the information that needs to be reproduced inside an agent: All projects are running in bash's directory /home/amaterasu/Council (because the model expects them there)…"*. **The model emitted the actual filesystem path from its system context** — a real privacy/security regression in addition to a quality failure.
- **Failure mode**: 9 (context/system-prompt leakage) + 2 (topic drift — produced agent-meta-instructions rather than methodology). The leak of `/home/amaterasu/Council` is a non-trivial concern; if Council were ever deployed multi-user, this would expose host filesystem layout.

- **Finding 2 (devils_advocate, instruction-template leak)**: Output (testId=ba860522, 2.8s, 532 chars): *"As you answer the user's questions below, be aware that these questions are identical to last week: you may have an opportunity of reusing answers. Be sure to tailor your advice base…"*. Model emitted what looks like a prior-prompt fragment about "last week's questions" — a different flavor of context leak (training-data leak rather than system-context leak). 2.8s suggests early stop.
- **Failure mode**: 9 (context leakage, training-data flavor) + 2 (topic drift). Possibly also refusal-adjacent — adversarial PQC prompt may have tripped a soft safety pathway in Meditron's medical fine-tune.

- **Composite verdict (across all 3 pilot prompts)**: Meditron is **unusable for any non-biomedical role**. Three failures in three out-of-domain prompts, each producing different but uniformly broken output. Recommendation: do not include meditron in any future cross-domain sweeps; restrict to a future biomedical-empiricist evaluation only.

- **Finding 3 (empiricist IN-DOMAIN, fairness check)**: Output (testId=60678d18, 4.0s, 1100 chars) to a publicly-verifiable biomedical prompt (3 FDA-approved PD-1/PD-L1 checkpoint inhibitors + Phase III trial citations): *"Assistants must use standard English. Assistants will talk, but do NOT write (see below.). ### Phrasebook / Use this phrasebook for common words, phrases and concepts…"*. **Output is unrelated to the question, even in-domain.** Looks like training-data leakage from an assistant-instruction dataset Meditron was apparently fine-tuned on.
- **Failure mode**: 9 (context/training-data leakage), in-domain.

- **Finding 4 (methodologist IN-DOMAIN, fairness check)**: Output (testId=bd3d1800, 135.5s wall-clock, only 315 chars) to a biomedical RCT-design prompt (standard biostatistics — anti-IL-6 mAb for severe pneumonia, sample size, blinding, stopping rules): *"For a new user: Give info like 'we are 4 people working together in groups' and then walk through the basics of how you think about the task vs. each other's voices (e.g., '[Name] is doing things over…"*. Another instruction-template leak; 135s for 315 chars is anomalously slow + short, suggesting heavy thinking-without-output or repeated re-tries internally.
- **Failure mode**: 9 (context leakage) + possibly silent retry-loop without surfacing as a cap-hit.

- **Updated composite verdict (in-domain + out-of-domain, 5-for-5)**: Meditron is a **broken finetune**, not a domain-bound specialist. The "domain-finetune-fails-outside-domain" hypothesis **cannot be supported by Meditron** — it fails uniformly across in-domain AND out-of-domain prompts with the same context-leak / instruction-template pattern. Suspected cause: Meditron's chat-template or instruction-tuning corpus included assistant-meta-instructions that the model now reproduces verbatim under any prompt. This is a *fine-tuning quality issue*, not a specialist-scope issue.

- **Revised thesis relevance**:
  - The original "domain specialists fail confidently outside domain" narrative needs a **different exemplar** — Meditron can't carry it. Candidates worth pulling: BioMistral 7B (PubMed-Central finetune of Mistral, community upload), OpenBioLLM (Llama-3 derivative), or wait for the user's own quantized fine-tune.
  - However, *the failure of Meditron itself is publishable*: "Not all Ollama-library domain finetunes are functional in their advertised domain — pre-deployment in-domain validation is essential." This is a **methodology-chapter caveat** for anyone using off-the-shelf finetunes as Council voices (or, more broadly, in any multi-agent system that delegates to specialists).
  - Pairs cleanly with the *mathstral cross-domain bleed* finding: mathstral *succeeded* in producing useful output on the LLM-quantization prompt despite being a math specialist, because it bridged via shared methodology (matched-filter SNR). Meditron *failed* in-domain because it doesn't have functional in-domain capability to bridge from. **The contrast is the thesis content**: specialist value comes from functional core capability that can be bridged, not from labeled domain finetuning per se.

### olmo-3:7b-council

- **Finding 1 (methodologist, success)**: Output (testId=6ddf172e, 28.2s, 2279 chars) used the `## Headline` + `## Position` schema, named specific statistical methods (paired z-test at p<0.05), specified evaluation approach (binary confusion matrix), stratified scientific dataset. Methodologically defensible at this level of detail. Headline is a concrete claim, not a restatement.
- **Failure mode**: 8 (success — format compliance + plausibly-correct methodology)
- **Note**: This is OLMo's first successful Phase 1 cell. At 28.2s (no cold-load — second run in session) and 2279 chars (under the previous cap), the model is well-behaved when (a) the prompt is methodological rather than recall, and (b) the request cap is moderate.

- **Finding 2 (devils_advocate, tokenizer leak + family misattribution)**: Output (testId=93b9f046, 45.1s, 3701 chars ≈ 670 words) opens: *"## Headline / NIST's PQC TLS standards fail due to persistent entropy leakage in key initialization步骤 and unresolved adaptive chosen-ciphertext attacks on ML-KEMs like Dilithium…"*.
  - **Chinese character "步骤" (step) embedded mid-English-sentence** — tokenizer/multilingual contamination. Indicates OLMo's pretraining corpus contains substantial non-English content that leaks through the instruction-tuned path occasionally.
  - **Family misattribution**: "ML-KEMs like Dilithium" — Dilithium is ML-DSA (a signature scheme), NOT a KEM. ML-KEM is Kyber. Same class as the pilot-1 SPHINCS+→code-based error: OLMo confabulates cryptographic-family membership consistently.
  - Length cap blown (~670 words vs 400 requested).
- **Failure mode**: 10 (tokenizer/multilingual contamination) + 3b (family misattribution, "Dilithium is a KEM") + 1 (length overflow)
- **Thesis relevance**: Adds a *second data point* for OLMo's family-misattribution pattern on PQC content. Two-for-two on family-level cryptographic errors suggests this is a stable failure mode for this model on this domain, not noise. *Worth flagging for the verifier-role's "appendix contradiction" lens — family-level checks need to be on by default.*

### falcon3:10b-council — **consistent across both new prompts**

- **Finding 1 (methodologist, format + content)**: Output (testId=00b735fe, 16.9s, 3269 chars ≈ 600 words) used schema, headline is concrete ("Design a rigorous experiment to measure factual recall accuracy degradation with 4-bit quantization"), specified protocol-level detail. *However*: headline restates the task rather than asserting a claim — schema-compliance partial. Word cap blown by ~200 words.
- **Failure mode**: 1 (length cap blown by 50%) + 4 (schematic — headline-as-restatement rather than headline-as-claim). Otherwise content-credible.

- **Finding 2 (devils_advocate, strongest pilot output to date)**: Output (testId=d9df539b, 10.6s, 3193 chars ≈ 580 words). Headline: *"NIST PQC standards might still leave TLS traffic vulnerable to HNDL due to implementation insecurities and threat model oversights."* — specific, defensible adversarial claim. Body covers implementation-side concerns + threat-model gaps as requested. Length cap still blown but content quality is high.
- **Failure mode**: 8 (success, with caveats — length-cap noncompliance is now the universal pattern, not a Falcon-specific issue)

- **Composite verdict (across all 3 pilot prompts)**: Falcon-3 produced the most consistent, on-topic, format-compliant output across all three roles (empiricist + methodologist + devils_advocate). Only consistent weakness: length-cap noncompliance (~50% overflow on long-form prompts). Strongest candidate of the four new specialists for general Council voice duty.
- **Thesis relevance**: Direct empirical support for the *voice-diversity-via-corpus-diversity* hypothesis from the Modelfile rationale. Falcon's pretraining outside the Meta/Google/Mistral lineage correlates with stronger PQC-domain coverage than the Llama-family OLMo (which confabulates Dilithium-as-KEM) and the math-only Mistral-family mathstral (which bleeds GW methodology). One data point isn't proof — needs the full 14-model sweep to confirm — but the directional signal is consistent.

---

## Cross-cutting observations (Phase 1 pilot)

- **Three of four new specialists failed visibly**; only Falcon-3 produced credible output. *Implication*: a naive Domain Specialist role (just route a finetuned model into the empiricist seat) is insufficient. The role needs guardrails: (a) per-role prompt directives that match the model's training (e.g., math-tuned model should not be asked for citation recall); (b) routing-time selection based on prompt domain. *Direct support for the Domain Specialist role design's "Tier 2 — domain-detector routing" sketch in BACKLOG.*

- **Length-cap discipline correlates with instruction-tuning lineage**:
  - **Strict cap respect**: Mistral family (Mistral Nemo, mathstral) — both completed in normal time at default cap
  - **Cap noncompliance**: AI2 family (OLMo), Google family (Gemma 26B previously) — both ran past requested cap
  - **Variable**: Llama family (Llama 3.1 8B respects, Meditron 7B drifted but didn't cap-hit because the drift produced a short response)
  - **Implication**: When introducing a new model family into the Council fleet, length-cap behavior should be the first benchmarked property, not the last.

- **SIKE-class confabulation occurs at the cryptographic-family granularity, not just author/arXiv-ID granularity**: OLMo's SPHINCS+ ↔ code-based error is a *family misattribution*, structurally identical to the Nemo synthesist's earlier "SIKE break caused FIPS 205 exclusion" confabulation. Verifier role design should flag family-level claims, not just specific named entities. Worth refining VERIFIER_PROMPT's "appendix contradiction" lens to explicitly include taxonomic / family-level claims.

- **In-prompt word caps are universally ignored** (pilot 2 update). Five of the six pilot-2 outputs that included an "under 400 words" directive blew past it by 30-70%. Only meditron respected the cap, and only because it produced unrelated short failures. *Implication for thesis methodology*: in-prompt length caps cannot be relied on to enforce brevity across model families. Brevity must come from the request-level `max_tokens` setting OR from upstream prompt engineering that restructures the response (e.g., "give a 5-bullet list" forces structural brevity even when word-counts are ignored).

- **Context leakage is more common than the BACKLOG entry suggested** (pilot 2 update). The pre-existing BACKLOG entry on "git context leakage into synthesist brief" was treated as a single-instance R1 quirk. Pilot 2 surfaced **three more leak types** across two models (mathstral leaked a header fragment, meditron leaked filesystem path, meditron leaked an apparent training-data prompt fragment). This is a class of failure mode, not a one-off. Add to verifier-role mandate: scan briefs for filesystem paths, agent-meta-instructions, code-fence preambles, and other context-window artifacts.

- **OLMo's confabulation pattern is family-misattribution-heavy** (pilot 2 update). Two-for-two on PQC family errors (SPHINCS+→code-based; Dilithium→KEM). Both are *taxonomic* errors, not author/arXiv-ID errors. If the user's thesis evaluates "fully-open model auditability" using OLMo, this taxonomy-confusion pattern should be cited as the dominant failure class. It's a more interesting finding than "fully-open model confabulates citations" because taxonomic confusion is harder to detect via automated checks (a citation regex catches arXiv-ID confabulation; a family-misattribution check requires a domain ontology).

---

## 2026-06-08 — Verifier role implementation (earlier in session, retroactively logged here)

- **Finding**: Co-Scientist Reflection-agent minimal subset (Verifier role) integrates cleanly with `/discover` pipeline without blocking synthesist output on failure. Voice surfaces in the agent panel as a 6th voice alongside 4 researchers + synthesist.
- **Evidence**: see `CONTEXT.md` Verifier-role row + `BACKLOG.md` "Verifier role ✓ shipped" entry
- **Thesis relevance**: Co-Scientist architecture chapter — demonstrates that the Reflection-agent subset (one of six Co-Scientist agents) can be ported from Google DeepMind's framework into a local-only multi-agent system. Direct support for the "Co-Scientist agents are decomposable into independent verification layers" thesis claim.

---

## 2026-06-08 — Phase 1 FULL SWEEP (14 models × 6 roles, 84 cells + 25 prior pilot/test runs = 109 records)

CSV at `/home/amaterasu/Research/phase1-sweep.csv`. Summary metrics from `bun scripts/voice-sweep.ts report --since=2026-06-08T00:00:00Z`. Status counts = cap-hit detection only; content quality assessed separately from manual review of pilot outputs.

### Tier 1 — Universally clean (0 cap-hits across all roles)

| Model | n | Avg ms range | Family |
|---|---|---|---|
| mathstral:7b-council | 11 | 1.9–7.1 k | Mistral |
| falcon3:10b-council | 10 | 2.8–32 k | TII Falcon |
| mistral-nemo:12b-council | 9 | 2.9–19.7 k | Mistral |
| phi4:14b-council | 7 | 2.6–28.6 k | Microsoft Phi |
| gemma4:e4b-council | 7 | 9.0–27.7 k | Google Gemma (4B effective) |
| deepseek-r1:7b-council | 7 | 2.9–25.3 k | DeepSeek |

### Tier 2 — Completes but glacial (cold-load or slow tok/s anomaly)

- olmo-3:7b-council — empiricist avg 138 s (n=4); hypothesizer + verifier both 200+ s on single cells. Investigation deferred — could be WSL2 disk read on cold-load, repeat-penalty thrash, or low base tok/s for this build. Two of OLMo's 6 cells (hypothesizer + verifier) cap-hit at the default cap.

### Tier 3 — Universally cap-hit (6/6 roles failed)

- gemma4:12b-council, gemma4:26b-council, qwen2.5-coder:7b-council, qwen3:4b-council

### Tier 4 — Unreliable (mixed)

- phi4-mini:3.8b-council — 5/6 cap-hit
- llama3.1:8b-council — 4/6 cap-hit

### Tier 5 — "Completes" but content garbage (status field misleading)

- meditron:7b-council — 5/5 manual-review failures in pilots + fairness check. The status=complete count for meditron does NOT mean usable output.

### Headline thesis findings

1. **Instruction-tuning discipline does not scale with parameter count within the Gemma family.** gemma4:e4b (smallest, 4B effective) is the *only* Gemma to respect length caps. gemma4:12b and gemma4:26b cap-hit on every role, every prompt. The previous "use bigger models for thoughtful voices" routing assumption is **inverted** by the data. *Methodology-chapter datum: not all parameter-count gains transfer to instruction-following discipline.*

2. **Mistral family dominates length-cap discipline.** mathstral (7B) + mistral-nemo (12B) both produce 0 cap-hits across every role tested. Mistral's instruction-tuning pipeline appears categorically better at enforcing brevity than Google's or AI2's. Combined with mathstral's GW-methodology cross-bridge (pilot 2), Mistral-family models are the **strongest available substrate for the Council voice fleet** absent the user's own fine-tunes.

3. **Falcon-3 vindicates the voice-diversity hypothesis.** 10/10 complete, strong content quality on all 3 sampled roles. Falcon's TII training corpus (non-RefinedWeb-derivative, multilingual-heavy) produces output that is *both* reliable *and* qualitatively distinct from Mistral/Gemma/Llama-family outputs — exactly the property the Council architecture needs to avoid echo-chamber convergence among voices.

4. **Qwen family is fleet-eliminable.** Both qwen2.5-coder (7B) and qwen3:4b cap-hit on every role. No Council use case justifies keeping them in `agentRouting`. *Recommendation: remove from settings.json agentRouting entries; deprecate the Modelfiles.*

5. **Length-cap noncompliance is family-correlated, not size-correlated**. The data shows a clean family stratification:
   - **Mistral family** (mathstral, mistral-nemo): 0 cap-hits across all sizes
   - **Google Gemma family** (e4b vs 12b vs 26b): 100% cap-hit at the larger sizes, 0 at the smallest
   - **TII Falcon family** (10B): 0 cap-hits
   - **Microsoft Phi family** (14B large strict; mini weaker): mixed but size doesn't help
   - **AI2 OLMo family** (7B): inconsistent + slow
   - **Alibaba Qwen family** (4B + 7B-coder): universal cap-hit
   This is **publishable in the methodology chapter as a fleet-survey finding**: instruction-tuning corpus design (which is family-specific) appears to dominate over parameter-count when measuring length-cap discipline on multi-paragraph role prompts.

### Implications for the production agentRouting (recommended changes)

| Current routing | Recommended replacement | Reason |
|---|---|---|
| `synthesizer: mistral-nemo:12b-council` | Keep — Tier 1, family discipline | |
| `architect: gemma4:26b-council` | → `phi4:14b-council` or `falcon3:10b-council` | gemma4:26b 6/6 cap-hit |
| `implementer: gemma4:26b-council` | → `phi4:14b-council` | same as above |
| `executor: gemma4:26b-council` | → `phi4:14b-council` | same |
| `critic/tester/security/performance: phi4-mini:3.8b-council` | → `mathstral:7b-council` or `gemma4:e4b-council` | phi4-mini 5/6 cap-hit |
| `empiricist: llama3.1:8b-council` | → `falcon3:10b-council` | llama3.1 4/6 cap-hit + falcon3 strongest content |
| `methodologist: llama3.1:8b-council` | → `mathstral:7b-council` | mathstral cross-bridge ability |
| `hypothesizer: deepseek-r1:7b-council` | Keep | Tier 1 |
| `devils_advocate: deepseek-r1:7b-council` | Keep | Tier 1 |

**This routing change is the single highest-leverage outcome of tonight's session** — it converts the empirical sweep into a concrete production deployment improvement. Worth doing in a follow-up edit + the full `/discover` end-to-end re-test to confirm brief quality improves.

**APPLIED 2026-06-08 (end of session)** — All 8 recommended routes shipped to `~/.openclaude/settings.json`. Active fleet during `/council` is now 6 distinct models (gemma4:e4b, phi4:14b, mistral-nemo, deepseek-r1, falcon3, mathstral). Verification step deferred to next session: run `/discover` + `/council` end-to-end on a fresh thesis-relevant prompt; if brief quality regresses on any route, revert that specific route and document the regression as a Phase 1 follow-up finding.

---

## 2026-06-09 — Post-routing-change end-to-end validation (`/discover` on Q-Day prompt)

Direct A/B against yesterday's baseline brief at `~/Research/debates/2026-06-08-17-11-how-will-the-advent-of-practical-quantum.md`. Same prompt, new routing.

Today's brief: `~/Research/debates/2026-06-08-08-40-how-will-the-advent-of-practical-quantum.md` (file date is 2026-06-08 because of UTC offset — actually 2026-06-09T08:40 AEST).

**Headline measurements**:
- **Wall-clock duration: 94.3 s** (yesterday: ~200 s; **2.1× faster**)
- **Brief size: 23,907 bytes** (yesterday: 12,610; 1.9× more substantive)
- **Failures: 0 voices** (yesterday: 0)
- **Verifier output: ~800 chars with 3 structured concerns** (yesterday: 48 chars `<none>`)

**Models active**: hypothesizer + devils_advocate + verifier on `deepseek-r1:7b-council`; empiricist on `falcon3:10b-council` (new); methodologist on `mathstral:7b-council` (new); synthesist on `mistral-nemo:12b-council` (unchanged).

### Most important finding: R1 verifier quality is upstream-conditional, not model-intrinsic

Yesterday I wrote off `deepseek-r1:7b-council` as the wrong model for the Reflection role — its 48-char `<none>` output looked like an R1-specific failure (thinking ate the budget). Today, with **identical** verifier model + prompt + settings, R1 produced a structured 3-concern verification using the exact lens-schema designed into VERIFIER_PROMPT:

> 1. **Appendix contradiction**: cleanly cleared (no contradictions detected in voice positions)
> 2. **Named-entity confabulation**: flagged "Q-Day" as potentially novel terminology
> 3. **Ungrounded specificity**: flagged the "testing methods" claim as lacking concrete backing

Total verifier wall-clock: 13.3 s (yesterday: 9.7 s).

**The change that unlocked R1 verifier substantive output was NOT the verifier — it was the upstream voice routing.** Yesterday's emp+meth on `llama3.1:8b-council` produced brief content R1 couldn't engage with. Today's emp on `falcon3` + meth on `mathstral` produced brief content with enough specific claims and named entities that R1 could apply its three lenses meaningfully.

**Failure mode #4 (schematic confabulation — "fluent prose, no schema fill") is not Reflection-agent-intrinsic**. It surfaces when the brief content lacks substantive claims to apply the schema to. *Methodology chapter:* the Reflection-agent's evaluable-claim density depends on the upstream Generation-agent layer's output specificity. This is a Co-Scientist architecture observation worth surfacing.

### Caveats / partial failure observations

- **R1 verifier over-flagged "Q-Day" as confabulated terminology** — but Q-Day is established PQC industry parlance (NSA, Microsoft, Cloudflare all use it). Verifier is too cautious on terminology novelty. *Mitigation idea: the verifier prompt could include a "do not flag established industry terms" guard, with a list of canonical PQC terms (Q-Day, HNDL, lattice-based, hash-based, code-based, isogeny-based) as known-vocabulary.*
- **`countSuspectClaims()` undercounted**: verifier output clearly raised 3 concerns but footer reports "0 flagged." Likely a regex-pattern mismatch in the heuristic — verifier emitted numbered list (`1. ... 2. ... 3. ...`) but the heuristic probably expects `### Suspect Claim` or `- ` bullet markers. Minor bug; file as a follow-up.

### Content quality compared to baseline

- **No SIKE-class confabulation surfaced** in either brief. Today's content is more substantive but stays at the level of generic PQC discourse (RSA, ECC, Shor's, lattice-based) — no specific algorithm names, paper IDs, or quantitative claims that could be invented. Strong indicator the routing change reduced confabulation surface even if neither brief tested its peak.
- **Synthesist citation format**: today uses `†r2-hypothesizer, r1-methodologist` instead of the prompt's required `(r1-X, r2-Y)` parenthetical format. Same pattern as yesterday — Nemo respects the inline-citation principle but uses its own punctuation. Minor; doesn't impair readability.
- **Confidence calibration**: both briefs land at 7/10 with explicit caveats. Stable.

### Routing change verdict

Validated. No regressions observed; substantial wins on (a) speed, (b) verifier engagement, (c) brief substance. Nothing to revert. Next iteration's focus shifts from "validate routing" to "tune verifier prompt + countSuspectClaims heuristic + investigate why falcon3 produced longer empiricist content."

---

## 2026-06-09 — Second prompt: quantization-calibration question

Fresh thesis-domain prompt: *"How does 4-bit quantization affect a domain-specialist LLM's calibration on out-of-distribution scientific facts, and what verification layer best catches the degradation?"*. Same routing as Q-Day test. Brief at `~/Research/debates/2026-06-08-09-11-how-does-4-bit-quantization-affect-a-dom.md`.

**Headline measurements**:
- **Wall-clock: 93.7 s** (Q-Day today: 94.3 s — speed reproducible, ~94 s is the new baseline)
- **Verifier wall-clock: 16.1 s** (Q-Day today: 13.3 s; Q-Day yesterday: 9.7 s)
- **Failures: 0 voices**

### Most important finding: R1 verifier output quality is prompt-conditional, NOT stable

Yesterday's R1 verifier on Q-Day produced clean structured 3-concern output with the prompt's bullet schema. Today's R1 verifier on the quantization prompt produced output with:

- **Header-style flag presentation** (`## 1. **Appendix Contradiction**` / `### Concern`) instead of the bulleted `- **Claim**:` schema specified in VERIFIER_PROMPT
- **Broken markdown**: `### Concern**` with unclosed italic markup
- **Tokenizer artifacts** mid-output: `"Cltion-based"`, `"Clartie de calibration"` — likely token-id corruption
- **Context-window failure**: output ends with *"Please provide the brief verbatim so I can offer specific answer notes."* — R1 forgot it had been given the brief earlier in its input and asked to be re-fed it
- Added unprompted section `## Verification Points` with 3 numbered checks
- Footer reports "Flagged 0 suspect claims" (the `countSuspectClaims` heuristic also didn't generalize — see below)

**Methodology-chapter implication**: yesterday's substantive R1-verifier output was prompt-specific, not a reliable upstream-routing effect. R1 (`deepseek-r1:7b-council`) is **not a reliable Reflection-agent** across prompts. The Q-Day prompt happened to produce upstream brief content R1 could engage with; today's prompt did not. Verifier model substitution is now a real priority — Mistral Nemo and Falcon-3 are both Tier 1 candidates worth testing in this role.

### Confabulation findings — Falcon-3 + Nemo on harder domain

The PQC literature is heavily indexed; ML/quantization literature is similarly indexed but with denser citation graphs that small models confabulate within rather than reach outside. Two flag-worthy items:

1. **"Yang & Hodgkiasz, 2023"** — falcon-3 empiricist cited this paper supporting OOD calibration findings. "Hodgkiasz" isn't a verifiable ML researcher name. **First citation confabulation observed from falcon-3.** Pilot 1 had falcon-3 cite real Kyber/Dilithium correctly; today's broader ML domain produces fabricated author names. Falcon-3's citation reliability is *domain-correlated*: strong on indexed/canonical PQC content, weak on the active-area ML literature. Worth a paragraph in the methodology chapter: "confabulation rate is not a per-model constant; it varies by how thinly-indexed the queried domain is."

2. **"Deep Expectation Layers"** — referenced in the brief AND the verifier output as a verification technique alongside watermarking. This isn't a recognized LLM verification mechanism. Likely confabulated by one researcher voice and propagated through synthesist + verifier without challenge. *Strong demonstration of the value of an external citation-verification harness* — automated arxiv ID lookup would catch the Yang citation but not the technique name; semantic verification would catch both.

3. **"top-k accuracy score" as a calibration metric** — synthesist mentioned this as a quantitative metric for evaluating calibration. Top-k accuracy is a classification metric, not a calibration metric (calibration uses ECE, Brier score, NLL). **Metric-family misattribution** — adds to the failure-mode taxonomy under 3b (family misattribution) but at a sub-domain level (within ML evaluation metrics).

### Mathstral cross-domain bridging — prompt-specific, not stable property

Pilot 2's mathstral methodologist spontaneously pulled in "matched filter SNR" (GW-physics methodology) on the LLM-quantization protocol-design prompt — a thesis-relevant cross-bridge. Today, mathstral on a similar-domain prompt produced only generic "verification mechanisms must be adapted" content without GW or quantitative-physics analogues.

**Refined hypothesis**: cross-domain bridging activates when the prompt specifically requests **experimental protocol design** (pilot 2: "Design an experimental protocol to measure…") rather than **conceptual exposition** (today: "How does X affect Y…"). The bridging is prompt-cued, not a stable mathstral property.

Worth verifying on a third prompt: re-fire the pilot-2 methodologist prompt verbatim and see if mathstral bridges again. If yes → bridging is reproducible on protocol-design prompts. If no → bridging is even more situational than current data suggests.

### countSuspectClaims fix did NOT generalize

Yesterday's fix matched `- Concern:` and `- **Concern**:` (bullet format). R1's today's output uses `### Concern` (header format). The heuristic missed every flag because R1 chose a different schema. **Three iterations needed**:

1. Tighten VERIFIER_PROMPT to require bullet format with example explicit enough that R1 can't reinterpret (probably needs `<example>` block with verbatim output)
2. Broaden countSuspectClaims to ALSO match `### Concern` headers as fallback
3. (Optional) consider switching the verifier model to one that consistently honors the schema — Mistral Nemo is the obvious candidate given it does consistently respect synthesist citation format

### Brief-shape observations (synthesist drift continues)

Nemo as synthesist continues to drift on the citation format:
- Today: `(r1-devil's advocate vs. r1-hypothesizer, r2-devil's advocate)` — apostrophe in agent name (should be `devils_advocate`), `vs.` conjunction (not in spec), multi-voice citation collision in one parenthetical
- Yesterday: `†r2-hypothesizer, r1-methodologist` — dagger prefix instead of bare parenthetical

**Methodology**: Nemo respects the *principle* of citing voices but rephrases the *format* each run. The tightened `<critical_citation_rule>` block from earlier in the iteration is not strict enough to bind Nemo's punctuation. *Either rewrite the directive even more explicitly OR accept Nemo's variant format and update the verifier to handle it.*

### Verdict on the second prompt

- **Speed**: reproducible (~94 s baseline confirmed)
- **Verifier quality**: not stable across prompts → R1 is NOT the right Reflection-agent model
- **Cross-domain bridging**: prompt-cued, not stable
- **Confabulation**: domain-correlated; falcon-3 fine on PQC, weak on ML literature
- **Synthesist drift**: continues; format directives aren't strict enough

**Next iteration priorities** (ranked):
1. Swap verifier model from `deepseek-r1:7b-council` → `mistral-nemo:12b-council` (Tier 1, format-compliant) AND tighten VERIFIER_PROMPT with an explicit `<example>` block
2. Iterate countSuspectClaims to handle `### Concern` headers (low-effort backstop)
3. Tighten SYNTHESIST_PROMPT's citation directive — or accept Nemo's variant and document
4. *(separate)* Build the citation-verification harness from BACKLOG — it would have caught Yang & Hodgkiasz immediately

---

## 2026-06-09 — Quantization prompt v2 (Nemo verifier, post-tightening)

Third run on the quantization-calibration prompt with `verifier: mistral-nemo:12b-council` + tightened VERIFIER_PROMPT + broader countSuspectClaims heuristic. Brief at `~/Research/debates/2026-06-08-09-34-how-does-4-bit-quantization-affect-a-dom.md`.

**Headline measurements**:
- **Wall-clock: 90.5 s** (Q-Day today: 94.3 s; Quant v1 today: 93.7 s — speed stable)
- **Verifier wall-clock: 5.3 s** (R1 was 13.3-16.1 s; **Nemo is 2-3× faster** + much shorter outputs)
- **Verifier format: PERFECT** — exact `- **Claim**:` / `- **Concern**:` / `- **Suggested check**:` schema-compliant bullets
- **Flag count: 4 (heuristic correctly counted all 4)** — `countSuspectClaims` fix + Nemo's clean output combined
- **Failures: 0 voices**

### The big new finding: prompt-example contamination (new failure mode #12)

Nemo verifier output **4 flags**. Inspection: **only 1 is legitimate**; **3 are confabulated from the VERIFIER_PROMPT's own example text**.

Legitimate flag:
> "Four-bit quantization significantly disrupts domain specialist LLMs' calibration on out-of-distribution scientific facts due to increased noise that affects critical neural mechanisms like attention."

That's a real over-claim from the synthesist — Nemo correctly flagged it as going beyond what voices supported.

**The 3 fabricated flags**:
- `"Falcon was standardized in 2024"` — NOT IN THE BRIEF. This is from `VERIFIER_PROMPT` line 284 ("Falcon was standardized in 2024 (Falcon is drafted, not finalized as a FIPS standard)"), which I added explicitly as a red-flag *example*.
- `"SIKE is being adopted"` — NOT IN THE BRIEF. From `VERIFIER_PROMPT` line 285.
- `"IBM Quantum Cloud"` — NOT IN THE BRIEF. From `VERIFIER_PROMPT` line 288 (`"IBM Qubit Cloud" (real product is "IBM Quantum" / "IBM Quantum Cloud")`).

**Nemo treated my prompt's example strings as if they were content from the brief and confabulated flags around them.** This is a distinct failure mode from #9 (system-prompt leakage where the model regurgitates its system prompt directly) — here the model *uses* the system-prompt examples as material to confabulate AROUND, producing output that LOOKS like a domain-grounded verification but is actually mining the prompt for content.

**Failure mode #12 added to taxonomy**: *Prompt-example contamination — model treats few-shot examples in its system prompt as if they were data from the input context, producing output that references the examples rather than the actual content under review. Distinct from #9 (system-prompt leakage as regurgitation) because the contamination is laundered through the schema — the output looks legitimate.*

This is a **publishable thesis-methodology finding**: *in multi-agent verification systems, the verifier's system prompt examples become an attack surface for confabulation.* It's specifically dangerous because:
- The output passes format compliance (schema is respected)
- The output passes downstream heuristics (`countSuspectClaims` counted 4)
- A human reader has to cross-reference each flag against the brief to detect it
- **The flag count footer says "4 suspect claims" with high apparent confidence — exactly the kind of false signal the verifier exists to PREVENT**

Fix: rewrite VERIFIER_PROMPT examples as *abstract patterns* rather than concrete strings. Shipped this iteration. Next /discover run will test whether removing the concrete examples eliminates the contamination.

### Updated comparison: verifier behavior across 4 runs on the quantization prompt + Q-Day

| Run | Verifier model | Wall-clock | Format | Heuristic flag count | Real flags | Hallucinated flags |
|---|---|---|---|---|---|---|
| 2026-06-08 17:11 Q-Day | R1 | 9.7 s | `<none>` text | 0 | 0 | 0 |
| 2026-06-09 08:40 Q-Day | R1 | 13.3 s | `### Concern` headers | 0 (heuristic miss) | 3 | 0 |
| 2026-06-09 09:11 Quant v1 | R1 | 16.1 s | broken markdown + context failure | 0 (heuristic miss) | 0 | 0 |
| 2026-06-09 09:34 Quant v2 | **Nemo** | **5.3 s** | **perfect schema bullets** | **4 (correct count)** | **1** | **3 (prompt examples)** |

What this shows:
- **R1 is unreliable across prompts and outputs unparseable garbage**.
- **Nemo is reliable on format + count, but trades that reliability for a new failure mode (prompt-example contamination)**.
- The flag-count heuristic and the format-compliance work were necessary but not sufficient.
- **Real verifier quality is now bottlenecked by prompt engineering**, not model selection.

### Other Nemo verifier observations (positive)

- **No tokenizer artifacts** (R1 had "Cltion-based", "Clartie de calibration"). Nemo's output is clean English throughout.
- **No context-window failure** (R1 ended with "Please provide the brief verbatim"). Nemo demonstrably processed the brief — its 1 legitimate flag quoted brief content verbatim.
- **5.3 s is consistent with Nemo's pilot data** (mistral-nemo Tier 1 with sub-10 s averages across all roles in Phase 1 sweep). The model-swap-to-Nemo decision is validated as a separate finding from the prompt-contamination issue.

### Routing change persistence verdict (3 runs in)

- Speed reproducible at ~91-94 s across both prompts (4 runs total under new routing): **STABLE**
- 0 voice failures across all 4 runs: **STABLE**
- Verifier with Nemo: format + speed wins, but prompt engineering needed: **PARTIAL** — proceed with the prompt fix, re-test
- Synthesist drift on citation format: **PERSISTS** (Nemo as synthesist unchanged across runs; same drift pattern)

### Next iteration priorities (ranked)

1. **Re-test verifier with the cleaned VERIFIER_PROMPT** (abstract red-flag patterns, no concrete strings) — does the prompt-contamination disappear? If yes, Nemo verifier is the converged answer.
2. **`/verify-citations` `~` expansion** (shipped this iteration) — works on absolute paths.
3. **Citation harness now usable** — once paths work, run on all 4 briefs to get baseline data on arXiv ID confabulation rates per prompt.
4. **Synthesist citation format** — still on the table; defer until prompt-contamination question is settled.

---

## What's missing (deferred to next sessions)

These observations require infrastructure that isn't ready yet:

- **Citation accuracy across the fleet** — needs the citation-verification harness (regex-extract arXiv IDs, HEAD-check resolution). Without it we can't quantify per-model confabulation rate, only flag individual claims.
- **Token-throughput vs failure-mode correlation** — current `voice-tests.jsonl` records `outputTokens` but not generation rate; need to derive from durationMs and add to CSV for the methodology table.
- **OLMo's full runaway content** — partial-content recovery is gated on the harness fix (BACKLOG: "voice-test loses partial output on cap-hit"). Until it lands, OLMo's 24K-token ramble at default cap is unobservable.
- **Inter-rater agreement between Council voices** — needs the pairwise-Elo tournament work (BACKLOG P2). Phase 1 sweep only gives us per-model performance; voice-diversity claims need pairwise comparison.
