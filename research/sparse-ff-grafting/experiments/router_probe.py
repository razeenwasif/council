#!/usr/bin/env python3
"""
router_probe.py — Topic→Expert routing probe for open-weights Mixture-of-Experts LLMs.

EXPERIMENT 1 of the sparse-FF-grafting research thread (see ../FEASIBILITY.md §"De-risk
ladder", step 1). Zero-/low-training test of the premise behind "topic/domain-addressable
parameters": in a *trained* MoE, does the router awaken TOPIC-specialised experts, or does
it route on surface/positional features?

  - If experts specialise by topic in an existing MoE  -> zero-training evidence that the
    "lookup-table-of-parameters" idea is real and worth grafting for.
  - If routing is topic-agnostic  -> the premise needs rethinking: a *learned per-token*
    router is NOT a topic index, and explicit domain-routing (Branch-Train-Mix-style
    expert banks) would be the design to pursue instead.

WHAT IT DOES
  1. Runs a topic-stratified prompt battery through an MoE model (one prompt at a time,
     batch=1, no padding).
  2. Captures per-layer router logits via `output_router_logits=True` (gate-hook fallback
     for archs that don't surface the flag); takes top-k expert selections per token.
  3. Builds a [topic x expert] routing-count matrix per MoE layer.
  4. Scores topic specialisation per layer with:
       - NMI(topic; expert)  — normalised mutual information in [0,1]; 0 = routing is
         independent of topic, 1 = expert identity fully determines topic.
       - purity              — mean dominant-topic share across experts; 1 = every expert
         is only ever chosen for a single topic.
  5. Dumps <out>.json (matrices + metrics + metadata), <out>.csv (layer,expert,topic,count),
     and prints/saves a human-readable summary.

────────────────────────────────────────────────────────────────────────────────────────
WHY NOT gemma4:26b-council TODAY (read before you run):
  (1) Ollama is a BLACK BOX — it returns tokens, not router selections. You cannot probe
      expert routing through Ollama. You need the model in HuggingFace transformers with
      the MoE layers exposed.
  (2) transformers 4.51.3 (the pinned thesis stack) does NOT recognise `gemma4` — the same
      pin that blocked the Gemma-4 fine-tune blocks loading Gemma-4 26B for probing too.
  (3) The 4090 is busy with the Mistral v2 run; loading a second model risks OOM.

  => Validate the premise + this harness NOW against a PROXY MoE that transformers 4.51.3
     supports and that is small enough to run on CPU or coexist on the GPU. Recommended:
       allenai/OLMoE-1B-7B-0924  (16 MoE layers, 64 experts, top-8; built for routing
       analysis; ~7B params total, ~1B active).
     Re-point --model at Gemma 4 26B once `gemma4` lands in transformers and the GPU is
     free — the harness is model-agnostic.

USAGE
  # proxy MoE, 4-bit, AFTER the training run frees the GPU:
  ~/Research/council-specialists/.venv/bin/python router_probe.py \
      --model allenai/OLMoE-1B-7B-0924 --load-in-4bit --out runs/olmoe

  # CPU while the GPU is busy (slow but safe; ~16 GB RAM in bf16):
  ~/Research/council-specialists/.venv/bin/python router_probe.py \
      --model allenai/OLMoE-1B-7B-0924 --device cpu --dtype bfloat16 --max-prompts 4

  # quick smoke (fewer prompts):
  ... --max-prompts 2
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

# ── Topic-stratified prompt battery ──────────────────────────────────────────────────
# Distinct domains, comparable surface style (a question/instruction each) so that any
# topic→expert signal reflects CONTENT, not prompt format. Trim per-topic with --max-prompts.
PROMPTS: dict[str, list[str]] = {
    "physics": [
        "Derive the time dilation factor for an object moving at velocity v relative to an observer.",
        "Explain why entropy increases in an isolated thermodynamic system.",
        "What is the Schwarzschild radius of a black hole and how is it derived?",
        "Describe how a semiconductor p-n junction produces a depletion region.",
        "State Maxwell's equations and explain what each one physically means.",
        "Why does a spinning gyroscope precess rather than fall over?",
    ],
    "computer_science": [
        "Explain how a hash map achieves average O(1) lookup and when it degrades to O(n).",
        "Describe the difference between processes and threads and how context switching works.",
        "What is the CAP theorem and what trade-off does it force on distributed databases?",
        "Walk through how the TCP three-way handshake establishes a connection.",
        "Explain how a garbage collector identifies unreachable objects.",
        "Compare B-trees and LSM-trees for on-disk database indexing.",
    ],
    "biology": [
        "Explain how the sodium-potassium pump maintains a cell's resting membrane potential.",
        "Describe the steps of DNA replication and the role of DNA polymerase.",
        "How does natural selection lead to antibiotic resistance in bacteria?",
        "Explain the light-dependent reactions of photosynthesis.",
        "What is the role of the mitochondrial electron transport chain in ATP synthesis?",
        "Describe how mRNA is translated into protein at the ribosome.",
    ],
    "law": [
        "Explain the difference between common law and civil law legal systems.",
        "What must a plaintiff prove to establish negligence in tort law?",
        "Describe the concept of mens rea and its role in criminal liability.",
        "What is the doctrine of stare decisis and why does it matter?",
        "Explain the difference between a contract void ab initio and a voidable contract.",
        "What constitutes consideration in the formation of a valid contract?",
    ],
    "history": [
        "Explain the principal causes of the First World War.",
        "Describe the economic forces that drove the Industrial Revolution in Britain.",
        "What were the main provisions and consequences of the Treaty of Westphalia?",
        "Explain how the printing press changed the spread of ideas in early modern Europe.",
        "Describe the political structure of the Roman Republic before Caesar.",
        "What factors led to the collapse of the Bronze Age civilizations?",
    ],
    "medicine": [
        "Explain the pathophysiology of type 2 diabetes mellitus.",
        "Describe how a vaccine induces adaptive immunity.",
        "What is the mechanism of action of beta-blockers in treating hypertension?",
        "Explain the stages of wound healing.",
        "How does the kidney regulate blood pH through bicarbonate handling?",
        "Describe how an ECG reflects the electrical activity of the heart.",
    ],
    "finance": [
        "Explain how the Black-Scholes model prices a European call option.",
        "What is the difference between systematic and idiosyncratic risk in a portfolio?",
        "Describe how a central bank uses open market operations to set interest rates.",
        "Explain how compound interest differs from simple interest over time.",
        "What does the yield curve tell us and why does inversion matter?",
        "Explain the concept of arbitrage and why it enforces the law of one price.",
    ],
    "mathematics": [
        "Prove that the square root of 2 is irrational.",
        "Explain the fundamental theorem of calculus and what it connects.",
        "What is an eigenvalue and what does it tell you about a linear transformation?",
        "Describe the epsilon-delta definition of a limit.",
        "Explain why the harmonic series diverges.",
        "State and explain the intuition behind the central limit theorem.",
    ],
}


def routing_matrix_metrics(mat: np.ndarray) -> dict:
    """Topic-specialisation metrics for one [n_topics x n_experts] count matrix."""
    total = mat.sum()
    if total == 0:
        return {"nmi": 0.0, "purity": 0.0, "mi_bits": 0.0,
                "H_topic": 0.0, "H_expert": 0.0, "tokens": 0}
    P = mat / total                       # joint P(topic, expert)
    Pt = P.sum(axis=1, keepdims=True)     # [T,1] marginal over topics
    Pe = P.sum(axis=0, keepdims=True)     # [1,E] marginal over experts
    outer = Pt @ Pe                       # [T,E] independence baseline
    m = P > 0
    mi = float(np.sum(P[m] * np.log2(P[m] / outer[m])))        # bits
    Ht = float(-np.sum(Pt[Pt > 0] * np.log2(Pt[Pt > 0])))
    He = float(-np.sum(Pe[Pe > 0] * np.log2(Pe[Pe > 0])))
    denom = min(Ht, He)
    nmi = mi / denom if denom > 0 else 0.0
    col = mat.sum(axis=0)                  # [E] selections per expert
    dom = mat.max(axis=0)                  # [E] dominant-topic count per expert
    used = col > 0
    purity = float(dom[used].sum() / col[used].sum()) if used.any() else 0.0
    return {"nmi": float(nmi), "purity": purity, "mi_bits": mi,
            "H_topic": Ht, "H_expert": He, "tokens": int(total)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True,
                    help="HF model id of an MoE LM (e.g. allenai/OLMoE-1B-7B-0924).")
    ap.add_argument("--out", default="runs/probe", help="Output path prefix (no extension).")
    ap.add_argument("--device", default="auto", help="'auto' | 'cuda' | 'cpu'.")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("--load-in-4bit", action="store_true",
                    help="4-bit NF4 load (GPU only; ~halves VRAM). Ignored on CPU.")
    ap.add_argument("--top-k", type=int, default=0,
                    help="Experts per token. 0 = read num_experts_per_tok from config.")
    ap.add_argument("--max-prompts", type=int, default=0,
                    help="Cap prompts per topic (0 = all). Lower it for CPU smoke runs.")
    args = ap.parse_args()

    # Keep torch.compile/inductor out of the way for a pure forward probe.
    os.environ.setdefault("TORCHINDUCTOR_DISABLE", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    dtype = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}[args.dtype]
    device = ("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device

    print(f"[load] {args.model}  device={device}  dtype={args.dtype}  4bit={args.load_in_4bit}")
    tok = AutoTokenizer.from_pretrained(args.model)
    load_kwargs: dict = {"torch_dtype": dtype}
    if args.load_in_4bit and device != "cpu":
        from transformers import BitsAndBytesConfig
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=dtype, bnb_4bit_use_double_quant=True)
        load_kwargs["device_map"] = {"": 0}
    model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)
    if not (args.load_in_4bit and device != "cpu"):
        model = model.to(device)
    model.eval()

    cfg = model.config
    n_experts = (getattr(cfg, "num_experts", None) or getattr(cfg, "num_local_experts", None)
                 or getattr(cfg, "n_routed_experts", None))
    top_k = args.top_k or getattr(cfg, "num_experts_per_tok", None) or getattr(cfg, "moe_topk", 1)
    if n_experts is None:
        raise SystemExit(
            "Could not infer num_experts from config — is this actually an MoE? "
            "Inspect: " + ", ".join(k for k in vars(cfg) if "expert" in k.lower()))
    print(f"[config] experts={n_experts}  top_k={top_k}  hidden_layers={getattr(cfg,'num_hidden_layers','?')}")

    topics = list(PROMPTS.keys())
    t_index = {t: i for i, t in enumerate(topics)}
    counts: list[np.ndarray] | None = None   # one [T, n_experts] matrix per MoE layer
    moe_layer_ids: list[int] = []            # decoder-layer index of each captured MoE layer
    total_tokens = 0

    @torch.no_grad()
    def forward_router_logits(text: str):
        enc = tok(text, return_tensors="pt").to(model.device)
        out = model(**enc, output_router_logits=True, use_cache=False)
        rl = getattr(out, "router_logits", None)
        if rl is None:
            raise RuntimeError(
                "Model did not return router_logits. This arch may not support the flag; "
                "add a gate-hook fallback for it (see FEASIBILITY.md notes).")
        return enc["input_ids"].shape[1], rl

    for topic in topics:
        prompts = PROMPTS[topic][: args.max_prompts] if args.max_prompts else PROMPTS[topic]
        for p in prompts:
            seq_len, router_logits = forward_router_logits(p)
            total_tokens += seq_len
            # Initialise containers on first forward: keep only entries shaped (*, n_experts).
            if counts is None:
                moe_layer_ids = [i for i, lg in enumerate(router_logits)
                                 if lg is not None and lg.shape[-1] == n_experts]
                counts = [np.zeros((len(topics), n_experts), dtype=np.int64) for _ in moe_layer_ids]
                print(f"[probe] MoE layers captured: {len(moe_layer_ids)} of {len(router_logits)}")
            for slot, layer_id in enumerate(moe_layer_ids):
                lg = router_logits[layer_id]                  # [tokens, n_experts]
                sel = torch.topk(lg, k=top_k, dim=-1).indices  # [tokens, top_k]
                ids, freq = np.unique(sel.detach().cpu().numpy().ravel(), return_counts=True)
                counts[slot][t_index[topic], ids] += freq
        print(f"[probe] {topic:<16} done ({len(prompts)} prompts)")

    # ── Metrics ──────────────────────────────────────────────────────────────────────
    per_layer = [routing_matrix_metrics(c) for c in counts]
    mean_nmi = float(np.mean([m["nmi"] for m in per_layer]))
    mean_purity = float(np.mean([m["purity"] for m in per_layer]))
    # Most topic-specialised (layer, expert, topic) cells, ranked by count share within expert.
    spec = []
    for slot, c in enumerate(counts):
        col = c.sum(axis=0)
        for e in range(c.shape[1]):
            if col[e] == 0:
                continue
            t = int(c[:, e].argmax())
            share = float(c[t, e] / col[e])
            spec.append((share, moe_layer_ids[slot], e, topics[t], int(col[e])))
    spec.sort(reverse=True)

    out_prefix = Path(args.out)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": args.model, "n_experts": int(n_experts), "top_k": int(top_k),
        "topics": topics, "moe_layer_ids": moe_layer_ids, "total_tokens": total_tokens,
        "mean_nmi": mean_nmi, "mean_purity": mean_purity,
        "per_layer": [{"layer": moe_layer_ids[i], **per_layer[i]} for i in range(len(per_layer))],
        "matrices": [c.tolist() for c in counts],
    }
    with open(out_prefix.with_suffix(".json"), "w") as f:
        json.dump(payload, f, indent=2)
    with open(out_prefix.with_suffix(".csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["layer", "expert", "topic", "count"])
        for slot, c in enumerate(counts):
            for ti, t in enumerate(topics):
                for e in range(c.shape[1]):
                    if c[ti, e]:
                        w.writerow([moe_layer_ids[slot], e, t, int(c[ti, e])])

    # ── Human-readable summary ───────────────────────────────────────────────────────
    lines = []
    lines.append(f"Router probe — {args.model}")
    lines.append(f"  experts={n_experts}  top_k={top_k}  topics={len(topics)}  tokens={total_tokens}")
    lines.append("")
    lines.append(f"  MEAN NMI(topic;expert) = {mean_nmi:.3f}   MEAN purity = {mean_purity:.3f}")
    lines.append("")
    lines.append("  Interpretation guide (rough, model-dependent — compare against a shuffled-label")
    lines.append("  control for a real null; these bands are a starting heuristic):")
    lines.append("    NMI < 0.05  -> routing essentially topic-agnostic (premise weak)")
    lines.append("    0.05–0.20   -> mild topic signal")
    lines.append("    > 0.20      -> strong topic specialisation (premise supported)")
    lines.append("")
    lines.append("  Per-layer:")
    lines.append("    layer    nmi   purity   tokens")
    for i, m in enumerate(per_layer):
        lines.append(f"    {moe_layer_ids[i]:>5}  {m['nmi']:.3f}   {m['purity']:.3f}   {m['tokens']}")
    lines.append("")
    lines.append("  Top topic-specialised experts (share | layer | expert | topic | n):")
    for share, layer_id, e, t, n in spec[:15]:
        lines.append(f"    {share:.2f}  L{layer_id:<3} E{e:<4} {t:<16} n={n}")
    summary = "\n".join(lines)
    print("\n" + summary)
    with open(out_prefix.with_suffix(".txt"), "w") as f:
        f.write(summary + "\n")
    print(f"\n[done] wrote {out_prefix}.json / .csv / .txt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
