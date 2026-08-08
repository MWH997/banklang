# X-COBOL v2 — horizontal coverage

**Upstream** https://zenodo.org/records/14269462

**Citation** X-COBOL: A Dataset of Open-Source COBOL repositories, Zenodo, DOI 10.5281/zenodo.14269462, published 2024-12-05

**Licence** CC-BY-4.0, redistribution: derived-only

**What this establishes.** What constructs real COBOL actually contains, whether this toolchain's reader survives them, and which of them BankTS can and cannot represent — ranked by how often they really occur.

**What it does not.** No behavioural oracle. These are files, not tests: nothing here can establish that anything computes the right answer, and a representability figure is a statement about language scope rather than about correctness.

## Reading the corpus

| | |
| --- | --- |
| COBOL files discovered | 5195 |
| analysed without error | 5195 / 5195 (100.0%) |
| analyser failures | 0 |

## Representability under BankTS

Every percentage is of the files discovered, and a file is counted once.
This is a statement about what BankTS can express, not about whether any
program is correct: nothing in this corpus carries an expected output.

| Verdict | Files |
| --- | --- |
| fully-representable | 1543 / 5195 (29.7%) |
| representable-with-adaptation | 2730 / 5195 (52.6%) |
| unsupported-by-design | 533 / 5195 (10.3%) |
| unsupported-not-yet-implemented | 331 / 5195 (6.4%) |
| analyser-failure | 0 / 5195 (0.0%) |
| unknown | 58 / 5195 (1.1%) |

## Constructs BankTS cannot express, by how often they occur

| Construct | Support | Files | Share of corpus |
| --- | --- | --- | --- |
| `go-to` | adaptation | 2473 | 47.6% |
| `perform-thru` | adaptation | 2394 | 46.1% |
| `reference-modification` | adaptation | 600 | 11.5% |
| `usage-index` | adaptation | 452 | 8.7% |
| `string-unstring` | adaptation | 393 | 7.6% |
| `inspect` | adaptation | 269 | 5.2% |
| `usage-pointer` | unsupported-by-design | 244 | 4.7% |
| `file-relative` | unsupported-not-yet-implemented | 192 | 3.7% |
| `screen-section` | unsupported-by-design | 138 | 2.7% |
| `external-data` | unsupported-not-yet-implemented | 110 | 2.1% |
| `copy-replacing` | unsupported-not-yet-implemented | 87 | 1.7% |
| `entry-point` | unsupported-by-design | 79 | 1.5% |
| `alter` | unsupported-by-design | 70 | 1.3% |
| `comp-float` | unsupported-by-design | 37 | 0.7% |
| `go-to-depending` | unsupported-by-design | 28 | 0.5% |

## Every construct found, by frequency

| Construct | Files | Lines | BankTS |
| --- | --- | --- | --- |
| `move` | 4336 | 672850 | supported |
| `continuation` | 3916 | 90304 | supported |
| `conditional` | 3815 | 205109 | supported |
| `arithmetic-verbs` | 3189 | 71064 | supported |
| `file-verbs` | 3078 | 40517 | supported |
| `redefines` | 2510 | 74678 | supported |
| `go-to` | 2473 | 139353 | adaptation |
| `copy` | 2456 | 5401 | supported |
| `perform-thru` | 2394 | 18456 | adaptation |
| `accept-display` | 2130 | 134801 | supported |
| `occurs` | 2091 | 21281 | supported |
| `national` | 2086 | 4548 | supported |
| `comp-binary` | 1480 | 15088 | supported |
| `compute` | 988 | 15302 | supported |
| `linkage-section` | 975 | 2010 | supported |
| `intrinsic-function` | 970 | 10104 | supported |
| `evaluate` | 867 | 5197 | supported |
| `perform-varying` | 857 | 12064 | supported |
| `condition-names` | 857 | 518839 | supported |
| `nested-program` | 843 | 1341 | supported |
| `call-static` | 759 | 5175 | supported |
| `file-status` | 749 | 1828 | supported |
| `reference-modification` | 600 | 68639 | adaptation |
| `usage-index` | 452 | 11280 | adaptation |
| `file-indexed` | 447 | 845 | supported |
| `declaratives` | 443 | 1088 | supported |
| `initialize` | 439 | 5366 | supported |
| `file-sequential` | 402 | 697 | supported |
| `string-unstring` | 393 | 2513 | adaptation |
| `file-line-sequential` | 309 | 598 | supported |
| `exec-cics` | 277 | 2946 | supported |
| `inspect` | 269 | 1757 | adaptation |
| `call-dynamic` | 267 | 1581 | supported |
| `usage-pointer` | 244 | 1894 | unsupported-by-design |
| `comp-3` | 239 | 185547 | supported |
| `rounded` | 227 | 2677 | supported |
| `file-relative` | 192 | 305 | unsupported-not-yet-implemented |
| `on-size-error` | 189 | 7593 | supported |
| `search` | 169 | 1579 | supported |
| `start-browse` | 158 | 1397 | supported |
| `screen-section` | 138 | 138 | unsupported-by-design |
| `exec-sql` | 113 | 1305 | supported |
| `occurs-depending-on` | 111 | 182 | supported |
| `external-data` | 110 | 435 | unsupported-not-yet-implemented |
| `sign-separate` | 109 | 697 | supported |
| `copy-replacing` | 87 | 313 | unsupported-not-yet-implemented |
| `sort-merge` | 83 | 123 | supported |
| `entry-point` | 79 | 151 | unsupported-by-design |
| `alter` | 70 | 582 | unsupported-by-design |
| `local-storage` | 68 | 107 | supported |
| `report-writer` | 49 | 107 | supported |
| `renames` | 45 | 219 | supported |
| `comp-float` | 37 | 166 | unsupported-by-design |
| `linage` | 30 | 76 | supported |
| `go-to-depending` | 28 | 50 | unsupported-by-design |
| `cbltdli` | 27 | 143 | supported |

