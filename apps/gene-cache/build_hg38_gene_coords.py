#!/usr/bin/env python3
"""
build_hg38_gene_coords.py

Builds the local gene-annotation cache JSON for the TRIBE Bedgraph Processor
at jeetayu.github.io/apps/tribe.html.

Usage:
  python3 build_hg38_gene_coords.py \
      --gtf  <path/to/gencode.vXX.basic.annotation.gtf> \
      --out  <path/to/hg38_gene_coords.json> \
      --genome hg38 \
      --source "Gencode v42 basic"

Output format (matches queryGeneCache() in tribe.html):
  {
    "version": "hg38_v1",
    "built":   "YYYY-MM-DD",
    "source":  "Gencode v42 basic",
    "chrs": {
      "1": [[start0, end0, "GENE_NAME", "gene_type"], ...],  // sorted by start
      "2": [...],
      ...
    }
  }

  - Chromosome keys have NO "chr" prefix ("1", "X", "Y", "M", …)
  - Coordinates are 0-based half-open  [start, end)
  - Only "gene" feature lines from the GTF are included
  - Entries sorted by start position (ascending) within each chromosome
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date

GNAME_RE = re.compile(r'gene_name "([^"]+)"')
GTYPE_RE = re.compile(r'gene_type "([^"]+)"')


def parse_gtf(gtf_path):
    chrs = defaultdict(list)
    n = 0
    print(f"Parsing {gtf_path} …", file=sys.stderr, flush=True)
    with open(gtf_path) as fh:
        for line in fh:
            if line.startswith('#') or '\tgene\t' not in line:
                continue
            cols = line.split('\t', 9)
            if len(cols) < 9 or cols[2] != 'gene':
                continue
            chrom = cols[0].replace('chr', '', 1)   # strip leading "chr"
            start = int(cols[3]) - 1                 # GTF 1-based → 0-based
            end   = int(cols[4])                     # GTF end inclusive = 0-based exclusive
            attrs = cols[8]
            m_name = GNAME_RE.search(attrs)
            m_type = GTYPE_RE.search(attrs)
            if not (m_name and m_type):
                continue
            chrs[chrom].append([start, end, m_name.group(1), m_type.group(1)])
            n += 1

    print(f"Parsed {n:,} genes on {len(chrs)} chromosomes", file=sys.stderr, flush=True)
    return chrs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gtf',    required=True,  help='Path to Gencode GTF')
    ap.add_argument('--out',    required=True,  help='Output JSON path')
    ap.add_argument('--genome', default='hg38', help='Genome label (hg38/hg19/mm10)')
    ap.add_argument('--source', default='Gencode v42 basic annotation',
                    help='Human-readable source string')
    args = ap.parse_args()

    chrs = parse_gtf(args.gtf)

    # Sort each chromosome by start position (ascending)
    for chrom in chrs:
        chrs[chrom].sort(key=lambda x: x[0])

    payload = {
        'version': f'{args.genome}_v1',
        'built':   date.today().isoformat(),
        'source':  args.source,
        'chrs':    dict(chrs),
    }

    print(f"Writing {args.out} …", file=sys.stderr, flush=True)
    with open(args.out, 'w') as fh:
        json.dump(payload, fh, separators=(',', ':'))

    size_mb = __import__('os').path.getsize(args.out) / 1e6
    print(f"Done — {size_mb:.1f} MB ({sum(len(v) for v in chrs.values()):,} genes)",
          file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
