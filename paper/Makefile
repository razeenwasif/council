# Build the LaTeX documents.
#
# Usage:
#   make                  # build both PDFs
#   make proposal         # just the proposal
#   make litreview        # just the literature review
#   make watch            # rebuild on save (requires latexmk -pvc, fswatch, or entr)
#   make clean            # remove build artifacts but keep PDFs
#   make distclean        # remove PDFs as well
#   make sync-overleaf    # push paper/ sources from main to the paper-only branch
#                         #   (commit message: make sync-overleaf SYNC_MSG="...")

LATEXMK = latexmk
LATEXMK_OPTS = -pdf -bibtex -interaction=nonstopmode -halt-on-error -file-line-error

TARGETS = proposal.pdf literature_review.pdf

# Overleaf sync configuration
SYNC_BRANCH   = paper-only
SYNC_WORKTREE = /tmp/paper-overleaf-sync
SYNC_FILES    = proposal.tex literature_review.tex preamble.tex references.bib Makefile .gitignore
SYNC_MSG     ?= sync paper sources from main

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

# Push the current paper/ sources on main to the paper-only branch
# (which is what Overleaf tracks). README.md on paper-only is preserved.
# Safety: refuses to run unless on main with no uncommitted changes to
# the synced files.
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
	@if [ -e $(SYNC_WORKTREE) ]; then \
		echo "cleaning stale worktree at $(SYNC_WORKTREE)"; \
		git worktree remove --force $(SYNC_WORKTREE) 2>/dev/null || rm -rf $(SYNC_WORKTREE); \
	fi
	@echo "==> creating worktree on $(SYNC_BRANCH)"
	git worktree add $(SYNC_WORKTREE) $(SYNC_BRANCH)
	@echo "==> copying $(words $(SYNC_FILES)) files"
	cp $(SYNC_FILES) $(SYNC_WORKTREE)/
	@cd $(SYNC_WORKTREE) && \
		if git diff --quiet && git diff --cached --quiet; then \
			echo "==> no changes to sync — paper-only is already up to date"; \
		else \
			git add -A && \
			git commit -m "$(SYNC_MSG)" && \
			echo "==> pushing $(SYNC_BRANCH)" && \
			git push origin $(SYNC_BRANCH); \
		fi
	git worktree remove --force $(SYNC_WORKTREE)
	@echo "==> sync complete"
