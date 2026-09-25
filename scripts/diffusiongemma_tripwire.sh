#!/usr/bin/env bash
# DiffusionGemma → Ollama availability tripwire.
#
# Fires (exit 0 + "AVAILABLE" verdict) the moment DiffusionGemma becomes
# pullable/runnable through Ollama. Until then it reports NOT-YET with the
# two upstream signals so you can see how close it is.
#
# Why two signals: "pullable" needs BOTH (a) an Ollama-servable manifest AND
# (b) llama.cpp server-side diffusion decode (PR #24423). A GGUF on HF alone
# is NOT enough — Ollama wraps llama-server, which can't decode the diffusion
# canvas until the PR lands server support (today it's a draft, CLI-only).
#
# Usage: ./diffusiongemma_tripwire.sh
#   exit 0  = AVAILABLE (ping the user)
#   exit 1  = NOT YET (stay quiet / log only)
set -uo pipefail

PR=24423
REPO="ggml-org/llama.cpp"

# --- Signal A: is there a diffusiongemma manifest in the Ollama library? ---
# This is the load-bearing "can I `ollama pull` it" signal. Check the most
# likely official tag names; a 200 on any means Google/community published a
# servable Ollama artifact.
ollama_hit=""
for ref in \
  "library/diffusiongemma/manifests/latest" \
  "library/diffusiongemma/manifests/26b" \
  "library/diffusion-gemma/manifests/latest" \
  "library/gemma4/manifests/diffusion" ; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
    "https://registry.ollama.ai/v2/${ref}" 2>/dev/null)
  if [ "$code" = "200" ]; then ollama_hit="$ref"; break; fi
done

# --- Signal B: PR #24423 merge state (upstream progress, secondary) ---
pr_json=$(curl -s --max-time 20 \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/pulls/${PR}" 2>/dev/null)
pr_state=$(printf '%s' "$pr_json"   | grep -m1 '"state":'  | sed -E 's/.*"state": *"([^"]+)".*/\1/')
pr_merged=$(printf '%s' "$pr_json"  | grep -m1 '"merged":' | sed -E 's/.*"merged": *([a-z]+).*/\1/')
[ -z "$pr_state" ]  && pr_state="unknown"
[ -z "$pr_merged" ] && pr_merged="unknown"

echo "[$(date '+%Y-%m-%d %H:%M')] tripwire check"
echo "  Signal A (Ollama manifest): ${ollama_hit:-none found}"
echo "  Signal B (PR #${PR}): state=${pr_state} merged=${pr_merged}"

if [ -n "$ollama_hit" ]; then
  echo "VERDICT: AVAILABLE — DiffusionGemma is now servable via Ollama (${ollama_hit})."
  echo "  Next: pull it, wrap a -council Modelfile, register in agentRouting as the synthesist A/B."
  exit 0
fi

echo "VERDICT: NOT YET — no Ollama-servable DiffusionGemma manifest."
exit 1
