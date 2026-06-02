# Build the LaTeX documents.
#
# Usage:
#   make            # build both PDFs
#   make proposal   # just the proposal
#   make litreview  # just the literature review
#   make watch      # rebuild on save (requires latexmk -pvc, fswatch, or entr)
#   make clean      # remove build artifacts but keep PDFs
#   make distclean  # remove PDFs as well

LATEXMK = latexmk
LATEXMK_OPTS = -pdf -bibtex -interaction=nonstopmode -halt-on-error -file-line-error

TARGETS = proposal.pdf literature_review.pdf

.PHONY: all proposal litreview watch clean distclean

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
