# AI-ALE LIMS Viewer - Pre-Meeting Data Audit
Prepared for the test-query session with Chris Henry + Natasha (nspahr).
Date: pre-meeting deep dive. DB: data/lims_indexed.db (mirror of lims_mirror.backup.db).

Goal: get ahead of "a few other things that need fixing" by running the kind of
test queries the meeting would surface, so we walk in with root causes (and some
fixes) already in hand.

================================================================================
TL;DR - what's actually going on
================================================================================
Two classes of problem:

  A. APP/QUERY bugs we can fix in the viewer (already fixed one; 2 more queued).
  B. UPSTREAM DATA-SYNC gaps in the mirror itself - the viewer is showing them
     faithfully; the data is missing/duplicated at the source. These need Chris.

The single already-shipped fix (TFMN1/TFMN4 now selectable) was type A. Most of
what's left looks like type B - which is exactly why a joint session with Chris
makes sense.

================================================================================
FINDING 1 - Soft-deleted rows leak into the raw "Database Tables" browser  [APP]
================================================================================
Every table has a `deleted` flag (0=live, 1=deleted). The Mutation Explorer
correctly filters deleted=0 everywhere. The raw table browser (Database Tables
tab) does NOT - it shows all rows including deleted ones.

Impact - what you SEE vs what's LIVE:
  Samples:              1253 shown  ->  572 live   (681 deleted shown)
  Seq_samples:          1690 shown  ->  885 live   (800 deleted shown)
  Seqsamples:            680 shown  ->  471 live   (209 deleted shown)
  Experiments:            51 shown  ->   16 live   (35 deleted shown!)
  Robotic_ALE_samples:   417 shown  ->  323 live   (94 deleted shown)

So browsing Experiments shows 51 rows when only 16 are real. This very likely
reads as "wrong data / duplicate junk."

FIX (low risk, viewer-side): add a default `deleted=0` filter to the raw browser
with a "show deleted" toggle for auditing. Ready to implement once we agree the
browser should hide deletes by default.

================================================================================
FINDING 2 - TFMN4 (and others) reference breseq registries that DON'T EXIST  [DATA - for Chris]
================================================================================
This is the big one. TFMN4's entire mutation set is attributed to two breseq
registry IDs that are NOT in the Breseq_registry table at all:

  TFMN4 mutations:
    breseq_a3961e6844  -> 35,957 mutations  -> NOT in Breseq_registry
    breseq_6f4ff9aa5b  -> 17,733 mutations  -> NOT in Breseq_registry
  Plus a third orphan used elsewhere: breseq_e4545f1b6d

  Total: 54,820 mutations point at registries missing from the registry table.

Consequence: the breseq parameters + reference genome for TFMN4's calls are
blank in the viewer (registry dropdown shows the ID + count but reference=null).
The calls are reachable now (after Finding-3 fix), but with no run metadata.

Root cause is upstream: the Breseq_registry mirror is out of sync with the
registry IDs the Mutations rows were written against. QUESTION FOR CHRIS: were
the TFMN4 breseq runs registered under different IDs, or did the registry sync
miss them? This is a mirror/sync fix, not a viewer fix.

================================================================================
FINDING 3 - Default sample list was registry-scoped (FIXED, shipped to main)  [APP - DONE]
================================================================================
The default Sample Selection scoped samples to one breseq registry
(0b03256c7a, ref ACN3500), which only covers TFMN2/TFMN3/strain_stocks - so
TFMN1 and TFMN4 vanished from the picker. Fixed: registry now filters only the
mutation calls, not the sample list. 258 -> 760 samples; all 5 experiments
selectable; copy-number populates by default. Live on main.

Context that makes this subtle: a single seq_sample can have mutations under up
to 4 different registries (e.g. TFMN1.fba.1.T1.P spans 4). TFMN1 alone has calls
under 4 registries, all vs ref ACN2586_NSS. So "which registry" genuinely
changes which calls you see - worth a deliberate test query in the meeting.

================================================================================
FINDING 4 - Sequenced experiments with ZERO mutation calls loaded  [DATA - for Chris]
================================================================================
These experiments have sequencing samples in the mirror but no breseq mutations:

  ALE1b:            12 seq_samples,  0 mutations
  EASyTwist25:      44 seq_samples,  0 mutations
  EASyUnchar22:     46 seq_samples,  0 mutations
  breseq_benchmark_1:3 seq_samples,  0 mutations

If anyone expects to see variant calls for the EASy isolates, this is why they
can't. QUESTION FOR CHRIS: were these never run through breseq, or are the
results just not synced into the mirror yet?

================================================================================
FINDING 5 - Duplicate/legacy table pairs are confusing the browser  [APP + DATA]
================================================================================
There are parallel near-duplicate tables:

  Seq_samples (885 live)  vs  Seqsamples (471 live)
     -> Seqsamples is a strict SUBSET (471 in both, 0 unique to Seqsamples).
        Seqsamples is legacy/redundant; Seq_samples is authoritative.
  Seq_orders (35)  vs  Seqorders (19)
  dgoA_alleles_new (10)  vs  dgoA_alleles_old (3)

Showing both in the table list invites picking the wrong/partial one.
FIX (viewer-side): hide the legacy duplicates (Seqsamples, Seqorders,
dgoA_alleles_old) from the browser, or label them clearly. Cheap win.

================================================================================
FINDING 6 - Duplicate Sequencing_sample IDs within Seq_samples  [DATA - minor]
================================================================================
5 sequencing_sample IDs appear twice in live Seq_samples, all TFMN4:
  TFMN4.exp2.ACN3788.concX_largeLib_SpeI.{1.T13.P, 1.T3.P, 1.T4.P, 2.T3.P, 2.T4.P}
Duplicate keys can double rows in joins. Worth a dedupe upstream or a note.

================================================================================
FINDING 7 - Copy-number data is sparse + 1 orphan/NULL row  [DATA - minor]
================================================================================
Copy_numbers (457 live rows) only covers two regions, two experiments:
  Region dgoA-star: 378 rows   Region verC: 79 rows
  By experiment: TFMN4 251, TFMN1 209, strain_stocks 1, (NULL experiment) 1
  - 1 CN row's Seqsample has no live Seq_samples match (orphan)
  - 1 CN row has a NULL experiment
Note: region is stored as "dgoA-star" (not "dgoA*"); viewer reads it dynamically
so display is consistent - no code mismatch there.

================================================================================
FINDING 8 - Robotic_OD: a third of rows have no sample_name  [DATA - check]
================================================================================
Robotic_OD has 141,792 rows; 46,872 (33%) have NULL sample_name. Growth-curve
plotting keys on (sample_name, transfer), so those rows can't be mapped to a
lineage. Likely blank/background wells - but worth confirming none are real
cultures that lost their sample_name in the sync.

================================================================================
Suggested test queries to run live with Chris
================================================================================
1. TFMN4 breseq registry: where did breseq_a3961e6844 / breseq_6f4ff9aa5b come
   from, and why aren't they in Breseq_registry?  (Finding 2)
2. EASyTwist25 / EASyUnchar22: were these breseq'd? expected calls vs zero. (F4)
3. Same seq_sample under 4 registries (TFMN1.fba.1.T1.P) - which run is the
   "current" one we should default to per experiment? (F3)
4. Confirm Seqsamples/Seqorders/dgoA_alleles_old are legacy and safe to hide. (F5)
5. Robotic_OD null-sample_name rows - all blanks, or some real? (F8)

================================================================================
Viewer-side fixes I can ship before the meeting (your call)
================================================================================
- [DONE]  Finding 3: TFMN1/TFMN4 selectable (on main).
- [READY] Finding 1: hide deleted rows by default in the raw browser (+toggle).
- [READY] Finding 5: hide/label legacy duplicate tables.
Findings 2, 4, 6, 7, 8 are upstream data/sync issues for Chris - viewer is
reporting them faithfully.
