# Build the LaTeX documents.
#
# Usage:
#   make                  # build both PDFs
#   make proposal         # just the proposal
#   make litreview        # just the literature review
#   make watch            # rebuild on save (requires latexmk -pvc, fswatch, or entr)
#   make clean            # remove build artifacts but keep PDFs
#   make distclean        # remove PDFs as well
#   make sync-overleaf    # push paper/ sources to the standalone paper repo
#                         # (razeenwasif/quant-specialist-paper) that Overleaf tracks.
#                         #   custom commit message: make sync-overleaf SYNC_MSG="..."
#                         #   custom target path:    make sync-overleaf SYNC_REPO_PATH=/path

LATEXMK = latexmk
LATEXMK_OPTS = -pdf -bibtex -interaction=nonstopmode -halt-on-error -file-line-error

TARGETS = proposal.pdf literature_review.pdf

# Overleaf sync configuration
#
# The paper is hosted in a separate small GitHub repo
# (razeenwasif/quant-specialist-paper) so Overleaf can import it without
# hitting the 2,000-file limit that the full Council codebase trips. The
# sync target pushes the canonical paper/ sources from this repo (main)
# into the standalone paper repo's main branch, which Overleaf tracks.
SYNC_REPO_PATH ?= $(HOME)/Research/quant-specialist-paper
SYNC_FILES      = proposal.tex literature_review.tex preamble.tex references.bib Makefile .gitignore
SYNC_MSG       ?= sync paper sources from Council:main

.PHONY: all proposal litreview watch clean distclean sync-overleaf

all: $(TARGETS)

proposal: proposal.pdf
litreview: literature_review.pdf

proposal.pdf: proposal.tex preamble.tex references.bib
	$(LATEXMK) $(LATEXMK_OPTS) proposal.tex

literature_review.pdf: literature_review.tex preamble.tex references.bib
	$(LATEXMK) $(LATEXMK_OPTS) literature_review.tex

watch:
	$(LATEXMK) -pdf -pvc -interaction=nonstopmode proposal.tex

clean:
	$(LATEXMK) -c
	rm -f *.bbl *.run.xml *.bcf *.synctex.gz

distclean: clean
	$(LATEXMK) -C
	rm -f *.pdf

# Push the current paper/ sources to the standalone paper repo at
# $(SYNC_REPO_PATH), which is the one Overleaf tracks.
# Safety: refuses to run unless on main with no uncommitted changes to
# the synced files, and the target repo exists.
sync-overleaf:
	@branch="$$(git rev-parse --abbrev-ref HEAD)"; \
	if [ "$$branch" != "main" ]; then \
		echo "error: must be on 'main' to sync (currently on '$$branch')"; \
		exit 1; \
	fi
	@if ! git diff --quiet HEAD -- $(SYNC_FILES); then \
		echo "error: uncommitted changes to paper/ files on main — commit first"; \
		git status --short -- $(SYNC_FILES); \
		exit 1; \
	fi
	@if [ ! -d "$(SYNC_REPO_PATH)/.git" ]; then \
		echo "error: paper repo not found at $(SYNC_REPO_PATH)"; \
		echo "        clone it first:"; \
		echo "          git clone git@github.com:razeenwasif/quant-specialist-paper.git $(SYNC_REPO_PATH)"; \
		echo "        or override the path:"; \
		echo "          make sync-overleaf SYNC_REPO_PATH=/path/to/clone"; \
		exit 1; \
	fi
	@echo "==> pulling latest from $(SYNC_REPO_PATH)"
	@cd $(SYNC_REPO_PATH) && git pull --ff-only origin main
	@echo "==> copying $(words $(SYNC_FILES)) files"
	cp $(SYNC_FILES) $(SYNC_REPO_PATH)/
	@cd $(SYNC_REPO_PATH) && \
		if git diff --quiet && git diff --cached --quiet; then \
			echo "==> no changes to sync — paper repo is already up to date"; \
		else \
			git add -A && \
			git commit -m "$(SYNC_MSG)" && \
			echo "==> pushing to origin/main" && \
			git push origin main; \
		fi
	@echo "==> sync complete"
