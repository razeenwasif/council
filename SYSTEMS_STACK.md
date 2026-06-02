# Systems & ML Stack — RTX 4090 / 7800X3D / 64GB / WSL2

> State-of-the-art tools and configurations for running the quantized-specialist-verifier research project (`ROADMAP.md`, `RESEARCH_PROPOSAL.md`) on the author's specific hardware. Opinionated. Where multiple options exist, the recommended choice is the first one listed; alternatives are noted with reasons to switch.

**Target hardware**:
- GPU: NVIDIA RTX 4090 (24 GB GDDR6X, Ada Lovelace, 16384 CUDA cores, FP8 tensor cores)
- CPU: AMD Ryzen 7 7800X3D (8 cores / 16 threads, 96 MB L3 with 3D V-cache, Zen 4)
- RAM: 64 GB DDR5
- Storage: ~500 GB SSD free
- OS: Windows 11 + WSL2 (Ubuntu)

**Last updated**: 2026-06-02
**Companion**: `WEEKLY_PLAN.md` Week 0 todos depend on having this stack installed.

---

## 0. Hardware Budget Analysis — What Actually Fits in 24 GB

A blunt summary of what is and isn't feasible on a 4090. This is the constraint that shapes every other decision below.

### Inference

| Model size | Precision | Approx VRAM | Fits in 24 GB? | Notes |
| ---------- | --------- | ----------- | -------------- | ----- |
| 7B         | FP16/BF16 | 14 GB       | yes, comfortably | full context easily |
| 13B        | FP16/BF16 | 26 GB       | no — needs Q8 | Q8 fits (~14 GB) |
| 31B (Gemma 4) | FP16   | 62 GB       | no | offload not viable |
| 31B        | Q8_0      | ~33 GB      | no — borderline | needs CPU offload |
| 31B        | Q5_K_M    | ~22 GB      | **yes, tight** | leaves ~2 GB for KV cache; 4K-8K context |
| 31B        | Q4_K_M    | ~19 GB      | **yes** | ~5 GB free for KV cache; 16K+ context |
| 31B        | Q3_K_M    | ~14 GB      | yes | plenty headroom; useful for QAT-comparable inference |
| 31B        | Q2_K      | ~11 GB      | yes | experimental quality |
| 70B        | Q4_K_M    | ~42 GB      | no | not feasible on single 4090 |

**Implication for the project**: Gemma-4-31B inference comfortably fits at Q4_K_M and below. The Phase 3 quantization sweep (Q8 → Q2) runs entirely on the 4090 for inference. **No rental needed for inference**.

### Training (QLoRA on a quantized base)

| Base model | Base precision | LoRA precision | VRAM peak | Fits? |
| ---------- | -------------- | -------------- | --------- | ----- |
| 7B         | NF4 (4-bit)   | BF16 r=64      | ~10 GB    | yes, plenty room |
| 13B        | NF4           | BF16 r=64      | ~13 GB    | yes |
| 31B        | NF4           | BF16 r=64      | ~22 GB    | **yes, but tight** — disable gradient accumulation > 4, batch ≤ 2 |
| 31B        | NF4           | BF16 r=128     | ~25 GB    | **OOM risk** — drop rank, or rent A100 |
| 70B        | NF4           | BF16 r=64      | ~42 GB    | no — rental |

**Implication for the project**: Gemma-4-31B QLoRA training is **feasible on the 4090 with careful settings**, but headroom is small. Recommended settings for Phase 2 training:
- Base in NF4 (bitsandbytes)
- LoRA rank 64, alpha 16, BF16 adapter
- Per-device batch size 1, gradient accumulation 8 (effective batch 8)
- Gradient checkpointing ON
- Flash Attention 2 ON
- Unsloth (sees ~2× speedup + ~30% VRAM savings vs. vanilla PEFT)

If anything fails to fit (especially during longer-context training), rent a single A100 80GB for ~$50 over Phase 2.

### Training (full fine-tune, no LoRA)

Not feasible at 31B on 24 GB. Don't try. LoRA is the correct path.

---

## 1. WSL2 Setup Essentials

WSL2 specifics that genuinely matter for this workload.

### `.wslconfig` (in `C:\Users\<you>\.wslconfig` on Windows)

```ini
[wsl2]
memory=56GB              # leave 8 GB for Windows; raise to 60 only if Windows is idle
processors=14            # leave 2 logical cores for Windows
swap=16GB                # keep some swap; bitsandbytes occasionally spills
swapFile=D:\\wsl-swap.vhdx  # put swap on a separate drive if available
localhostForwarding=true
nestedVirtualization=false  # off unless you need it; saves overhead
pageReporting=true       # better memory reclaim under pressure

[experimental]
sparseVhd=true           # WSL2 VHDX shrinks automatically (Windows 11 22H2+)
autoMemoryReclaim=gradual
```

After editing: `wsl --shutdown` then reopen WSL.

### Filesystem performance — the critical rule

**Keep all project files inside the WSL filesystem (`~/`), not on `/mnt/c/`.** Crossing the WSL ↔ Windows filesystem boundary is *order-of-magnitude* slower than staying inside one. Symptom: `pip install`, `git status`, `bun install` taking 10× longer than they should.

```bash
# Right
~/Research/quant-specialist/

# Wrong
/mnt/c/Users/you/Research/quant-specialist/
```

For editing in VS Code, use **Remote-WSL** — VS Code opens a server inside WSL and treats it as native.

### VHDX disk management

WSL2 stores everything in a sparse VHDX file. It grows but doesn't shrink automatically (unless `sparseVhd=true` on Win11 22H2+). After deleting large files inside WSL, the VHDX can stay bloated.

```powershell
# In Windows PowerShell (Admin):
wsl --shutdown
# Locate the VHDX:
ls $env:LOCALAPPDATA\Packages\CanonicalGroupLimited.UbuntuonWindowsLTS*\LocalState\ext4.vhdx
# Compact it:
Optimize-VHD -Path "<path-to-ext4.vhdx>" -Mode Full
```

Run this monthly or after each Phase to reclaim disk.

### CUDA + NVIDIA drivers

- Install the **NVIDIA Windows driver** (not the Linux one inside WSL). The Windows driver exposes the GPU to WSL via `/dev/dxg`.
- Inside WSL: install the **CUDA toolkit only** (no driver). Use the WSL-specific installer:
  ```bash
  wget https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb
  sudo dpkg -i cuda-keyring_1.1-1_all.deb
  sudo apt update
  sudo apt install cuda-toolkit-12-4
  ```
- Verify: `nvidia-smi` (should show the 4090) and `nvcc --version` (should show CUDA 12.4+).
- Recommended CUDA: **12.4 or 12.6**. PyTorch 2.5+ has stable kernels at these versions.

### Systemd in WSL

Enable systemd so services (Ollama, Docker, etc.) work normally:

```ini
# /etc/wsl.conf
[boot]
systemd=true

[interop]
enabled=true
appendWindowsPath=false   # keep WSL PATH clean; opt-in to Windows tools per-shell
```

`wsl --shutdown` then re-enter.

---

## 2. Storage Management Strategy

500 GB free is tight for this project. Budget upfront and prune aggressively.

### Disk budget (estimated)

| Component | Size | Path |
| --------- | ---- | ---- |
| Gemma-4-31B FP16 weights | ~62 GB | `~/.ollama/models/` or `~/hf-cache/` |
| Gemma-4-31B Q4_K_M GGUF | ~20 GB | `~/.ollama/models/` |
| 6 quantization variants of GW specialist | ~120 GB | `~/Research/quants/` |
| Training corpus (raw + tokenized) | ~40 GB | `~/Research/corpus/` |
| HuggingFace cache (other models, datasets) | ~50 GB cap | `~/hf-cache/` |
| Eval set + intermediate artifacts | ~10 GB | `~/Research/eval/` |
| Python environments | ~15 GB | `~/.venvs/` |
| OS + dev tooling | ~20 GB | system |
| Buffer / safety margin | ~50 GB | — |
| **Project total** | **~387 GB** | leaves ~113 GB free |

### HuggingFace cache control

By default HF puts caches in `~/.cache/huggingface/`. Tell it explicitly where to live (lets you nuke + move easily):

```bash
# In ~/.bashrc or ~/.zshrc
export HF_HOME=~/hf-cache
export HF_HUB_CACHE=$HF_HOME/hub
export HF_DATASETS_CACHE=$HF_HOME/datasets
export HF_HUB_DISABLE_TELEMETRY=1
```

To download a model once and use it many times *without* duplicate disk usage:

```python
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="google/gemma-3-27b-it",
    local_dir="~/Research/models/gemma-3-27b",
    local_dir_use_symlinks=False,  # avoid HF cache symlinks for portability
)
```

### Periodic cleanup

```bash
# Inside WSL — show biggest disk consumers
du -sh ~/Research/* | sort -h | tail -20
du -sh ~/hf-cache/* | sort -h | tail -20

# Prune HF cache (older than 30 days)
huggingface-cli cache scan
huggingface-cli delete-cache  # interactive

# Clear Python build caches
pip cache purge
uv cache prune
```

### External storage (if it gets tight)

The 7800X3D's PCIe 5.0 lanes mean adding a second NVMe is cheap and fast. If disk pressure becomes real, dedicate a second NVMe to `~/Research/quants/` (the largest single consumer at ~120 GB).

---

## 3. Python Environment — `uv` over `pip + venv`

**Use [uv](https://github.com/astral-sh/uv)**. It's the current SOTA Python package manager: 10–100× faster than pip, deterministic lockfiles, drop-in replacement for `pip install`.

### Install

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Per-project setup

```bash
cd ~/Research/quant-specialist
uv venv --python 3.11  # 3.11 is the current sweet spot; 3.12 still has C-ext compat issues for some ML libs
source .venv/bin/activate
uv pip install -r requirements.txt
uv pip freeze > requirements-lock.txt  # commit this
```

For a project that needs reproducibility (this one): always work from `requirements-lock.txt`, never `requirements.txt`. Update with `uv pip compile requirements.in -o requirements-lock.txt` when adding deps.

### Recommended `requirements.in` skeleton

```
# Core ML
torch>=2.5,<2.7         # CUDA 12.4-compatible
transformers>=4.46
peft>=0.13
accelerate>=1.1
bitsandbytes>=0.44
datasets>=3.1
safetensors>=0.4
sentencepiece
einops

# Training acceleration
unsloth                  # 2x faster LoRA on consumer GPUs
flash-attn               # FA2 — install with --no-build-isolation
xformers                 # memory-efficient attention fallback
liger-kernel             # fused kernels, big VRAM savings

# Quantization
auto-gptq>=0.7
autoawq>=0.2
# (llama.cpp is a separate non-Python install — see §5)

# Serving + evaluation
vllm>=0.6                # main serving stack
lm-eval                  # EleutherAI lm-evaluation-harness
inspect-ai               # UK AISI's newer eval framework

# Data pipeline
arxiv                    # arXiv API wrapper
nougat-ocr               # PDF → markdown for scientific papers
pypdf
text-dedup               # MinHash-based corpus dedup

# Experiment tracking
wandb                    # primary tracker
mlflow                   # local fallback option

# Utility
pydantic>=2
typer                    # CLI scaffolding
loguru                   # logging
hydra-core               # config management
omegaconf
rich                     # nicer terminal output
tqdm
```

Install Flash Attention separately (it requires CUDA at install time and is the most-common installation pain point):

```bash
uv pip install flash-attn --no-build-isolation
```

If FA2 install fails, fall back to xformers — it's almost as good for training and works everywhere.

---

## 4. Training Stack

The single most impactful choice: **use Unsloth + bitsandbytes for QLoRA**. The combination is ~2× faster and uses ~30% less VRAM than vanilla HuggingFace PEFT on a 24 GB GPU.

### Unsloth — the headline tool

Open-source, designed for consumer GPUs. Provides drop-in replacements for HF training that use custom Triton kernels and quantization-aware fast attention.

**Installation**:

```bash
uv pip install "unsloth[cu124-ampere-torch250] @ git+https://github.com/unslothai/unsloth.git"
# Or use the precompiled wheels — see unsloth.ai/install
```

**Example: QLoRA fine-tune of Gemma-3-27B on 4090** (adapt for Gemma-4 path when available):

```python
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments

max_seq_length = 4096
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/gemma-3-27b-it-bnb-4bit",  # pre-quantized 4-bit base
    max_seq_length=max_seq_length,
    dtype=None,           # auto BF16 on Ada
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=64,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",  # IMPORTANT — Unsloth's GC is faster
    random_state=3407,
    use_rslora=False,
    loftq_config=None,
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=ds,            # your assembled corpus
    dataset_text_field="text",
    max_seq_length=max_seq_length,
    args=TrainingArguments(
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        warmup_steps=10,
        max_steps=2000,
        learning_rate=2e-4,
        bf16=True,                # 4090 supports BF16 natively
        fp16=False,
        logging_steps=10,
        optim="adamw_8bit",       # 8-bit AdamW saves significant VRAM
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=3407,
        output_dir="outputs",
        report_to="wandb",
        save_steps=500,
    ),
)

trainer.train()
```

**Why these specific knobs**:

- `bnb-4bit` quantized base means the frozen weights live in 4-bit, saving ~75% of VRAM that the base would otherwise consume.
- `adamw_8bit` saves another large chunk of VRAM (optimizer states are usually 2× the param count in FP32).
- `bf16=True` is correct for Ada Lovelace; never use `fp16=True` for training on a 4090 unless you've verified the model converges (some LoRA configs have FP16 NaN issues).
- `use_gradient_checkpointing="unsloth"` is critical — trades compute for memory and is the difference between fits-in-24GB vs. OOM at this scale.
- `target_modules` covers both attention and MLP projections (DoRA / LLaMA-Pro both show this matters).

### DoRA over plain LoRA

**[DoRA](https://arxiv.org/abs/2402.09353)** consistently beats plain LoRA at the same parameter count, with no inference overhead. Switch your `get_peft_model` call to `use_dora=True` (Unsloth supports it directly; HF PEFT supports it via `LoraConfig(use_dora=True)`).

### Liger Kernel — drop-in VRAM saver

[Liger Kernel](https://github.com/linkedin/Liger-Kernel) provides fused Triton kernels (RMSNorm, RoPE, SwiGLU, cross-entropy, fused linear+CE) that save 20-60% VRAM in training. Drop-in for HF models:

```python
from liger_kernel.transformers import apply_liger_kernel_to_gemma
apply_liger_kernel_to_gemma()  # call before model load
```

Compatible with Unsloth.

### Mixed precision: BF16 always, never FP16

The 4090's tensor cores have full BF16 support and BF16 has a much wider dynamic range than FP16 (same as FP32 exponent). LoRA + FP16 occasionally trains to NaN; LoRA + BF16 essentially never does.

### Optimizer choice

- `adamw_8bit` (bitsandbytes) — recommended default, ~50% VRAM savings vs. FP32 AdamW
- `adafactor` — even lower memory, but learning-rate-sensitive
- `lion_8bit` — newer, faster convergence claims on some tasks; experiment if `adamw_8bit` is too slow

### Gradient checkpointing modes

- `"unsloth"` — Unsloth's own implementation, fastest
- `True` (HF default) — standard, slower
- Don't disable — at 31B + LoRA on 24 GB, you need it

---

## 5. Quantization Toolkit

Different tools for different roles. You will probably use 2–3 of these.

### llama.cpp / GGUF — the portable workhorse

The community standard for serving quantized LLMs. Supports K-quant variants (Q2_K through Q8_0) that give better accuracy than naive bit truncation. **Ollama uses llama.cpp under the hood.**

**Install** (in WSL):

```bash
git clone https://github.com/ggml-org/llama.cpp ~/build/llama.cpp
cd ~/build/llama.cpp
cmake -B build -DLLAMA_CUDA=ON
cmake --build build --config Release -j
# Binary at ~/build/llama.cpp/build/bin/llama-quantize
```

**Quantize an FP16 model to all bit-depths** (Phase 3 sweep):

```bash
# First convert HF model to GGUF FP16
python convert_hf_to_gguf.py ~/Research/models/gw-specialist-fp16 \
    --outfile ~/Research/quants/gw-specialist-fp16.gguf

# Then quantize to each target bit-depth
for QUANT in Q8_0 Q6_K Q5_K_M Q4_K_M Q3_K_M Q2_K; do
    ./build/bin/llama-quantize \
        ~/Research/quants/gw-specialist-fp16.gguf \
        ~/Research/quants/gw-specialist-${QUANT,,}.gguf \
        $QUANT
done
```

**Why K-quants**: Q4_K_M is roughly Q4_0 quality but ~10% better perplexity for ~5% more bits, using mixed precision within each block (more bits for important weights, fewer for less important). For Phase 3 the K-quants are the right choice over the older Q4_0/Q5_0 formats.

### AWQ (Activation-aware Weight Quantization)

[AWQ](https://arxiv.org/abs/2306.00978), MLSys 2024 Best Paper. Hardware-friendly 4-bit weight-only quantization. Produces models compatible with vLLM, TensorRT-LLM, and TGI. Better for serving on GPU than GGUF (faster inference); GGUF is better for CPU and portable cross-machine.

**Install + use**:

```bash
uv pip install autoawq
```

```python
from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

model_path = "~/Research/models/gw-specialist-fp16"
quant_path = "~/Research/quants/gw-specialist-awq"

quant_config = {"zero_point": True, "q_group_size": 128, "w_bit": 4, "version": "GEMM"}

model = AutoAWQForCausalLM.from_pretrained(model_path)
tokenizer = AutoTokenizer.from_pretrained(model_path)
model.quantize(tokenizer, quant_config=quant_config)
model.save_quantized(quant_path)
tokenizer.save_pretrained(quant_path)
```

Use AWQ over GGUF when you need maximum GPU inference throughput (Phase 4 eval passes benefit).

### GPTQ via AutoGPTQ

Alternative 4/3/2-bit weight quantization. Slightly worse than AWQ for inference speed but very mature. Use if AWQ has compatibility issues with your specific base model.

```bash
uv pip install auto-gptq
```

### bitsandbytes NF4 (for QLoRA training)

NF4 (4-bit NormalFloat) from [QLoRA](https://arxiv.org/abs/2305.14314). Used at *training* time to quantize the frozen base while LoRA adapters train in higher precision. **Not a separate step you run** — it's enabled via `load_in_4bit=True` in your transformers/unsloth load call. NF4 is the de facto standard for QLoRA.

### Quantization-aware training (QAT) for Phase 3

For the project's QAT comparison: there's no single SOTA tool; you build it from primitives. Two paths:

**Path A — LLM-QAT methodology** ([Liu et al. 2023](https://arxiv.org/abs/2305.17888)):
- Generate synthetic data from FP16 teacher
- Train student at target bit-depth with fake-quant ops
- Reference implementation: [github.com/facebookresearch/LLM-QAT](https://github.com/facebookresearch/LLM-QAT)

**Path B — LoRA + fake-quant** (simpler):
- Apply quantization-aware ops to the merged base + LoRA during training
- Use [torchao](https://github.com/pytorch/ao) (PyTorch's official quantization library, replacing the older `torch.quantization`)
- `torchao.quantization.quantize_(model, int4_weight_only())` with QAT mode

Start with Path B for the project's Phase 3 — simpler, gets you to a result faster. Escalate to Path A only if PTQ and Path-B QAT are indistinguishable.

### SOTA quantization research worth tracking (but not using yet)

- **SpinQuant** — learned rotation matrices, best published 4-bit quality. Limited tooling. Watch for HF integration.
- **QuaRot** — Hadamard-rotation precursor to SpinQuant. Same caveat.
- **BitNet b1.58** — 1.58-bit *trained from scratch* (not PTQ-able). Not relevant for project unless you want to train from scratch (you don't).
- **AQLM** — extreme 2-bit additive quantization. Tool exists but mature only for Llama family.

---

## 6. Inference & Serving

Three options, each with its own role.

### Ollama — the daily driver

You already use it. **Keep using it for the Council's existing shim provider integration.** OpenAI-compatible API, GGUF under the hood, dead-simple model management.

Daily commands:

```bash
ollama list
ollama serve                                        # runs API on localhost:11434
ollama run gemma3:27b "What is gravitational lensing?"

# Create a custom model from a quantized GGUF:
cat > ~/Modelfiles/gw-specialist-q4.modelfile <<EOF
FROM ~/Research/quants/gw-specialist-q4_k_m.gguf
PARAMETER temperature 0.3
PARAMETER num_ctx 8192
SYSTEM "You are a verifier checking gravitational-wave physics claims..."
EOF
ollama create gw-specialist-q4 -f ~/Modelfiles/gw-specialist-q4.modelfile
```

For Phase 3's quantization sweep, **register each variant as its own Ollama model** — they become A/B-swappable from Council with one config line.

### vLLM — when throughput matters

When running Phase 3's eval sweeps (12 variants × 25 evals × ~5 voice calls = ~1500 inference calls), Ollama's sequential throughput becomes the bottleneck. Switch to vLLM for batched throughput.

```bash
uv pip install vllm
```

```bash
# Serve an AWQ model with vLLM
vllm serve ~/Research/quants/gw-specialist-awq \
    --port 8000 \
    --quantization awq \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.85
```

vLLM is OpenAI-compatible (same endpoint shape as Ollama), so Council's shim provider can target it with a config swap.

**Throughput delta**: vLLM is typically 5–10× faster than Ollama for parallel requests because of continuous batching. For Phase 3-4 eval passes, this turns hours into minutes.

### llama.cpp directly — for sanity checks

When debugging quantization quality, run `llama.cpp` directly with `--logits-all` to inspect token probabilities. Don't use this as your primary serving path; it lacks batching.

```bash
./build/bin/llama-cli \
    -m ~/Research/quants/gw-specialist-q4_k_m.gguf \
    -p "Verify: phase error from 4-bit PE accumulates as O(√N)" \
    --temp 0.3
```

### Inference engines you might hear about but probably don't need

- **ExLlamaV2** — fastest GPTQ/EXL2 inference on consumer GPUs. Use only if you commit to EXL2 format (which is excellent but less interoperable).
- **TGI** (HF Text Generation Inference) — production-grade serving. Overkill for a research project; vLLM is more flexible.
- **TensorRT-LLM** — NVIDIA's serving stack. Best raw performance, awful setup. Not worth it for this project.

---

## 7. Data Pipeline

Building the GW-specialist corpus (Week 3 of `WEEKLY_PLAN.md`).

### arXiv scraping

```python
import arxiv
search = arxiv.Search(
    query="cat:gr-qc OR cat:astro-ph.IM OR cat:eess.SP",
    max_results=30000,
    sort_by=arxiv.SortCriterion.SubmittedDate,
    sort_order=arxiv.SortOrder.Descending,
)
for paper in search.results():
    yield {
        "id": paper.entry_id,
        "title": paper.title,
        "abstract": paper.summary,
        "authors": [a.name for a in paper.authors],
        "date": paper.published.isoformat(),
        "pdf_url": paper.pdf_url,
    }
```

Be polite — rate-limit to ~3 requests/second. arXiv blocks aggressive scrapers.

### PDF → clean text (for full-text inclusion)

Two SOTA options for scientific PDFs:

- **[Nougat](https://github.com/facebookresearch/nougat)** (Meta) — academic PDF → markdown with proper math rendering. Trained on arXiv. Best for math-heavy papers.
- **[GROBID](https://github.com/kermitt2/grobid)** — structured extraction (sections, citations, references). Better for citation-graph work. Java-based, runs as a service.

For corpus building, Nougat is the right choice. Install via:

```bash
uv pip install nougat-ocr
nougat path/to/paper.pdf -o output_dir/
```

Nougat needs ~3-5 GB VRAM for its own inference (the small model). Run it sequentially with your training disabled to avoid contention, or use the CPU version (slow but works).

### Deduplication

Critical for corpus quality. Arxiv abstracts have lots of near-duplicates (revisions, related papers from the same group).

```bash
uv pip install text-dedup
```

Use MinHash LSH for ~M-token corpora — fast and good-enough:

```bash
python -m text_dedup.minhash \
    --path arxiv_corpus.jsonl \
    --output deduped.jsonl \
    --column text \
    --threshold 0.85 \
    --num_perm 256
```

### Tokenization caching

Tokenizing 100M tokens repeatedly is slow. Cache once with HuggingFace `datasets`:

```python
from datasets import load_dataset
ds = load_dataset("json", data_files="corpus.jsonl", split="train")
ds = ds.map(tokenize_fn, batched=True, num_proc=8, remove_columns=["text"])
ds.save_to_disk("~/Research/corpus/tokenized_v1")
# Reload instantly next time:
ds = load_from_disk("~/Research/corpus/tokenized_v1")
```

### General-instruction mix-in (for catastrophic forgetting mitigation)

Mix 20–30% general instruction data into the GW corpus. Recommended sources:

- **FLAN-v2** — broad instruction following
- **Alpaca / Alpaca-Cleaned** — short instruction-response pairs
- **OpenOrca** — GPT-4-generated reasoning instructions
- **MetaMathQA** — if math reasoning specifically matters

Use HuggingFace `datasets` to interleave:

```python
from datasets import interleave_datasets
mixed = interleave_datasets(
    [gw_corpus, flan_subset],
    probabilities=[0.75, 0.25],
    stopping_strategy="all_exhausted",
)
```

---

## 8. Evaluation Tooling

### lm-evaluation-harness (EleutherAI)

The current standard for LLM benchmarks (MMLU-Pro, GPQA, ARC, MATH, GSM8K, etc.).

```bash
uv pip install lm-eval
```

```bash
# Evaluate a local model on GPQA
lm_eval --model hf \
    --model_args pretrained=~/Research/models/gw-specialist-fp16,parallelize=True \
    --tasks gpqa_diamond_zeroshot \
    --batch_size auto:4 \
    --output_path eval_results/

# Or evaluate via vLLM (much faster)
lm_eval --model vllm \
    --model_args pretrained=~/Research/quants/gw-specialist-awq,quantization=awq \
    --tasks mmlu_pro,gpqa_diamond_zeroshot \
    --batch_size auto:8 \
    --output_path eval_results/
```

### Inspect AI (UK AISI)

Newer eval framework (released 2024) with cleaner abstractions for custom evals — better than lm-eval-harness when writing *your own* evals (which the project's Phase 0 rubric is).

```bash
uv pip install inspect-ai
```

Inspect treats evals as Python functions. Roughly:

```python
from inspect_ai import task, Task, eval
from inspect_ai.dataset import json_dataset
from inspect_ai.scorer import scorer

@task
def gw_rubric_eval():
    return Task(
        dataset=json_dataset("eval/briefs.jsonl"),
        solver=council_discover_solver(),
        scorer=rubric_scorer(),
    )

# Run it
eval(gw_rubric_eval(), model="ollama/gw-specialist-q4_k_m")
```

Use Inspect for the project's custom rubric eval. Use lm-eval-harness for standard benchmark cross-references.

### Bootstrap CI computation

For n=25 sample sizes, report bootstrap 95% CIs not p-values:

```python
import numpy as np
from scipy.stats import bootstrap

scores_baseline = np.array([...])
scores_with_spec = np.array([...])
diff = scores_with_spec - scores_baseline  # paired

ci = bootstrap((diff,), np.mean, n_resamples=10000, confidence_level=0.95)
print(f"Mean improvement: {diff.mean():.3f} (95% CI: [{ci.confidence_interval.low:.3f}, {ci.confidence_interval.high:.3f}])")
```

---

## 9. Experiment Tracking

### Weights & Biases — primary

Free for academic / personal use. Standard in ML research. Set up once:

```bash
uv pip install wandb
wandb login
```

Pass `report_to="wandb"` in `TrainingArguments`. Automatically logs loss, GPU memory, gradient norms, learning rate.

For the project, structure runs as:
- Project: `quant-specialist`
- Group: `phase2`, `phase3-ptq`, `phase3-qat`, `phase4`
- Tags: `gemma-4-31b`, `lora-rank-64`, `q4_k_m`, etc.

Filter views in the W&B UI to compare PTQ vs. QAT at the same bit-depth.

### Aim — local alternative

If you'd rather not push experiment data to a cloud service:

```bash
uv pip install aim
```

Aim runs entirely locally, has a nicer UI than MLflow, and is faster than TensorBoard for ML experiments. Use it if you prefer offline.

### Hydra for config management

Multiple experiments with different hyperparameters get unmanageable in argparse. Use Hydra for clean config sweeps:

```bash
uv pip install hydra-core
```

```yaml
# conf/config.yaml
defaults:
  - model: gemma_4_31b
  - data: gw_corpus_v1
  - training: lora_rank_64
  - quantization: q4_k_m
```

```bash
# Run multiple configs in a sweep
python train.py -m quantization=q8_0,q4_k_m,q3_k_m,q2_k
```

---

## 10. Monitoring & Observability

### GPU monitoring

```bash
# Standard, always-installed
watch -n 1 nvidia-smi

# Better — nvtop, has TUI graphs
sudo apt install nvtop
nvtop

# Comprehensive — includes memory pressure, ECC, etc.
sudo apt install nvidia-smi
nvidia-smi dmon -s pucvmet -d 2
```

### CPU + RAM

```bash
sudo apt install htop btop
btop  # better UI than htop
```

For the 7800X3D specifically: btop shows per-core load. If you see one or two cores pinned while others idle, your dataloader is the bottleneck — bump `num_workers` and `prefetch_factor` in PyTorch DataLoader.

### Disk I/O

```bash
sudo apt install iotop
sudo iotop -ao  # accumulates totals
```

If `iotop` shows >100 MB/s sustained during training, you're disk-bound. Move the dataset to `/tmp/` (RAM-backed in WSL) or pre-tokenize and cache.

### Network (for arXiv scraping, dataset downloads)

```bash
sudo apt install bmon
bmon
```

---

## 11. Cloud Burst Strategy

For tasks that don't fit on the 4090 or take too long locally. Most won't apply, but plan for fallbacks.

### When to rent

- QAT training of 31B at multiple bit-depths × multiple epochs → A100 80GB rental, ~3 days, ~$50-100.
- If LoRA training somehow OOMs at rank 64 → A100 80GB single session, ~24 hours, ~$30.
- Larger-context (32K+) fine-tunes for any extension work.

### Recommended providers (ranked by current pricing/quality)

| Provider | A100 80GB hourly | Notes |
| -------- | --------------- | ----- |
| vast.ai  | $0.40-0.80     | cheapest; community providers, variable quality. Filter for verified DCs. |
| RunPod   | $0.69-0.89     | better UX than vast; reliable. Templates available. |
| Lambda Labs | $1.10        | most expensive but most reliable; pre-paid plans |
| Modal    | $1.50-2.00     | serverless; pay per second of GPU use, good for short jobs |

### Workflow

Don't sync your whole project tree. Sync the essentials, train, sync results back:

```bash
# Set up tooling once
ssh-copy-id user@<pod-ip>

# Sync code + corpus (rsync skips unchanged files)
rsync -avz --exclude '__pycache__' --exclude 'outputs/' --exclude '.venv/' \
    ~/Research/quant-specialist/ user@<pod-ip>:~/quant-specialist/

# Run in tmux so disconnect doesn't kill the job
ssh user@<pod-ip>
tmux new -s train
cd ~/quant-specialist && python train.py ...
# Detach: Ctrl+B then D

# Pull results back
rsync -avz user@<pod-ip>:~/quant-specialist/outputs/ ~/Research/quant-specialist/outputs/
```

### Modal — for serverless one-shots

For really short jobs (like running an eval pass on 12 quantization variants), Modal is convenient — you pay only for actual GPU-seconds used:

```python
import modal
stub = modal.Stub("quant-eval")
image = modal.Image.debian_slim().pip_install("vllm", "lm-eval")

@stub.function(gpu="A100-80GB", image=image, timeout=3600)
def evaluate_variant(model_path: str, tasks: list[str]):
    # Run eval here
    ...

if __name__ == "__main__":
    with stub.run():
        for variant in ["q8", "q6", "q4", "q3", "q2"]:
            evaluate_variant.remote(f"models/spec-{variant}", ["mmlu_pro", "gpqa"])
```

---

## 12. Recommended Day-to-Day Workflow

### Terminal setup

- **Shell**: zsh + oh-my-zsh, or fish
- **Terminal multiplexer**: tmux (essential for long-running jobs)
- **Editor**: VS Code via Remote-WSL (the standard) or Neovim if you prefer
- **File-find**: `fd` (faster than find), `rg` (ripgrep, faster than grep), `fzf` for fuzzy-find
- **Disk usage**: `dust` (better than `du`)
- **Process viewer**: `btop`

### Project structure

```
~/Research/quant-specialist/
├── README.md
├── pyproject.toml        # uv config
├── requirements.in       # high-level deps
├── requirements-lock.txt # pinned versions
├── .python-version       # 3.11
├── conf/                 # Hydra configs
├── data/
│   ├── corpus/           # tokenized training data
│   ├── eval/             # eval set + rubric
│   └── briefs/           # /discover outputs
├── notebooks/            # exploratory analysis
├── src/
│   ├── train/            # training scripts
│   ├── quantize/         # PTQ + QAT scripts
│   ├── verifier/         # claim extractor + verifier interface
│   ├── eval/             # rubric scorer + harness wrappers
│   └── plots/            # paper figures
├── models/               # FP16 weights (large; .gitignored)
├── quants/               # quantized variants (large; .gitignored)
├── outputs/              # training outputs (large; .gitignored)
├── results/              # eval CSVs + plots (committed)
└── paper/                # LaTeX / markdown drafts
```

`.gitignore` the big stuff. Push checkpoint weights to HuggingFace Hub, not git.

### Daily loop (typical training day)

```
07:30  Start training run in tmux session 'train'. Verify wandb logging.
07:45  Open eval-analysis notebook in another tmux pane. Review yesterday's runs.
08:00  Begin writing — paper section, weekly writeup, or rubric notes.
10:00  Check training: nvtop shows GPU steady at ~95%? wandb loss curve healthy?
12:00  Lunch. Training continues in tmux.
13:00  Code review / refactor (the day's training is now half-done).
15:00  Training finishes. Run quick eval on held-out subset.
16:00  If results good, write up + commit. If bad, diagnose.
17:00  Plan tomorrow's experiment. Pre-stage next training config.
```

### Backup discipline

- All code in git, pushed to GitHub at end of each day
- Model checkpoints to HuggingFace Hub (private repo) at end of each successful run
- Eval CSVs + rubric scores committed to git (small text files)
- Raw briefs committed to git (also small)
- **Never** rely on the WSL VHDX as your only copy of anything important

```bash
# Daily cleanup script: ~/bin/eod-cleanup
#!/usr/bin/env bash
set -e
cd ~/Research/quant-specialist
git add -A
git status  # review before committing
git commit -m "wip: $(date +%Y-%m-%d) progress"
git push origin "$(git branch --show-current)"
```

### Things to automate early

- `make train` / `just train` — one-liner to kick off training with current config
- `make eval` — runs eval harness against latest checkpoint
- `make plot` — regenerates paper figures from eval CSVs
- `make sync-cloud` — rsync code + corpus to RunPod
- `make pull-results` — rsync results back

Use **[just](https://github.com/casey/just)** as a friendlier `make` if you prefer:

```just
default:
    just --list

train config="default":
    python src/train/train.py --config-name {{config}}

eval variant:
    lm_eval --model vllm --model_args pretrained=quants/{{variant}} \
        --tasks mmlu_pro,gpqa_diamond_zeroshot --output_path results/{{variant}}/

plot:
    python src/plots/generate_all.py
```

---

## 13. Specific Recommendations for Each Phase

Mapping the toolkit to `WEEKLY_PLAN.md`:

### Phase 0 (Eval harness)
- Tools needed: nothing beyond Python + a spreadsheet
- Resist tooling temptation; the rubric is human work

### Phase 1 (Baseline characterization)
- Run existing Council/`/discover` against eval set
- Track per-voice cost via existing `/spend` infrastructure
- Use pandas + matplotlib for failure-mode histogram

### Phase 2 (FP16 specialist)
- Unsloth + bitsandbytes + Liger Kernel for training
- Data prep: arxiv lib + Nougat + text-dedup
- Hydra for config; W&B for tracking
- Ollama for serving (since Council shim already targets it)
- Inspect AI for the rubric eval

### Phase 3 (Quantization sweep)
- llama.cpp for PTQ (5 K-quant variants)
- AutoAWQ for AWQ comparison (optional alternative format)
- torchao for QAT (4 bit-depths)
- vLLM for parallel eval throughput
- W&B groups: `phase3-ptq` vs. `phase3-qat`

### Phase 4 (MCP integration)
- arXiv MCP: `andybrandt/mcp-simple-arxiv`
- Wolfram MCP: official from Wolfram or community wrapper
- Code-exec MCP: E2B or Modal sandbox (Modal is better for one-shot execution; E2B is better for stateful sessions)
- Latency profiling: just time each MCP call

### Phase 5+ (additional specialists)
- Same stack, different corpora
- Consider Qwen 2.5 32B as alternative base for math-heavy specialty
- For merging: mergekit ([github.com/arcee-ai/mergekit](https://github.com/arcee-ai/mergekit)) supports TIES + DARE

---

## 14. Anti-Patterns Specific to This Hardware

- **Running training and inference concurrently on the 4090.** 24 GB doesn't have headroom. Pause Ollama (`ollama stop`) before training; resume after.
- **Letting WSL2 consume all RAM.** `.wslconfig` `memory=56GB` is non-negotiable; otherwise Windows starts swapping and everything grinds.
- **Training on a Windows-side path** (`/mnt/c/...`). 10× slower than the WSL filesystem.
- **Forgetting to compact the VHDX.** Disk usage will silently bloat over weeks.
- **Trusting FP16 training.** Use BF16 always on Ada Lovelace.
- **Skipping flash-attn install pain** and using SDPA instead. Flash-attn 2 is ~30% memory savings; worth the 30-minute install fight.
- **Running Phase 3's eval sweep through Ollama sequentially.** Switch to vLLM for batched throughput; saves hours per eval pass.
- **Storing 12 quantization variants on the same SSD as the OS.** Add a second NVMe if disk pressure hits before Phase 3.

---

## 15. Quick Reference — One-Liners

```bash
# What's filling up disk?
dust -d 2 ~/Research/

# How much VRAM right now?
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader

# Active conda/uv env?
which python && python --version

# Compact WSL VHDX (run from Windows PowerShell after wsl --shutdown)
Optimize-VHD -Path "<vhdx-path>" -Mode Full

# Quick GGUF quantize all bit-depths
for Q in Q8_0 Q6_K Q5_K_M Q4_K_M Q3_K_M Q2_K; do llama-quantize in.gguf out-${Q,,}.gguf $Q; done

# Serve a GGUF via Ollama
ollama create my-model -f Modelfile && ollama run my-model

# vLLM eval throughput
vllm serve model_path --quantization awq --gpu-memory-utilization 0.85

# Quick rubric eval with Inspect
inspect eval src/eval/gw_rubric.py --model ollama/gw-specialist-q4_k_m

# Cloud rsync up
rsync -avz --exclude .venv ~/Research/quant-specialist/ user@pod:~/qs/

# Watch training in tmux
tmux new -s train -d 'python train.py' && tmux attach -t train

# Kill all stuck CUDA processes
sudo fuser -v /dev/nvidia* 2>&1 | grep python | awk '{print $2}' | xargs -r kill -9
```

---

## 16. What This Stack Deliberately Excludes

To keep the project focused, the following SOTA options are **not** in scope and should not be added without good reason:

- **Distributed training (DeepSpeed, FSDP)** — overkill for single-4090 LoRA work. Adds setup complexity, debugging surface.
- **Triton/CUDA kernel writing** — Unsloth + Liger Kernel already provide the kernel wins. Writing your own is a research direction unto itself.
- **Custom dataloaders / shard formats (WebDataset, TFRecord)** — HF `datasets` is sufficient for corpora <100 GB.
- **MLX / JAX** — if you switch GPUs to Apple Silicon, sure. On a 4090, stick with PyTorch.
- **Diffusion / generative-image stacks** — not relevant to this project.
- **RLHF / DPO training stack** — Phase 5+ might explore preference fine-tuning but Phase 0–4 is supervised. Don't pre-build for DPO.

The principle: every tool above earns its place by addressing a constraint in `ROADMAP.md`. Tools that don't are noise.

---

## 17. References to Tools Cited

- [Unsloth](https://github.com/unslothai/unsloth) — 2× faster LoRA on consumer GPUs
- [bitsandbytes](https://github.com/bitsandbytes-foundation/bitsandbytes) — 4/8-bit quantization for QLoRA
- [Liger Kernel](https://github.com/linkedin/Liger-Kernel) — fused VRAM-saving kernels
- [Flash Attention](https://github.com/Dao-AILab/flash-attention) — memory-efficient attention
- [llama.cpp](https://github.com/ggml-org/llama.cpp) — GGUF + K-quants
- [AutoAWQ](https://github.com/casper-hansen/AutoAWQ) — AWQ quantization
- [AutoGPTQ](https://github.com/AutoGPTQ/AutoGPTQ) — GPTQ quantization
- [torchao](https://github.com/pytorch/ao) — PyTorch's quantization library (incl. QAT)
- [vLLM](https://github.com/vllm-project/vllm) — high-throughput LLM serving
- [Ollama](https://ollama.com) — local LLM runtime (uses llama.cpp)
- [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) — EleutherAI eval framework
- [Inspect AI](https://inspect.ai-safety-institute.org.uk/) — UK AISI eval framework
- [Nougat](https://github.com/facebookresearch/nougat) — academic PDF → markdown
- [GROBID](https://github.com/kermitt2/grobid) — structured PDF extraction
- [text-dedup](https://github.com/ChenghaoMou/text-dedup) — MinHash corpus dedup
- [uv](https://github.com/astral-sh/uv) — fast Python package manager
- [Hydra](https://hydra.cc/) — config management
- [Weights & Biases](https://wandb.ai/) — experiment tracking
- [Aim](https://github.com/aimhubio/aim) — local experiment tracking
- [mergekit](https://github.com/arcee-ai/mergekit) — model merging (TIES, DARE)
- [just](https://github.com/casey/just) — friendlier `make`
- [RunPod](https://www.runpod.io/), [vast.ai](https://vast.ai/), [Modal](https://modal.com/) — GPU rental
