Cell culture media finder data (built 2026-11-23)
- index.json / shards/: per-cell-line media recommendations, reduced to structured fields (base medium, serum, supplements, conditions,
  seeding, split ratio, freezing) with a link to each vendor page: ATCC, DSMZ, JCRB, ECACC, Coriell, and cited literature.
- Cell line identity, synonyms, species, tissue, disease and misidentification/contamination flags: Cellosaurus (https://www.cellosaurus.org),
  CC BY 4.0, Bairoch A. J Biomol Tech 2018.
- lab.json: this lab's own protocols; entries without a recorded medium show the vendor recommendation and are marked not lab-verified.
- Always confirm against the current vendor datasheet for your lot. Hybridoma (ATCC HB-) products and lines with no public medium are not included.
