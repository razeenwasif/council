# Paper strategy — how to structure (and sequence) the publications

**Status:** decision recorded 2026-06-16. Companion to [`FEASIBILITY.md`](./FEASIBILITY.md) §9
(novelty slices) and [`LITERATURE.md`](./LITERATURE.md) §8 (verified open gaps).

> **TL;DR — not two parallel papers.** Keep the quantization **thesis as the spine**; **fold the
> quantization-interaction slice in as a thesis chapter**; treat the **pure architecture-grafting
> work as one *separate, later, gated* paper**. The two contributions are **dependent and
> sequential** — the split happens in time, not in parallel.

---

## 1. Why the halves are sequential, not parallel

The work decomposes into two genuinely separable contributions:

- **(A) Architecture** — *graft* a topic-addressable sparse FFN (MoEfication-partition /
  cluster-init experts / PKM memory layer) into a pretrained dense LLM and recover via
  **knowledge distillation**; engineer domain-addressability rather than hope a learned router
  delivers it.
- **(B) Quantization interaction** — do grafted sparse specialists **quantize** as cleanly as
  dense? Does post-quantization **router drift** (cf. EAQuant) become the binding constraint on
  topic-addressability at decoder-only ~4B?

**B cannot exist until A produces a working graft.** So "do them separately" can only mean *in
sequence* (A → B), never *in parallel*. This single fact drives the whole structure below.

## 2. The structure

| layer | content | home | cost / risk |
|---|---|---|---|
| **Thesis spine (unchanged)** | information-preserving quantization of domain-specialist fine-tunes for verification in multi-agent scientific reasoning | the thesis | — (already the plan) |
| **Fold IN → thesis chapter** | **(B)** quantization robustness of sparse / grafted specialists; router-drift under 4-bit; topic-addressability after quantization | a thesis chapter / workshop paper | **low** — reuses the quant eval harness + the specialists; *reinforces* the thesis narrative |
| **Separate paper (later, GATED)** | **(A)** grafting topic-addressable sparse FFN into a pretrained LLM via KD + engineered addressability | standalone architecture/efficiency paper | **high** — the big, compute-heavy, higher-risk build; orthogonal to the thesis |

**Rationale:** (B) shares infrastructure with the thesis and strengthens it, so it belongs
*inside* the thesis. (A) is a different efficiency axis (conditional computation, not
quantization) and a much larger build — it must not compete with the thesis for time or the
single 4090. Gate it; don't run it in parallel.

## 3. The two papers, scoped

### Paper A — *Grafting topic-addressable sparse FFN into a pretrained LLM via distillation*
- **Contribution:** the **graft + KD-recovery recipe** for a decoder-only LLM, and **engineered
  domain-addressability** (partition/cluster-init experts) that beats the uniform-routing
  collapse of naive upcycling. Optionally the **PKM/memory-layer graft** (literal lookup —
  highest novelty, `LITERATURE.md` §8.1).
- **Why novel (verified gaps):** prior grafting work recovers via *continued pretraining, not
  KD* (`LITERATURE.md` §2); PKM/FFF graft-recovery is *unverified anywhere* (§8.1); cloned-FFN
  upcycling demonstrably *fails* to specialize by topic (§3) — so "engineer it" is a real,
  unclaimed contribution.
- **Venue:** ICLR / NeurIPS / ICML efficiency or architecture tracks.
- **Position against prior art (must cite, do NOT re-claim):** Sparse Upcycling, MoEfication,
  LLaMA-MoE, OLMoE, Drop-Upcycling, Branch-Train-Mix.

### Paper B — *Quantization robustness of grafted / sparse domain specialists* (thesis chapter first)
- **Contribution:** does the MoE-quantizes-better-than-dense result (MoQE/QMoE) hold for a
  **grafted decoder-only ~4B** specialist (the evidence base is encoder-decoder MT)? Does
  **routing-consistency degradation cap topic-addressability after quantization**? — the clause
  that fuses addressability with the quantization thesis (nobody has measured it).
- **Why novel:** the quantization × graft × addressability intersection is open
  (`LITERATURE.md` §8.4).
- **Venue:** thesis chapter → MLSys / EMNLP-ACL efficient-methods, or a NeurIPS/ICML efficiency
  workshop (ENLSP / ES-FoMo) as a first outing.
- **Cheap precursor available now:** carry the Experiment-1 router-probe NMI *through* 4-bit
  quantization on an existing MoE (OLMoE) — measure whether the +0.042 topic signal survives.
  That's Paper B's core measurement in miniature, runnable on the 4090 with no graft yet.

## 4. Decision gates (tie the papers to the de-risk ladder)

Each gate is cheap and kills the expensive path early. From `FEASIBILITY.md` §8:

| gate | experiment | cost | go-criterion | status |
|---|---|---|---|---|
| **G1** | router-probe topic specialization (OLMoE) | ~1 GPU-hr | topic signal real | ✅ **passed** (NMI +0.042 over null, z≈119) but *weak* + upper-bound |
| **G2** | MoEfication-**partition** on Gemma-4 E4B | ~1 GPU-day | FFN partitions into usable experts; partition specializes > cloned upcycle | ⬜ next |
| **G3** | single-layer graft + layerwise KD | ~1–2 GPU-days | one layer recovers near-teacher under frozen-backbone KD | ⬜ |
| **G4** | full graft + KD recovery | ~weeks | whole-model recovers; addressability engineered | ⬜ → **unlocks Paper A** |
| **G5** | quantize the grafted specialist | ~1 GPU-day | expert-robustness holds at 4B; measure router drift | ⬜ → **Paper B / thesis chapter** |

**Read G1 honestly:** the ceiling is low, so Paper A's addressability claim *must* come from
**engineering** (G2's partition/cluster-init beating uniform routing), not from a learned
router. If G2 shows partitioned experts don't specialize meaningfully either, Paper A is dead
for ~1 GPU-day spent — and you still keep the Paper-B precursor (§3) as a thesis chapter.

## 5. When two-papers IS right — and the traps

**Split into two papers only when** each half is independently substantial *and* compute/time
allow — and then publish **A first, B second** (B depends on A), targeting **different venues**
(architecture vs efficient-quantization). The split is by *contribution type*, not arbitrary.

**Traps to avoid:**
1. **One mega-paper** (architecture + quantization at once) → unfocused; reviewers ding "two
   contributions, neither fully developed."
2. **Two parallel paper-scale efforts on one 4090** → the thesis slips. A is the heavy one;
   never run it alongside the thesis.

## 6. Recommended sequence

1. **Now:** ship the thesis's quantization work (priority/spine). In parallel-cost-free moments,
   run the **Paper-B precursor** (§3) — quantize OLMoE, re-probe, see if the topic signal
   survives. → a thesis-chapter result with no graft required.
2. **Gate G2** (MoEfication-partition on E4B) — the cheap go/no-go on whether Paper A is alive.
3. **If G2–G4 stay green:** write **Paper A** (architecture). Then **Paper B** (quant-of-graft),
   which by then is mostly the precursor + the real graft plugged in.
4. **If any gate fails:** Paper A dies cheaply; the quant-interaction work survives as a thesis
   chapter regardless. Thesis untouched either way.
