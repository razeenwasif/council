#!/usr/bin/env python3
"""
null_control.py — Independence-null for the router-probe NMI (addresses the finite-sample
caveat baked into router_probe.py's output).

Observed NMI(topic;expert) is positively biased when the [topic x expert] count matrices are
sparse: even truly topic-agnostic routing yields NMI > 0 from sampling noise. This script
quantifies that bias by resampling each layer's matrix under the INDEPENDENCE model (same
topic + expert marginals, same total count, no association) and recomputing NMI. The observed
mean-NMI is meaningful only insofar as it exceeds this null.

Usage:  python null_control.py runs/olmoe.json [--boot 2000 --seed 0]
"""
from __future__ import annotations
import argparse, json
import numpy as np


def nmi(mat: np.ndarray) -> float:
    total = mat.sum()
    if total == 0:
        return 0.0
    P = mat / total
    Pt = P.sum(axis=1, keepdims=True)
    Pe = P.sum(axis=0, keepdims=True)
    outer = Pt @ Pe
    m = P > 0
    mi = float(np.sum(P[m] * np.log2(P[m] / outer[m])))
    Ht = float(-np.sum(Pt[Pt > 0] * np.log2(Pt[Pt > 0])))
    He = float(-np.sum(Pe[Pe > 0] * np.log2(Pe[Pe > 0])))
    d = min(Ht, He)
    return mi / d if d > 0 else 0.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("json")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    d = json.load(open(a.json))
    mats = [np.array(m, dtype=np.float64) for m in d["matrices"]]
    layers = d["moe_layer_ids"]
    rng = np.random.default_rng(a.seed)

    obs_layer = np.array([nmi(m) for m in mats])
    obs_mean = float(obs_layer.mean())

    # Per-layer independence null: multinomial(total, outer(Pt,Pe)) → NMI.
    null_means = np.empty(a.boot)
    null_layer = np.zeros((a.boot, len(mats)))
    for li, m in enumerate(mats):
        total = int(m.sum())
        P = m / total
        p_ind = (P.sum(axis=1, keepdims=True) @ P.sum(axis=0, keepdims=True)).ravel()
        p_ind /= p_ind.sum()
        draws = rng.multinomial(total, p_ind, size=a.boot).reshape(a.boot, *m.shape)
        null_layer[:, li] = [nmi(draws[b]) for b in range(a.boot)]
    null_means = null_layer.mean(axis=1)

    nm, ns = float(null_means.mean()), float(null_means.std())
    z = (obs_mean - nm) / ns if ns > 0 else float("inf")
    p = float((null_means >= obs_mean).mean())   # one-sided: P(null >= observed)

    print(f"observed mean NMI      : {obs_mean:.4f}")
    print(f"independence-null mean : {nm:.4f}  (std {ns:.4f})  [this is the finite-sample floor]")
    print(f"excess over null       : {obs_mean - nm:+.4f}")
    print(f"z-score                : {z:.2f}")
    print(f"p (null >= observed)   : {p:.4f}  over {a.boot} bootstraps")
    print()
    print("per-layer  observed   null_mean   excess")
    nl_mean = null_layer.mean(axis=0)
    for i, lyr in enumerate(layers):
        print(f"  L{lyr:<3}     {obs_layer[i]:.3f}      {nl_mean[i]:.3f}      {obs_layer[i]-nl_mean[i]:+.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
