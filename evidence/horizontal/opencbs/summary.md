# OpenCBS COBOL defects suite — horizontal coverage

**Upstream** https://github.com/PhaseChangeSoftware/cobol-defects-suite

**Citation** D. Lee, A. Henley, B. Hinshaw, R. Pandita, 'OpenCBS: An Open-Source COBOL Defects Benchmark Suite', ICSME 2022, arXiv:2206.06260; artifact at PhaseChangeSoftware/cobol-defects-suite, commit a7a10bb0330c021c973792d1fd05275475bbcce1

**Licence** MIT, redistribution: redistributable

**What this establishes.** Which of the defects real COBOL developers actually reported are refused by BankTS at compile time, which are outside its safety model, and which it would compile as happily as COBOL does.

**What it does not.** Defects reconstructed from public forum posts, so they over-represent what people ask about rather than what most often reaches production. A defect BankTS cannot express at all is prevented trivially and is recorded as such rather than counted as a save.

## Reading the corpus

| | |
| --- | --- |
| COBOL files discovered | 53 |
| analysed without error | 53 / 53 (100.0%) |
| analyser failures | 0 |

## Representability under BankTS

Every percentage is of the files discovered, and a file is counted once.
This is a statement about what BankTS can express, not about whether any
program is correct: nothing in this corpus carries an expected output.

| Verdict | Files |
| --- | --- |
| fully-representable | 22 / 53 (41.5%) |
| representable-with-adaptation | 30 / 53 (56.6%) |
| unsupported-by-design | 0 / 53 (0.0%) |
| unsupported-not-yet-implemented | 0 / 53 (0.0%) |
| analyser-failure | 0 / 53 (0.0%) |
| unknown | 1 / 53 (1.9%) |

## Constructs BankTS cannot express, by how often they occur

| Construct | Support | Files | Share of corpus |
| --- | --- | --- | --- |
| `go-to` | adaptation | 25 | 47.2% |
| `usage-index` | adaptation | 4 | 7.5% |
| `string-unstring` | adaptation | 3 | 5.7% |
| `reference-modification` | adaptation | 1 | 1.9% |
| `perform-thru` | adaptation | 1 | 1.9% |

## Every construct found, by frequency

| Construct | Files | Lines | BankTS |
| --- | --- | --- | --- |
| `continuation` | 52 | 63 | supported |
| `accept-display` | 52 | 272 | supported |
| `go-to` | 25 | 124 | adaptation |
| `conditional` | 24 | 95 | supported |
| `move` | 21 | 55 | supported |
| `file-verbs` | 19 | 186 | supported |
| `file-status` | 17 | 20 | supported |
| `occurs` | 10 | 12 | supported |
| `comp-binary` | 9 | 16 | supported |
| `compute` | 6 | 10 | supported |
| `redefines` | 6 | 7 | supported |
| `comp-3` | 5 | 6 | supported |
| `condition-names` | 4 | 6 | supported |
| `file-indexed` | 4 | 4 | supported |
| `usage-index` | 4 | 5 | adaptation |
| `search` | 3 | 5 | supported |
| `string-unstring` | 3 | 4 | adaptation |
| `intrinsic-function` | 3 | 6 | supported |
| `exec-sql` | 3 | 18 | supported |
| `call-static` | 3 | 3 | supported |
| `linkage-section` | 3 | 3 | supported |
| `initialize` | 3 | 4 | supported |
| `perform-varying` | 2 | 2 | supported |
| `arithmetic-verbs` | 2 | 3 | supported |
| `evaluate` | 2 | 9 | supported |
| `reference-modification` | 1 | 8 | adaptation |
| `perform-thru` | 1 | 1 | adaptation |
| `rounded` | 1 | 1 | supported |

