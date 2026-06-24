# AI-ALE LIMS Viewer - DEEP-DIVE AUDIT #2 (Scientific-Validity lens)
Timestamp: 2026-06-24 08:24 CDT
Prepared by: Vibhav
Repo: ai-ale-lims-data-viewer (live on port 3457 / modelseed.org/projects/aiale)
DB audited: data/lims_indexed.db (251MB indexed mirror of Fei's lims_mirror.backup.db)
Probe script: /tmp/sci_audit.py (one-pass, read-only)

WHY A SECOND AUDIT
------------------
The first audit (the Natascha round, docs/PRE_MEETING_DATA_AUDIT.md) asked one
question: "is the data wrong/deleted/duplicated?" It found and fixed the obvious
correctness/leakage class (soft-delete leakage, re-sequenced fan-out, barcode
joins, orphan registries, NaN filters).

This second pass uses a DIFFERENT persona on purpose, so it sees what the first
could not. The question here is:

  "If a biologist reads a number off this tool to make a scientific claim, is it
   the CORRECT number, or is the tool confidently showing them the WRONG one?"

That is the silent-wrong-answer class. A tool that shows nothing is annoying; a
tool that shows a plausible-but-wrong number is dangerous, because nobody
double-checks it. The big finding below is exactly that.

================================================================================
CLEAN BILL OF HEALTH (things I checked that are GOOD - say so in the meeting)
================================================================================
These all passed. Worth stating out loud so the team trusts the rest.
- Mutation frequencies: all 223,222 calls are within [0,1]. None negative, none
  >1, none null. breseq frequency semantics are intact.
- Copy number values are biologically sane: dgoA-star 0.53 to 10.6 (real
  amplification), verC 0.81 to 2.05. No negative or zero CN, no NULLs in live
  rows, no low-coverage (<20x) CN calls that would be unreliable.
- dgoA-star ground-truth timecourse climbs and plateaus as expected
  (TFMN1.fba.1: T1=0.72, T5=1.69, T11=4.46, T20=4.65, T32=4.46). The headline
  biology reads correctly.
- OD readings are plausible: 0.024 to 1.832, none negative, none absurd.
- Mutation genomic positions are coherent (no end<start, no negative positions).
- Mutation type / category vocab is consistent (SNP/INS/DEL/SUB; 10 clean
  categories). Barcode counts have no negatives/nulls.

================================================================================
FINDING 1 [CRITICAL - VIEWER FIX] - The default view shows the WRONG mutation
count for 4 of 5 experiments (off by ~200x)
================================================================================
THE PROBLEM IN ONE LINE:
  When you open the tool with no experiment selected, every TFMN1 sample shows
  "1 mutation." Scope to TFMN1 and the SAME samples show ~220 mutations each.

EVIDENCE (pulled live from /api/mutations just now):
  TFMN1.fba.1.T1.P  : default view = 1 call   |  TFMN1 view = 221 calls
  TFMN1.fba.1.T5.P  : default view = 1 call   |  TFMN1 view = 223 calls
  TFMN1.fba.1.T11.P : default view = 1 call   |  TFMN1 view = 216 calls
  TFMN1.fba.1.T20.P : default view = 1 call   |  TFMN1 view = 216 calls
  (same pattern for every TFMN1 and TFMN4 sample)

WHY IT HAPPENS (root cause, traced):
  Each breseq run (registry) calls mutations against a specific reference genome.
  The API auto-picks a default registry = the one with the most calls GLOBALLY,
  which is breseq_0b03256c7a (reference ACN3500_NSS.gbk). That run only covers
  TFMN2/TFMN3 samples. TFMN1 and TFMN4 were sequenced against DIFFERENT
  references:
    TFMN1   -> best registry breseq_5c16a7d304 (ref ACN2586_NSS)  46,387 calls
    TFMN4   -> best registry breseq_a3961e6844 (ref, null metadata) 35,957 calls
    strain_stocks -> best registry breseq_df1972644b               5,217 calls
  So in the default all-experiments view, TFMN1/TFMN4 samples are matched against
  the wrong reference and almost none of their real calls show up. The grid still
  LISTS those samples (the sample-list fix from round 1 is working), it just
  shows them with a near-empty mutation row.

WHY IT'S DANGEROUS:
  "1 mutation" is a believable number. A researcher glancing at the default grid
  would conclude TFMN1 lineages are nearly clonal/unmutated, which is the
  opposite of the truth (~220 calls each). Nobody re-checks a number that looks
  reasonable. This is the worst kind of bug: silently, confidently wrong.

IMPORTANT NUANCE (so we don't over-claim):
  The moment you pick an experiment from the dropdown, the API re-selects the
  correct per-experiment registry and the counts are right. So this is ONLY the
  default (no-experiment-selected) landing view. Growth curves and copy number
  are NOT registry-gated and are correct in both views.

THE FIX (viewer-side, I can do it):
  Don't pick the global max-call registry as the default. Either (a) when no
  experiment is selected, pick the per-experiment best registry for each sample's
  experiment when building the mutation rows, or (b) make the default landing
  state require/auto-select an experiment so a sample is never shown against a
  reference it wasn't called on. Lowest-risk option: when no experiment is
  chosen, suppress the mutation column / show a "pick an experiment to see
  mutation calls" state instead of a misleading "1". I will confirm which
  behavior the team wants before shipping, since it changes what the landing
  page does.

================================================================================
FINDING 2 [MEDIUM - VIEWER FIX] - Duplicate mutation rows inflate per-sample
counts within a single run
================================================================================
WHAT'S WRONG:
  Within ONE registry, the same mutation (same sample, same position, same
  gene, same new_seq) is recorded as multiple rows. 1,526 such groups,
  ~1,531 excess rows total. When I tighten the grouping to also match
  ref_seq + type + frequency, 1,016 groups are still true semantic duplicates
  (the other ~510 are legit multi-allelic / different-frequency calls at the
  same position).

ROOT CAUSE (inspected one 3x group): the rows share the same mutation id but
  carry different evidence_ids (e.g. 220 / 221 / 222). breseq emitted multiple
  evidence lines for one mutation and the sync flattened each into its own row.

CONSEQUENCE: any per-sample "total mutations" the UI shows is over-counted by
  the number of duplicate evidence rows for that sample. Small relative to ~220
  calls, but it makes exact counts untrustworthy and would skew a
  "mutations per lineage" comparison.

FIX OPTIONS:
  - Viewer-side: dedup mutation rows on (Seq_sample, registry, position,
    gene_name, ref_seq, new_seq, type, frequency) before counting/rendering.
    Safe, reversible, doesn't touch the DB.
  - Upstream (cleaner): collapse multi-evidence breseq rows during the sync so
    one mutation = one row. This is a Natascha/Fei question.

================================================================================
FINDING 3 [DISCUSSION - FOR CHRIS] - Registry choice materially changes the
mutation set (not a bug, but a science decision the tool forces silently)
================================================================================
228 sequencing samples have mutations called under MORE THAN ONE registry, and
the call counts differ substantially between runs:
  TFMN1.tpiA.5.T20.P : 219 calls (reg 483a96084b) vs 299 calls (reg 5c16a7d304) -> spread 80
  ANLstock.ACN2586.colony3 : 212 / 260 / 224 across three registries
  ANL.stock.ACN3500.colony2 : 194 / 231 / 208 / 194 across FOUR registries

So "how many mutations does this sample have" depends on which breseq run you
trust, and the difference is tens of calls. The tool currently just picks one and
shows it without flagging that a different defensible choice gives a different
answer. This isn't fixable in code - it's a "which run is canonical per
experiment, and against which reference" decision for Chris. Recommend: agree a
canonical registry per experiment and make the tool default to it (ties into
Finding 1's fix).

================================================================================
FINDING 4 [FOR NATASCHA - UPSTREAM] - 24% of named mutation calls reference
gene names not in the Genes registry
================================================================================
54,072 mutation calls (24% of all named calls) carry a gene_name that does not
exist as an ID in the Genes table. Almost all are intergenic two-gene labels
(e.g. "ACIAD_RS12645/ACIAD_RS12650", 16,360 calls) or RS-locus tags not loaded
into Genes. Consequence: if the viewer ever tries to enrich a mutation with gene
function/annotation from the Genes table, it will come back blank for a quarter
of calls. Not breaking anything today (the viewer reads gene_name straight off
the Mutations row), but it caps any future "show gene function" feature.
QUESTION FOR NATASCHA: should intergenic / RS-locus identifiers be added to the
Genes registry, or is gene_name deliberately free-text from breseq?

================================================================================
GROWTH-CURVE COVERAGE (re-confirmed, consistent with round 1)
================================================================================
Per-experiment OD-curve join yield:
  TFMN1 100% (209/209), TFMN2 100% (237/237), TFMN3 100% (18/18),
  TFMN4 76% (202/264 - the 62 misses line up with the re-sequenced dup set),
  ALE1b / EASyTwist25 / EASyUnchar22 / Gyorgy / breseq_benchmark_1 /
  strain_stocks: 0% (these have no Robotic_OD rows at all - same upstream
  sequenced-but-not-fully-loaded story from round 1, expected for stocks).

================================================================================
SUGGESTED MEETING FLOW
================================================================================
1. Lead with the good news (clean bill of health section) so they trust the tool.
2. Finding 1 is the one to fix before anyone uses the default view for a claim.
   Decide the desired default behavior (auto-pick per-experiment registry vs
   require an experiment). I will implement once we agree.
3. Finding 2: agree dedup at viewer or upstream.
4. Findings 3 and 4 are questions for Chris/Natascha, not viewer bugs.
