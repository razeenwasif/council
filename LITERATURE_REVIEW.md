# Literature Review — Quantized Domain Specialists for Multi-Agent Scientific Reasoning

> Background survey for the research project documented in `ROADMAP.md` and `RESEARCH_PROPOSAL.md`. Reviews ~55 sources across multi-agent LLM systems, LLM quantization, parameter-efficient fine-tuning, domain-specific scientific LLMs, tool use, AI for science, evaluation benchmarks, and information-theoretic foundations. Identifies the specific intellectual gap the project addresses.

**Author**: Razeen Wasif
**Date**: 2026-06-02
**Status**: First-pass survey. To be expanded as Phase 0–4 produce empirical results.

---

## 1. Introduction and Scope

This review situates the research project at the intersection of four active research areas:

1. **Multi-agent LLM systems** — increasingly studied for their ability to outperform single-model approaches on reasoning, factuality, and scientific tasks.
2. **LLM quantization** — a mature engineering subfield with active research on extreme compression (≤4 bits).
3. **Domain-specific fine-tuning** — a long-standing tradition (SciBERT, BioBERT) recently extended into the generative-LLM era (Galactica, Med-PaLM, PMC-LLaMA).
4. **Verification and self-checking** — emerging methods for catching LLM errors via debate, self-critique, process supervision, and external tool use.

Each area has substantial literature individually. **The intersection is under-studied.** No prior work that I have found combines:
- A heterogeneous multi-agent system,
- With a quantized domain-specialist as a *verification* component (not a primary reasoner),
- Subjected to a *controlled quantization ablation* against eval metrics.

This review is organized to make that gap visible.

---

## 2. Multi-Agent LLM Systems

### 2.1 Foundational systems

The multi-agent paradigm for LLMs took shape in 2023. **AutoGen** ([Wu et al. 2023](https://arxiv.org/abs/2308.08155)) introduced a conversational multi-agent framework where customizable, conversable agents (LLM-driven, human-driven, or tool-driven) cooperate to solve problems. The paper demonstrated effectiveness across mathematics, coding, QA, and operations research. **MetaGPT** ([Hong et al. 2023](https://arxiv.org/abs/2308.00352)) extended this with Standard Operating Procedure (SOP) encoding: agents are assigned roles (project manager, architect, developer) that mirror real software-team workflows, producing more coherent end-to-end software artifacts. **CAMEL** ([Li et al. 2023](https://arxiv.org/abs/2303.17760)) explored autonomous role-playing between AI agents (assistant + user) to generate task-oriented conversations, producing the 25K-conversation AI Society dataset as a side artifact.

A complementary line — **HuggingGPT** ([Shen et al. 2023](https://arxiv.org/abs/2303.17580)) — used an LLM as a *controller* orchestrating dozens of specialized HuggingFace models. The four-stage workflow (task planning → model selection → execution → response generation) is conceptually related to the present project's verification layer, where a frontier model dispatches claim-checking to local specialists.

### 2.2 Debate as a quality mechanism

**Du et al. (2023)** "Improving Factuality and Reasoning in Language Models through Multiagent Debate" ([arXiv:2305.14325](https://arxiv.org/abs/2305.14325), ICML 2024) is the most cited theoretical result in this space. They show that multiple LLM instances proposing and critiquing each other's answers over multiple rounds consistently outperform single-model baselines on mathematics, strategic reasoning, and factual QA. **Arithmetic accuracy improves with both more agents and more debate rounds** — a scaling law that motivates the multi-voice design of Council and `/discover`.

### 2.3 Self-improvement loops

Three related approaches established that LLMs can improve their own outputs without weight updates:

- **Self-Refine** ([Madaan et al. 2023](https://arxiv.org/abs/2303.17651), NeurIPS 2023) — a single LLM generates, critiques, and refines its output iteratively. Reports ~20% absolute improvement across diverse tasks vs. direct generation.
- **Reflexion** ([Shinn et al. 2023](https://arxiv.org/abs/2303.11366), NeurIPS 2023) — agents verbally reflect on task feedback and store reflections in an episodic memory buffer to improve subsequent attempts.
- **Tree of Thoughts** ([Yao et al. 2023](https://arxiv.org/abs/2305.10601), NeurIPS 2023) — generalizes Chain-of-Thought to deliberate search over reasoning branches, with self-evaluation and backtracking. Lifts GPT-4's Game-of-24 success rate from 4% (CoT) to 74%.

All three operate within a *single model*. The present project extends this lineage by introducing a *different* model (a specialist) as the critic, betting that cross-model heterogeneity catches errors a single model is blind to.

### 2.4 Co-Scientist — the closest prior art

**Gottweis et al. (2025)** "Towards an AI co-scientist" ([arXiv:2502.18864](https://arxiv.org/abs/2502.18864)) introduces Google's Gemini-2.0-powered multi-agent system with six specialized agents (Generation, Reflection, Ranking, Proximity, Evolution, Meta-review) operating in a closed tournament loop over a hypothesis pool. The system has since graduated to a Nature publication and a Gemini-for-Science rollout. **This is the closest published architecture to what the present project's planned Co-Scientist mode would implement.** Critical differences in the present work:

- All Google Co-Scientist agents are frontier (Gemini); the present project mixes frontier reasoners + local specialists.
- Google Co-Scientist is closed-source; the verification-layer hybrid being studied here is reproducible on consumer hardware.
- Google does not study the *quantization* of any component; that is the load-bearing contribution being attempted here.

### 2.5 Reasoning primitives that underpin multi-agent work

**Chain-of-Thought prompting** ([Wei et al. 2022](https://arxiv.org/abs/2201.11903)) established that intermediate reasoning steps substantially improve LLM performance on math, commonsense, and symbolic tasks — but only emerges around ~100B parameters. **Tree of Thoughts** (above) generalizes this; **Process Reward Models** ([Lightman et al. 2023](https://openai.com/index/improving-mathematical-reasoning-with-process-supervision/)) — OpenAI's "Let's Verify Step by Step" work — show that *step-level* supervision (process supervision, PRM800K dataset) substantially outperforms outcome-only supervision on math benchmarks. The verifier architecture in the present project draws on PRM principles: it audits *individual claims*, not just final answers.

### 2.6 Verification of generated content

**SelfCheckGPT** ([Manakul et al. 2023](https://arxiv.org/abs/2303.08896), EMNLP 2023) detects hallucinations in black-box LLMs by sampling multiple responses and measuring consistency — a method that scales to closed APIs without internal access. **Constitutional AI** ([Bai et al. 2022](https://arxiv.org/abs/2212.08073)) introduced RLAIF: training an AI to evaluate outputs against a constitution of natural-language principles, replacing human feedback. **LLM-as-a-Judge** ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685), NeurIPS 2023) systematically validated using strong LLMs (GPT-4) as judges of chatbot output quality, finding ~80% agreement with human raters on MT-Bench and Chatbot Arena, while characterizing position/verbosity/self-enhancement biases.

These verification techniques all use a *strong* LLM as judge. The present project's open question: can a *small, quantized, fine-tuned* model serve as a credible domain-specific judge despite its lower general capability?

---

## 3. LLM Quantization

This is the technical core of the project. The literature has matured rapidly since 2022.

### 3.1 Post-training quantization (PTQ)

**GPTQ** ([Frantar et al. 2022](https://arxiv.org/abs/2210.17323)) introduced layer-wise weight quantization for LLMs using inverse-Hessian information to update remaining weights as each one is quantized. Established that 3–4 bit weight-only quantization could be done without catastrophic accuracy loss on large models. **AWQ** ([Lin et al. 2023](https://arxiv.org/abs/2306.00978), MLSys 2024 Best Paper) refined this with activation-aware per-channel scaling, observing that protecting ~1% of salient weights (those with large activation magnitude) preserves most of the model's accuracy. AWQ has been adopted by NVIDIA TensorRT-LLM, AMD, Google Vertex, Amazon SageMaker, vLLM, and HuggingFace TGI.

**SmoothQuant** ([Xiao et al. 2022](https://arxiv.org/abs/2211.10438), ICML 2023) addressed the *activation* quantization problem: activations have outliers ~100× larger than typical values, making W8A8 (8-bit weight + activation) quantization lose accuracy. SmoothQuant migrates the quantization burden from activations to weights via a mathematically-equivalent transformation, enabling W8A8 on OPT, BLOOM, Llama-1/2, Falcon, Mistral, Mixtral.

**ZeroQuant** ([Yao et al. 2022](https://papers.neurips.cc/paper_files/paper/2022/file/adf7fa39d65e2983d724ff7da57f00ac-Paper-Conference.pdf), NeurIPS 2022, Microsoft) introduced fine-grained, hardware-friendly quantization with layer-by-layer knowledge distillation. Achieved INT8 W/A quantization with minimal accuracy impact and up to 5×+ speedup.

### 3.2 Extreme low-bit quantization

**OmniQuant** ([Shao et al. 2023, ICLR 2024 spotlight](https://arxiv.org/abs/2308.13137)) combined learnable weight clipping with sample-efficient calibration to push compression to 2–4 bits. **BitNet b1.58** ([Ma et al. 2024](https://arxiv.org/abs/2402.17764)) — Microsoft's 1.58-bit model — trains directly in low-bit precision from scratch using ternary weights {-1, 0, 1}, encoding log₂(3) ≈ 1.58 bits per parameter. Matches FP16 LLaMA in perplexity at 3B parameter scale while using 3.55× less GPU memory and running 2.71× faster. The follow-up **BitNet a4.8** extends to 4-bit activations.

The most extreme PTQ work — **AQLM** (Additive Quantization), **QuIP**, **OneBit** — pushes below 3 bits, with diminishing accuracy returns. **OmniQuant outperforms GPTQ at 2-bit**, but still suffers noticeable degradation. *Below 3 bits remains research territory; production deployments stay at Q4-Q8.*

### 3.3 Rotation-based quantization

A 2024 advance: **QuaRot** showed that rotating LLM hidden states (via Hadamard transforms) removes outliers without changing the model's output, dramatically easing quantization. **SpinQuant** ([Liu et al. 2024](https://arxiv.org/abs/2405.16406)) extended this by *learning* the rotation matrices via Cayley optimization on a small calibration set. For Llama-2 7B at W4A4KV4, SpinQuant narrows the accuracy gap to FP16 to 2.9 points — substantially better than LLM-QAT (+19.1 pts gap) and SmoothQuant (+25 pts).

### 3.4 Quantization-aware training (QAT)

**LLM-QAT** ([Liu et al. 2023](https://arxiv.org/abs/2305.17888), ACL 2024) introduced data-free QAT for LLMs: generates synthetic training data from the pretrained model itself (no need for the original training data), distills the FP16 model into a quantized student. Quantizes weights, activations, *and* KV cache. Demonstrated on LLaMA 7B/13B/30B down to 4 bits. **The present project will use LLM-QAT-style methodology for Phase 3's QAT vs. PTQ comparison.**

**Gemma 4 QAT** ([Google 2026](https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/)) — a *production* QAT release: Google published QAT checkpoints for Gemma 4 (E2B, E4B, 12B, 26B-MoE variants) in the `Q4_0` format plus a novel mobile format using *targeted 2-bit quantization* for token-generation layers while keeping reasoning components at higher precision (reducing E2B to <1 GB). The directly load-bearing claim for this thesis: **"QAT results yield even higher overall quality compared to standard PTQ baselines"** — production evidence for RQ3 (PTQ vs QAT). Two roles here: (a) a citable real-world confirmation that QAT preserves quality better than PTQ under equal bit-depth, and (b) a concrete QAT *generalist* baseline to compare against this project's QLoRA-specialist→PTQ pipeline under the multi-channel verifier — the sharp question being whether a small *domain specialist* outperforms a QAT *generalist* on in-domain prompts. The 2-bit mobile format is also an extreme data-point on the project's quantization curve. (Caveat: the release page gives no quantitative benchmark deltas, context length, or tool-use detail.)

### 3.5 Quantization × reasoning — the most directly relevant prior work

**Liu et al. (2025)** "Quantization Meets Reasoning: Exploring LLM Low-Bit Quantization Degradation for Mathematical Reasoning" ([arXiv:2501.03035](https://arxiv.org/abs/2501.03035)) is the closest prior work to the present project's central question. They evaluate quantization on math reasoning specifically, finding:

- AWQ and GPTQ introduce up to **32.39% accuracy degradation** (average 11.31%) on Llama-3 models, *concentrated in numerical computation and reasoning planning*.
- Performance drops on math reasoning are **disproportionately larger** than on general commonsense and language-understanding benchmarks.
- **Fine-tuning quantized models on only 545 task-specific examples for 3 minutes on 4 GPUs effectively restores reasoning capabilities to near full-precision levels.**

This last finding is directly relevant to the present project: it suggests that *small-scale specialty fine-tuning may compensate for quantization damage*, which is exactly the verification-layer hypothesis. The present project extends this by (a) using the fine-tuned quantized model as a *verifier* rather than a primary reasoner, (b) measuring across more bit-depths with explicit PTQ-vs-QAT comparison, (c) embedding the result in a multi-agent system.

### 3.6 KV-cache compression — TurboQuant (ICLR 2026)

**TurboQuant** ([Google Research, ICLR 2026](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)) is a two-stage KV-cache compression algorithm that combines **PolarQuant** (random-rotation of value vectors → per-segment quantization) with a 1-bit residual error-corrector based on **Quantized Johnson-Lindenstrauss (QJL)**. The first stage simplifies the vectors' geometry so a standard high-quality quantizer applies independently to each part; the second stage uses a tiny residual bit budget on the leftover error to eliminate bias in the attention scores. Headline result: **KV-cache quantized to 3 bits, ~6× memory footprint reduction, zero accuracy loss reported, no fine-tuning or retraining required.**

This is *directly relevant to the present project's central claim*. The thesis hypothesis — that information loss under extreme quantization is *measurable through multi-agent verification* in ways not visible to single-channel benchmarks — is testable on TurboQuant specifically:

> Standard perplexity may report TurboQuant as zero-loss; multi-agent debate quality + verifier flag count + citation-harness MISMATCH rate may report it as nonzero-loss. The decomposition between the two measurement channels is the project's methodology contribution.

This generalizes the v1.0-vs-v1.5 verifier A/B reported in `THESIS_FINDINGS.md` (single-channel citation verification reported 0% confabulation; multi-channel reported 100% on the same data). The TurboQuant evaluation extends the same methodology pattern to *compression artifact* detection.

Practical caveat (2026-06-09): the official Google implementation is targeted for Q2 2026; Tether's QVAC SDK 0.12.0 reportedly ships an early integration. Ollama upstream integration is not yet announced. Implementation deferred to a follow-up phase; experiment design tracked in `BACKLOG.md` ("Evaluate Google TurboQuant for Council KV-cache compression").

### 3.7 The serving stack — llama.cpp / GGUF

The community-standard format for serving quantized LLMs is **GGUF** (introduced in `llama.cpp` by Gerganov, [github.com/ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)). GGUF supports 1.5–8 bit quantization via "K-quant" variants (Q2_K, Q3_K_S/M/L, Q4_K_S/M, Q5_K_S/M, Q6_K) that use mixed-precision blocks for better accuracy at the same effective bit budget. **The present project's Phase 3 quantization sweep uses GGUF formats** because they are widely-deployed, well-tested, and serve directly through ollama (the user's existing setup).

---

## 4. Parameter-Efficient Fine-Tuning (PEFT)

### 4.1 LoRA and its family

**LoRA** ([Hu et al. 2021](https://arxiv.org/abs/2106.09685)) is the foundational method: freeze pre-trained weights, introduce trainable low-rank decomposition matrices in parallel. Achieves up to 10,000× fewer trainable parameters and 3× less GPU memory for GPT-3-scale fine-tuning, with no inference-time latency cost (adapters can be merged).

**QLoRA** ([Dettmers et al. 2023](https://arxiv.org/abs/2305.14314)) combined LoRA with 4-bit quantization of the frozen base, enabling fine-tuning of 65B models on a single 48GB GPU. Introduced 4-bit NormalFloat (NF4) quantization and Double Quantization. *Demonstrated that combining quantization + adapter fine-tuning is viable.* The present project inherits this lineage but flips the direction: instead of QLoRA's "fine-tune through frozen quantization," it explores "fine-tune at FP16, then quantize the merged result, and measure the curve."

**DoRA** ([Liu et al. 2024](https://arxiv.org/abs/2402.09353), ICML 2024 Oral) decomposes pretrained weights into *magnitude* and *direction* components, applying LoRA only to direction. Consistently outperforms LoRA across LLaMA, LLaVA, and VL-BART on commonsense reasoning, visual instruction tuning, and image/video-text tasks. *No additional inference cost.* The present project will benchmark DoRA against LoRA in Week 3-4 as a candidate improvement.

### 4.2 Domain expansion without forgetting

**LLaMA-Pro** ([Wu et al. 2024](https://arxiv.org/abs/2401.02415), ACL 2024) proposes *block expansion*: extending a pretrained LLM with zero-initialized Transformer blocks tuned exclusively on the new corpus while original blocks remain frozen. Specifically addresses catastrophic forgetting in domain specialization. LLaMA Pro-8.3B (from LLaMA-2-7B) matches StarCoder-15B on code and beats LLaMA-2-13B and LLaMA-2-34B on math while remaining smaller.

This is directly relevant: it's a method for adding domain expertise *without losing general capability* — a key requirement for the verifier role.

### 4.3 Model merging

**Task Arithmetic** introduced the concept of "task vectors" — the difference between fine-tuned and pre-trained weights — that can be added, subtracted, or interpolated. **TIES-Merging** (Trim, Elect Sign, Disjoint Merge) addresses interference between merged models by resolving sign conflicts. **DARE** (Drop And Rescale) randomly drops up to 90% of delta parameters before merging, mitigating interference.

Relevance to this project: if Phase 5 builds multiple specialists, merging them into a single multi-domain checkpoint via TIES + DARE is a candidate alternative to running them as separate models.

### 4.4 Sparse upcycling

**Sparse Upcycling** ([Komatsuzaki et al. 2022](https://arxiv.org/abs/2212.05055)) trains MoE models from dense checkpoints by replacing MLP layers with MoE layers initialized from the original MLP. Recovers ~100% of the dense-training cost while reaching MoE-quality outputs at ~50% incremental cost. *Relevant if the project ever scales to multiple specialists merged as MoE experts.*

---

## 5. Domain-Specific Scientific LLMs

### 5.1 Encoder-era scientific models

**SciBERT** ([Beltagy et al. 2019](https://arxiv.org/abs/1903.10676)) was the first widely-used pretrained encoder for scientific text — BERT pretrained on 1.14M biomedical + CS papers from Semantic Scholar with an in-domain vocabulary (SciVocab). Outperformed BERT-Base and even some specialized BioBERT results on biomedical tasks. **BioBERT** narrowed the focus to PubMed/PMC. These models established the *value of domain pretraining* but were limited to discriminative tasks (NER, classification).

**ChemBERTa** ([Chithrananda et al. 2020](https://arxiv.org/abs/2010.09885)) extended this to chemistry, pretrained on SMILES strings via MLM. **ChemBERTa-2** scaled to 77M molecules with optimized pipeline. **MolFormer** (IBM) pretrained on 1.1B SMILES strings from PubChem + ZINC with linear attention + RoPE, achieving strong MoleculeNet performance.

### 5.2 Generative scientific LLMs

**Galactica** ([Taylor et al. 2022](https://arxiv.org/abs/2211.09085)) — Meta's 120B parameter LLM trained on 106B tokens of curated scientific text (papers, citations, knowledge bases, code, SMILES, amino acid sequences, LaTeX). Outperformed Chinchilla on math MMLU (41.3% vs 35.7%), beat PaLM 540B on MATH (20.4% vs 8.8%). Open-sourced under Apache 2.0. *Famously, the demo was pulled within 3 days after public hallucination examples.* The technical contribution stands; the deployment lesson — that even strong domain models hallucinate confidently — is one of the motivations for the verification-layer approach.

**Med-PaLM 2** ([Singhal et al. 2023](https://arxiv.org/abs/2305.09617)) — Google's medical specialist built from PaLM 2 + medical domain fine-tuning + new prompting strategies (ensemble refinement, chain of retrieval). Achieved 86.5% on MedQA (USMLE-style), state-of-the-art at release. Published in Nature Medicine, January 2025.

**PMC-LLaMA** ([Wu et al. 2023](https://arxiv.org/abs/2304.14454)) — open-source biomedical LLM, two-stage training: pretraining on 4.8M biomedical papers + 30K medical textbooks, then instruction tuning on MedC-I (202M tokens). Outperformed ChatGPT on PubMedQA, MedMCQA, USMLE. *Demonstrates the open-source path to specialist models that the present project follows.*

### 5.3 Continued pretraining methodology

**Gururangan et al. (2020)** "Don't Stop Pretraining: Adapt Language Models to Domains and Tasks" ([ACL 2020](https://aclanthology.org/2020.acl-main.740/)) established **DAPT** (Domain-Adaptive Pretraining) and **TAPT** (Task-Adaptive Pretraining) as canonical methodology: take a general pretrained model, continue masked-language-modeling on a target-domain corpus, then fine-tune on the end task. This is the methodology the present project's Phase 2 follows.

**Catastrophic forgetting** ([Luo et al. 2023](https://arxiv.org/abs/2308.08747)) — an empirical study finding that catastrophic forgetting in LLMs *intensifies with scale* (worse in 7B than 1B). Models suffer stronger forgetting in domain knowledge, reasoning, and reading comprehension. *Critical risk to address in the present project's Phase 2*; mitigations include general instruction mixing during fine-tuning and methods like LLaMA-Pro's block expansion.

---

## 6. Tool Use and Retrieval

### 6.1 Tool-augmented LLMs

**Toolformer** (Schick et al. 2023, NeurIPS 2023) — LLMs learn to use external tools (calculator, search, translation, QA, calendar) by self-supervised generation of training examples with tool API calls. **ReAct** (Yao et al. 2023, ICLR 2023) — interleaves reasoning traces with tool actions, demonstrating that explicit Reason+Act traces beat pure-reasoning or pure-action baselines. ReAct's structured tool-use format has become the basis for most modern function-calling implementations from OpenAI, Anthropic, and Google.

### 6.2 Model Context Protocol

**MCP** ([Anthropic, 2024](https://modelcontextprotocol.io/specification/)) — open standard for connecting LLM applications to external data sources and tools. Released November 2024 (spec 2024-11-05). Adopted by OpenAI (March 2025) and Google. Solves the "MxN problem" of LLM × tool integration via a standard JSON-RPC client-server protocol. Three server primitives: Prompts, Resources, Tools.

The present project uses MCPs for arXiv search ([andybrandt/mcp-simple-arxiv](https://github.com/andybrandt/mcp-simple-arxiv) and similar) and Wolfram Alpha computation. The MCP layer is the third tier in the system architecture (after frontier reasoners and local specialists).

### 6.3 Retrieval-Augmented Generation

**RAG** ([Lewis et al. 2020](https://arxiv.org/abs/2005.11401), NeurIPS 2020) — the seminal "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks." Introduced the parametric + non-parametric memory split: a pretrained seq2seq model (BART) for parametric knowledge, an external corpus (Wikipedia, indexed via Dense Passage Retrieval) for non-parametric. Set SoTA on three open-domain QA benchmarks. The progenitor of an enormous downstream ecosystem (LangChain, LlamaIndex, etc.).

### 6.4 Embeddings for retrieval

**BGE** (BAAI General Embedding) — open family of sentence-embedding models from the Beijing Academy of Artificial Intelligence, BERT-based, fine-tuned for retrieval. State-of-the-art on the MTEB benchmark when released. Available in small/base/large variants on HuggingFace ([BAAI/bge-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5)).

The present project will use BGE-small for the Proximity-clustering component of Co-Scientist, when that mode is built; not directly in the verifier path.

---

## 7. AI for Scientific Discovery

### 7.1 Landmark systems

**AlphaFold 3** ([Abramson et al. 2024](https://www.nature.com/articles/s41586-024-07487-w), Nature, May 2024) — joint Google DeepMind + Isomorphic Labs work; diffusion-based architecture predicting protein structures, protein-DNA/RNA complexes, post-translational modifications, ligands, and ions in a single unified model. *Order-of-magnitude accuracy improvements over specialized prior tools.* Free server access for non-commercial use.

**AlphaGeometry** ([Trinh et al. 2024](https://www.nature.com/articles/s41586-023-06747-5), Nature, January 2024) — neuro-symbolic geometry theorem prover trained from scratch on millions of synthetic theorems. Solves Olympiad-level geometry near gold-medalist standard. **AlphaProof + AlphaGeometry 2** solved 4 of 6 IMO 2024 problems (silver-medal score). Google open-sourced the code.

These works establish that *narrow, well-engineered scientific AI systems can produce frontier-of-knowledge results*. They also illustrate a model the present project aspires to: domain-specialized systems beat generalist models on their home turf.

### 7.2 Surveys of LLMs in science

**Zhang et al. (2024)** "A Comprehensive Survey of Scientific Large Language Models and Their Applications in Scientific Discovery" ([arXiv:2406.10833](https://arxiv.org/abs/2406.10833), EMNLP 2024) catalogs 260+ scientific LLMs across modalities (text, molecules, proteins), summarizing pretraining datasets, evaluation tasks, and gaps.

**LLM4SR** ([Zhang et al. 2025, arXiv:2501.04306](https://arxiv.org/abs/2501.04306)) — "A Survey on Large Language Models for Scientific Research" — covers LLM use across hypothesis discovery, experiment planning, writing, and review. Reports that **80.9% of 800+ surveyed published authors had used LLMs in their research workflow.**

**"From Automation to Autonomy"** ([arXiv:2505.13259](https://arxiv.org/abs/2505.13259)) — May 2025 survey explicitly examining the paradigm shift toward agentic scientific AI. Categorizes systems along an autonomy gradient: LLM-as-Tool → LLM-as-Analyst → LLM-as-Scientist.

The present project sits at the "LLM-as-Analyst" tier: the human scientist remains the principal, but multi-agent debate + verification handles the busy-work of evaluating candidate hypotheses.

### 7.3 SciAgent and tool-augmented scientific reasoning

**SciAgent** (Ma et al. 2024) — tool-augmented LLMs for scientific reasoning, introducing the SciToolBench benchmark. Explicitly tests whether providing scientific tools improves LLM performance on domain-specific questions. *Directly relevant to the MCP-augmentation Phase 4 of the present project.*

---

## 8. Open-Weights Base Models

### 8.1 The current generation

**Llama 3** ([Dubey et al. 2024](https://arxiv.org/abs/2407.21783)) — Meta's herd of dense models from 8B to 405B. The 405B model trained on 16K H100 GPUs achieves GPT-4-class quality across most benchmarks. Native support for multilinguality, coding, reasoning, and tool use.

**Gemma 3** ([Gemma Team 2025](https://arxiv.org/abs/2503.19786)) — Google's open-weights family with 1B, 4B, 12B, 27B variants. Multimodal (text + images/video in, text out). 128K context window. Gemma-3-27B-IT reportedly beats Gemini-1.5-Pro on benchmarks.

**Gemma 4** ([Google](https://ai.google.dev/gemma/docs/core), released 2026-03-31, Apache 2.0) — successor family in **five** sizes: **E2B** / **E4B** edge variants (effective 2B / 4B active footprint), a **12B** encoder-free multimodal model, a **26B MoE** (3.8B active of 26B total), and a **31B Dense** flagship. Notably shipped with first-party **QAT** checkpoints (see §3.4) — the first time a major open-weights release made quantization-aware-trained weights the *recommended* deployment artifact, a strong fit for this project's fleet (many small QAT voices resident at once) and its quantization thesis. For this project the **26B MoE vs 31B Dense** split is the load-bearing lever: the MoE activates only 3.8B params/token → cheap, fast inference and better single-GPU fleet density, whereas the 31B Dense runs all 31B every token → higher peak capability at full compute cost. So "which is more optimal" is goal-dependent (efficiency vs capability), not a strict ordering. *(Correction, 2026-06-12: an earlier draft of this note claimed the line "tops out at a 26B MoE, not a 31B dense model" — that was **wrong**. The 31B Dense is real and is the family flagship, verified against the official Gemma 4 model card; the local `gemma4:31b` Ollama tag is that genuine dense model, 31.3B params. Both the 26B MoE and the 31B Dense exist.)*

**DiffusionGemma** ([Google DeepMind 2026](https://deepmind.google/models/gemma/diffusiongemma/)) — an *experimental text-diffusion* model (26B MoE, 3.8B active), built on Gemma 4 + Gemini Diffusion. Replaces autoregressive token-by-token generation with bi-directional parallel denoising (256 tokens/forward pass), claiming 4–5× faster output and "self-correction" by evaluating whole text blocks. Fits in 24 GB quantized. Relevant here as a *generation-paradigm* variable: its whole-block self-correction is a plausible lever against confabulation (failure mode #13), making **autoregressive-vs-diffusion under the multi-channel verifier** a novel experiment. Caveats: tool-use/instruction-following unbenchmarked; llama.cpp support is a draft PR ([#24423](https://github.com/ggml-org/llama.cpp/pull/24423), dedicated `llama-diffusion-cli`, not the server) so it is not yet Ollama-deployable.

**Nex-N2** ([Nex AGI 2026](https://huggingface.co/nex-agi/Nex-N2-mini)) — Apache-2.0 agentic models post-trained on Qwen3.5, with a built-in reasoning+tool-use+execution loop. **Pro** (397B/17B-active MoE) reaches frontier scores (80.8 SWE-Bench Verified, 90.7 GPQA Diamond) but needs ~794 GB VRAM — data-center / API only, so out of scope for the project's local-only fleet (usable at most as an external teacher/comparison). **Mini** (Qwen3.5-35B-A3B, 35B/3B-active, 262K ctx) fits a single 24 GB GPU at 4-bit (~18–20 GB) and its native tool-use directly targets the local-model tool-call weakness documented in this project — a candidate generalist voice/orchestrator.

**Qwen 2.5** ([Yang et al. 2024](https://arxiv.org/abs/2412.15115)) — Alibaba's open-weights family, especially strong at math reasoning. Qwen2.5-Math-72B-Instruct surpasses Qwen-2-Math-72B and GPT-4o. *A leading candidate base model for any math-specialized future variant.*

**Phi-3** ([Abdin et al. 2024](https://arxiv.org/abs/2404.14219)) — Microsoft's small-LLM family. Phi-3-mini at 3.8B matches Mixtral 8x7B and GPT-3.5 on benchmarks. Demonstrates that *data curation > parameter count*, an insight directly relevant to domain-specialist fine-tuning.

**Mixtral 8x7B** ([Jiang et al. 2024](https://arxiv.org/abs/2401.04088)) — Mistral's sparse Mixture-of-Experts. 47B total parameters, 13B active per token. Apache 2.0 license. Outperforms Llama-2-70B at 6× faster inference. *Established that open MoE is competitive with dense frontier models.*

**DeepSeek-V3** ([DeepSeek-AI 2024](https://arxiv.org/abs/2412.19437)) — 671B MoE with 37B active per token. Pretrained on 14.8T tokens. Achieves 88.5 MMLU, 75.9 MMLU-Pro, 59.1 GPQA. Open-source. Distilled reasoning capability from DeepSeek-R1. *The strongest current open-source reasoner.*

### 8.2 Implications for base-model choice

For a larger domain specialist, the candidate pool is: Gemma 3 27B, Gemma 4 (12B, 26B-MoE, or 31B-dense), Qwen 2.5 32B, Llama 3.x in the 30B range, Nex-N2-mini (35B/3B-MoE). (Note: the v1 specialist pipeline actually settled on Mistral-7B-Instruct-v0.3 — see `~/Research/council-specialists/` — so this 30B-class discussion is for a future larger variant.) **Trade-offs**:

- Gemma is the user's existing choice (already on disk via ollama).
- Qwen has stronger math priors — relevant if the specialist's failure-mode profile is math-heavy.
- Llama has the strongest community tooling and the most reference implementations.

Phase 2 should benchmark at least Gemma vs. Qwen on the eval before committing.

---

## 9. Evaluation Benchmarks

### 9.1 General reasoning

**GPQA** ([Rein et al. 2023](https://arxiv.org/abs/2311.12022)) — Graduate-level "Google-proof" QA: 448 multiple-choice questions in biology, physics, chemistry written by domain PhDs. Domain experts score 65%; non-expert validators score 34% even with unrestricted web access. *The current standard benchmark for scientific reasoning capability in frontier LLMs.* The GPQA Diamond subset (198 questions) is the higher-quality, more challenging variant.

**MMLU-Pro** ([Wang et al. 2024](https://arxiv.org/abs/2406.01574), NeurIPS 2024) — extends MMLU with 10-option questions, removes trivial items, and adds reasoning-focused replacements. 12K+ questions across 14 domains including Biology, Chemistry, Computer Science, Math, Physics. Accuracy drops 16–33% vs. MMLU, with much greater robustness to prompt variation.

The present project's eval set will include MMLU-Pro physics + chemistry subsets as the out-of-domain reference, alongside the hand-curated GW-specific in-domain eval.

### 9.2 Reasoning-specific

**MATH** and **GSM8K** are standard mathematical reasoning benchmarks; the Quantization Meets Reasoning paper (cited above) used MATH as the primary evaluation. **PRM800K** (Lightman et al.) is a step-level annotation dataset of 800K labels on mathematical reasoning chains, used to train process reward models.

### 9.3 LLM-as-Judge evaluation

Beyond benchmarks, LLM-as-Judge protocols (Zheng et al. 2023, cited above) are increasingly used for scalable evaluation of subjective qualities. The present project uses LLM-as-Judge sparingly, preferring hand-graded rubrics for the small-N eval set in Phase 0.

---

## 10. Information-Theoretic Perspectives on Quantization

A smaller but important literature frames neural-network quantization in classical rate-distortion terms. The objective is to minimize representation error (distortion) for a given codebook size (rate). The **Bitwise Information Bottleneck** approach ([arXiv:2006.05210](https://arxiv.org/abs/2006.05210)) applies the information bottleneck principle to activation quantization, determining the most significant bits to retain.

More recent work establishes Gibbs-type variational formulations of rate-distortion that unify compression, quantization, and decoding as convex projections of continuous information onto discrete manifolds ([arXiv:2512.11279](https://arxiv.org/abs/2512.11279)).

**Why this matters for the present project**: the user's background research (GW SNR quantization) operates in rate-distortion territory. Connecting LLM-weight quantization to the same theoretical framework is a natural extension and is one of the project's potential theoretical contributions — though the empirical / system contribution is the primary aim.

---

## 11. Synthesis — Where the Gap Is

Mapping the literature against the present project's components:

| Component | Well-covered by prior work? | Gap |
| --------- | --------------------------- | --- |
| Multi-agent LLM debate | Yes (Du, AutoGen, MetaGPT, Co-Scientist) | None major |
| LLM quantization at extreme bit-depths | Yes (GPTQ, AWQ, BitNet, OmniQuant, SpinQuant) | Mostly studies single-model, single-task degradation |
| Domain fine-tuning | Yes (Galactica, Med-PaLM, PMC-LLaMA, DAPT) | Limited interaction with quantization |
| LLM-as-Judge / verification | Yes (LLM-as-Judge, SelfCheck, PRM) | Always uses *strong* judges; never small quantized specialists |
| Quantization × reasoning | Emerging (Liu et al. 2025) | One paper; doesn't study multi-agent verification |
| Quantized specialist in multi-agent system | **No known prior work** | **The project's headline contribution** |

The intellectual gap is specifically:

> *Does aggressive quantization of a domain-specialist fine-tune preserve enough capability for that specialist to act as an effective verifier in a heterogeneous multi-agent system — and where on the bit-depth curve does that capability collapse?*

Each of the four ingredients (multi-agent, quantization, specialization, verification) is well-studied. **None of the published work combines all four**, which is what makes the project a coherent, citable, single-paper contribution rather than a re-implementation of an existing study.

### Adjacent open questions the project may touch (out of scope for primary contribution, but worth flagging)

1. *Are quantization failures domain-correlated?* (Liu et al. 2025 suggests yes, but only one domain studied.)
2. *Does QAT recover the entire gap to FP16, or only part?* (LLM-QAT shows recovery; not directly tested against multi-agent eval.)
3. *Does merging multiple specialists (TIES / DARE) preserve per-domain accuracy?* (Open; relevant if Phase 5 scales.)
4. *Is verification-layer effectiveness a function of voice diversity?* (Open; the present project tests one frontier-spec pair.)

These are follow-up paper candidates, not primary contributions.

---

## 12. Bibliography

Full citations for the 55+ sources surveyed. Verified URLs as of June 2026.

### Multi-agent systems and reasoning

1. Du, Y., Li, S., Torralba, A., Tenenbaum, J. B., & Mordatch, I. (2023). **Improving Factuality and Reasoning in Language Models through Multiagent Debate**. *ICML 2024*. [arXiv:2305.14325](https://arxiv.org/abs/2305.14325)
2. Wu, Q., Bansal, G., Zhang, J., et al. (2023). **AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation**. *COLM 2024*. [arXiv:2308.08155](https://arxiv.org/abs/2308.08155)
3. Hong, S., Zheng, X., et al. (2023). **MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework**. [arXiv:2308.00352](https://arxiv.org/abs/2308.00352)
4. Li, G., Hammoud, H. A. A. K., Itani, H., Khizbullin, D., & Ghanem, B. (2023). **CAMEL: Communicative Agents for "Mind" Exploration of Large Language Model Society**. *NeurIPS 2023*. [arXiv:2303.17760](https://arxiv.org/abs/2303.17760)
5. Shen, Y., Song, K., Tan, X., Li, D., Lu, W., & Zhuang, Y. (2023). **HuggingGPT: Solving AI Tasks with ChatGPT and its Friends in Hugging Face**. *NeurIPS 2023*. [arXiv:2303.17580](https://arxiv.org/abs/2303.17580)
6. Gottweis, J., et al. (2025). **Towards an AI co-scientist**. [arXiv:2502.18864](https://arxiv.org/abs/2502.18864) and Nature (2026).
7. Madaan, A., Tandon, N., Gupta, P., et al. (2023). **Self-Refine: Iterative Refinement with Self-Feedback**. *NeurIPS 2023*. [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)
8. Shinn, N., Cassano, F., Berman, E., Gopinath, A., Narasimhan, K., & Yao, S. (2023). **Reflexion: Language Agents with Verbal Reinforcement Learning**. *NeurIPS 2023*. [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)
9. Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao, Y., & Narasimhan, K. (2023). **Tree of Thoughts: Deliberate Problem Solving with Large Language Models**. *NeurIPS 2023*. [arXiv:2305.10601](https://arxiv.org/abs/2305.10601)
10. Wei, J., et al. (2022). **Chain-of-Thought Prompting Elicits Reasoning in Large Language Models**. *NeurIPS 2022*. [arXiv:2201.11903](https://arxiv.org/abs/2201.11903)

### Verification, critique, and reward modeling

11. Manakul, P., Liusie, A., & Gales, M. J. F. (2023). **SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models**. *EMNLP 2023*. [arXiv:2303.08896](https://arxiv.org/abs/2303.08896)
12. Lightman, H., et al. (2023). **Let's Verify Step by Step**. *OpenAI*. [openai.com/index/improving-mathematical-reasoning-with-process-supervision/](https://openai.com/index/improving-mathematical-reasoning-with-process-supervision/)
13. Bai, Y., et al. (2022). **Constitutional AI: Harmlessness from AI Feedback**. *Anthropic*. [arXiv:2212.08073](https://arxiv.org/abs/2212.08073)
14. Zheng, L., et al. (2023). **Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena**. *NeurIPS 2023*. [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)

### LLM Quantization — Post-Training

15. Frantar, E., Ashkboos, S., Hoefler, T., & Alistarh, D. (2022). **GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers**. *ICLR 2023*. [arXiv:2210.17323](https://arxiv.org/abs/2210.17323)
16. Lin, J., Tang, J., Tang, H., Yang, S., Dang, X., Gan, C., & Han, S. (2023). **AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration**. *MLSys 2024 Best Paper*. [arXiv:2306.00978](https://arxiv.org/abs/2306.00978)
17. Xiao, G., Lin, J., Seznec, M., Wu, H., Demouth, J., & Han, S. (2022). **SmoothQuant: Accurate and Efficient Post-Training Quantization for Large Language Models**. *ICML 2023*. [arXiv:2211.10438](https://arxiv.org/abs/2211.10438)
18. Yao, Z., et al. (2022). **ZeroQuant: Efficient and Affordable Post-Training Quantization for Large-Scale Transformers**. *NeurIPS 2022*. [Microsoft Research](https://www.microsoft.com/en-us/research/publication/zeroquant-efficient-and-affordable-post-training-quantization-for-large-scale-transformers/)
19. Shao, W., et al. (2023). **OmniQuant: Omnidirectionally Calibrated Quantization for Large Language Models**. *ICLR 2024 Spotlight*. [arXiv:2308.13137](https://arxiv.org/abs/2308.13137)
20. Liu, Z., et al. (2024). **SpinQuant: LLM Quantization with Learned Rotations**. *ICLR 2025*. [arXiv:2405.16406](https://arxiv.org/abs/2405.16406)

### LLM Quantization — Aware Training and Extreme Compression

21. Liu, Z., et al. (2023). **LLM-QAT: Data-Free Quantization Aware Training for Large Language Models**. *ACL 2024 Findings*. [arXiv:2305.17888](https://arxiv.org/abs/2305.17888)
22. Ma, S., et al. (2024). **The Era of 1-bit LLMs: All Large Language Models are in 1.58 Bits** (BitNet b1.58). *Microsoft Research*. [arXiv:2402.17764](https://arxiv.org/abs/2402.17764)
23. Wang, H., et al. (2024). **BitNet a4.8: 4-bit Activations for 1-bit LLMs**. *Microsoft Research*.
24. Liu et al. (2025). **Quantization Meets Reasoning: Exploring LLM Low-Bit Quantization Degradation for Mathematical Reasoning**. [arXiv:2501.03035](https://arxiv.org/abs/2501.03035)
25. Egiazarian, V., et al. (2024). **Extreme Compression of Large Language Models via Additive Quantization** (AQLM). [arXiv:2401.06118](https://arxiv.org/abs/2401.06118)

### Parameter-Efficient Fine-Tuning

26. Hu, E. J., Shen, Y., Wallis, P., Allen-Zhu, Z., Li, Y., Wang, S., Wang, L., & Chen, W. (2021). **LoRA: Low-Rank Adaptation of Large Language Models**. *ICLR 2022*. [arXiv:2106.09685](https://arxiv.org/abs/2106.09685)
27. Dettmers, T., Pagnoni, A., Holtzman, A., & Zettlemoyer, L. (2023). **QLoRA: Efficient Finetuning of Quantized LLMs**. *NeurIPS 2023*. [arXiv:2305.14314](https://arxiv.org/abs/2305.14314)
28. Liu, S.-Y., et al. (2024). **DoRA: Weight-Decomposed Low-Rank Adaptation**. *ICML 2024 Oral*. [arXiv:2402.09353](https://arxiv.org/abs/2402.09353)
29. Wu, C., et al. (2024). **LLaMA Pro: Progressive LLaMA with Block Expansion**. *ACL 2024*. [arXiv:2401.02415](https://arxiv.org/abs/2401.02415)
30. Komatsuzaki, A., et al. (2022). **Sparse Upcycling: Training Mixture-of-Experts from Dense Checkpoints**. [arXiv:2212.05055](https://arxiv.org/abs/2212.05055)
31. Yadav, P., et al. (2023). **TIES-Merging: Resolving Interference When Merging Models**. *NeurIPS 2023*.
32. Yu, L., et al. (2024). **Language Models are Super Mario: Absorbing Abilities from Homologous Models as a Free Lunch** (DARE). *ICML 2024*.

### Domain-Specific Scientific LLMs

33. Beltagy, I., Lo, K., & Cohan, A. (2019). **SciBERT: A Pretrained Language Model for Scientific Text**. *EMNLP 2019*. [arXiv:1903.10676](https://arxiv.org/abs/1903.10676)
34. Chithrananda, S., Grand, G., & Ramsundar, B. (2020). **ChemBERTa: Large-Scale Self-Supervised Pretraining for Molecular Property Prediction**. [arXiv:2010.09885](https://arxiv.org/abs/2010.09885)
35. Ross, J., et al. (2022). **MolFormer: Large-Scale Chemical Language Representations**.
36. Taylor, R., et al. (2022). **Galactica: A Large Language Model for Science**. *Meta AI*. [arXiv:2211.09085](https://arxiv.org/abs/2211.09085)
37. Singhal, K., et al. (2023). **Towards Expert-Level Medical Question Answering with Large Language Models** (Med-PaLM 2). *Nature Medicine 2025*. [arXiv:2305.09617](https://arxiv.org/abs/2305.09617)
38. Wu, C., Zhang, X., Zhang, Y., Wang, Y., & Xie, W. (2023). **PMC-LLaMA: Towards Building Open-source Language Models for Medicine**. [arXiv:2304.14454](https://arxiv.org/abs/2304.14454)
39. Gururangan, S., et al. (2020). **Don't Stop Pretraining: Adapt Language Models to Domains and Tasks**. *ACL 2020*. [aclanthology.org/2020.acl-main.740](https://aclanthology.org/2020.acl-main.740/)
40. Luo, Y., et al. (2023). **An Empirical Study of Catastrophic Forgetting in Large Language Models During Continual Fine-tuning**. [arXiv:2308.08747](https://arxiv.org/abs/2308.08747)

### Tool Use, MCP, and Retrieval

41. Schick, T., et al. (2023). **Toolformer: Language Models Can Teach Themselves to Use Tools**. *NeurIPS 2023*. [arXiv:2302.04761](https://arxiv.org/abs/2302.04761)
42. Yao, S., et al. (2023). **ReAct: Synergizing Reasoning and Acting in Language Models**. *ICLR 2023*. [arXiv:2210.03629](https://arxiv.org/abs/2210.03629)
43. Anthropic (2024). **Model Context Protocol Specification**. [modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-11-25)
44. Lewis, P., et al. (2020). **Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks**. *NeurIPS 2020*. [arXiv:2005.11401](https://arxiv.org/abs/2005.11401)
45. BAAI. **BGE: BAAI General Embedding Models**. [huggingface.co/BAAI](https://huggingface.co/BAAI/bge-large-en-v1.5)
46. Ma, Y., et al. (2024). **SciAgent: Tool-augmented Language Models for Scientific Reasoning**. [arXiv:2402.11451](https://arxiv.org/abs/2402.11451)

### AI for Scientific Discovery

47. Trinh, T. H., et al. (2024). **Solving Olympiad Geometry without Human Demonstrations** (AlphaGeometry). *Nature*, 625, 476-482. [nature.com/articles/s41586-023-06747-5](https://www.nature.com/articles/s41586-023-06747-5)
48. Abramson, J., et al. (2024). **Accurate structure prediction of biomolecular interactions with AlphaFold 3**. *Nature*, 630, 493-500. [nature.com/articles/s41586-024-07487-w](https://www.nature.com/articles/s41586-024-07487-w)
49. Zhang, Y., et al. (2024). **A Comprehensive Survey of Scientific Large Language Models and Their Applications in Scientific Discovery**. *EMNLP 2024*. [arXiv:2406.10833](https://arxiv.org/abs/2406.10833)
50. **LLM4SR: A Survey on Large Language Models for Scientific Research**. (2025). [arXiv:2501.04306](https://arxiv.org/abs/2501.04306)
51. **From Automation to Autonomy: A Survey on Large Language Models in Scientific Discovery**. (2025). [arXiv:2505.13259](https://arxiv.org/abs/2505.13259)

### Open-Weights Base Models

52. Dubey, A., et al. (2024). **The Llama 3 Herd of Models**. *Meta AI*. [arXiv:2407.21783](https://arxiv.org/abs/2407.21783)
53. Gemma Team (2025). **Gemma 3 Technical Report**. *Google DeepMind*. [arXiv:2503.19786](https://arxiv.org/abs/2503.19786)
54. Yang, A., et al. (2024). **Qwen2.5 Technical Report**. *Alibaba*. [arXiv:2412.15115](https://arxiv.org/abs/2412.15115)
55. Abdin, M., et al. (2024). **Phi-3 Technical Report: A Highly Capable Language Model Locally on Your Phone**. *Microsoft*. [arXiv:2404.14219](https://arxiv.org/abs/2404.14219)
56. Jiang, A. Q., et al. (2024). **Mixtral of Experts**. *Mistral AI*. [arXiv:2401.04088](https://arxiv.org/abs/2401.04088)
57. DeepSeek-AI (2024). **DeepSeek-V3 Technical Report**. [arXiv:2412.19437](https://arxiv.org/abs/2412.19437)

### Evaluation Benchmarks

58. Rein, D., et al. (2023). **GPQA: A Graduate-Level Google-Proof Q&A Benchmark**. [arXiv:2311.12022](https://arxiv.org/abs/2311.12022)
59. Wang, Y., et al. (2024). **MMLU-Pro: A More Robust and Challenging Multi-Task Language Understanding Benchmark**. *NeurIPS 2024 Datasets and Benchmarks*. [arXiv:2406.01574](https://arxiv.org/abs/2406.01574)

### Synthetic Data and Continued Pretraining

60. Wang, Y., et al. (2022). **Self-Instruct: Aligning Language Models with Self-Generated Instructions**. *ACL 2023*. [arXiv:2212.10560](https://arxiv.org/abs/2212.10560)

### Serving and Quantization Tooling

61. Gerganov, G., et al. **llama.cpp**. [github.com/ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
62. **Ollama**: local LLM runtime. [ollama.com](https://ollama.com)

### Information-Theoretic Foundations

63. **Neural Network Activation Quantization with Bitwise Information Bottlenecks**. (2020). [arXiv:2006.05210](https://arxiv.org/abs/2006.05210)

---

**Note on coverage**: this review prioritizes peer-reviewed and arXiv-hosted primary sources. Survey papers (refs 49–51) provide broader coverage of the AI-for-science landscape than enumerated here. The user should validate citations and follow chains-of-references via Semantic Scholar / Google Scholar before relying on this review for the final paper's bibliography — some 2024–2026 papers may have updated versions, retractions, or follow-up work not captured here.
