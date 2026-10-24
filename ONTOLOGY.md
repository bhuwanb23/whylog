# ONTOLOGY

Fourteen decision variables, eight premise types, and the tables that make free text addressable.

All counts below were read from the source in `src/ontology/data/`, not from a design document. When a
table changes, this file is wrong until it is regenerated — the numbers are stated so that being wrong is
detectable.

| Table | File | Size |
| --- | --- | --- |
| Decision variables | `variables.ts` | **15** (14 typed + `OTHER`) |
| Premise types | `premise-types.ts` | **8** |
| Premise predicates | `premise-types.ts` | **43** |
| Value aliases | `aliases.ts` | **724** alias strings |
| Antonym pairs | `antonyms.ts` | **90** |
| Exclusion rules | `exclusions.ts` | **20** |
| Decision cues | `decision-cues.ts` | **120** |
| Premise cues | `premise-cues.ts` | **181** |

---

## 1. Why an ontology at all

A decision log that stores free text can be searched but cannot be reasoned about. "SQLite" and "sqlite"
and "the embedded one" are three strings; a contradiction detector needs them to be one value. And "not
Postgres" is a decision *against* Postgres, which a keyword extractor reads as a decision *for* it.

So the ontology does three jobs, and each is load-bearing for a specific mechanism:

1. **Canonicalisation** — free text → one value. Without it, gate (a) cannot compare two decisions.
2. **Antonymy** — which values are mutually exclusive. Without it, gate (a) cannot tell a refinement from
   a contradiction.
3. **Exclusion** — which premises a decision rules out. Without it, there is no OUT-list, no non-monotonic
   reasoning and no gate (c).

Job 3 is the one nobody else does, and it is why the exclusion table exists at all.

---

## 2. The fifteen variables

```
DATABASE      AUTH          HOSTING       FRAMEWORK     LANGUAGE
STORAGE       API_STYLE     STATE         TESTING       UI_KIT
PAYMENTS      RETRIEVAL     ARCHITECTURE  SCOPE
─────────────────────────────────────────────────────────────
OTHER         ← the escape hatch, and it is a real one
```

`VARIABLES` is a plain id array. `VARIABLE_META` carries per-variable metadata, `VARIABLE_ORDER` the
display order used by the lattice layout (columns are ordered by premise type, decisions by variable, so a
deterministic layout needs a deterministic order), and `TEMPLATE_VERIFIABLE_VARIABLES` the subset for which
Phase 4 can synthesise a guard from a template.

**`OTHER` is not a failure state.** A decision about a variable the ontology does not name is still a
decision, still gets premises, still cascades. What it loses is gate (a): two `OTHER` decisions cannot be
compared structurally, because "the same variable" is undefined. They fall through to gate (b), which is
weaker. That is the correct degradation and it is better than refusing to store the decision.

Five variables have guard templates written specifically for them (`database`, `framework`, `hosting`,
`auth`, `storage`). All fifteen have a generic template, which is why a synthesis rate above 80% is
plausible rather than optimistic — `generic-rejected` needs no variable knowledge at all.

---

## 3. The eight premise types

```
scale          how many users, records, requests, writers
team           how many people, what skills, who is available
budget         what it costs, what can be spent
time           deadline, phase, how long is left
deployment     where it runs, what infrastructure exists
capability     what the platform or a dependency can do
requirement    what the product must do
external       what a third party, API or regulation imposes
```

`WORLD_OBSERVABLE` and `INTENT_BASED` partition them. The distinction matters for gate (c): a
world-observable premise can be falsified by a guard or by a transcript reporting reality, while an
intent-based one can only be falsified by someone changing their mind. Treating them the same would let a
CI check invalidate a requirement, which is a category error with visible consequences.

**Merging across types is forbidden regardless of text similarity.** "single user" (`scale`) and "single
sign-on user flow" (`requirement`) are never the same node. A false merge produces a spectacular wrong
cascade — falsifying a scale assumption retracts an authentication decision — so the identity ladder checks
type before it checks similarity, and the premise-extraction metric requires type agreement for the same
reason.

---

## 4. The 43 predicates

Namespaced by type: `scale.max_users`, `scale.concurrent_writers`, `deployment.infrastructure`,
`budget.monthly_usd`, `team.headcount`, and so on.

Predicate-first identity is what makes premises **shared** (invariant I2). Two transcripts that both
establish `scale.max_users = 1` produce one node, not two, so falsifying it reaches every decision resting
on it. An extractor that emits bare prose predicates produces a duplicate node on every re-import, and the
graph quietly stops being a graph.

Values are `string | number | boolean`, which is why the metric reports predicate errors separately from
value errors: the same predicate with a different value is a *contradiction*, while a different predicate
over the same span is an *extraction error*. They look alike in a confusion matrix and have completely
different fixes.

---

## 5. Aliases, antonyms, exclusions

**724 alias strings** fold surface forms onto canonical values: "postgres", "pg", "postgresql", "the
server one" → `postgres`. `GLOBAL_ALIASES` apply across variables; `NONE_VALUES` is separate, because "none"
means something different under `HOSTING` (serverless) than under `PAYMENTS` (not charging yet).

**90 antonym pairs** make gate (a) possible: `sqlite ↔ postgres`, `serverless ↔ self-hosted`,
`monolith ↔ microservices`. Without them, two decisions on the same variable with different values are
indistinguishable from a refinement, and the classifier defaults to the verdict that `docs/03` says gets
tools uninstalled.

**20 exclusion rules** produce the OUT-list. This is the table that makes gate (c) work:

```
   DATABASE = sqlite        EXCLUDES   scale.concurrent_writers > 1
   HOSTING  = serverless    EXCLUDES   deployment.needs_long_running_process = true
   AUTH     = none          EXCLUDES   requirement.multi_tenant = true
```

The first of these is what the demo's peak beat depends on. `fixtures/demo-transcript.txt` states the
single-user premise but **never states the exclusion in words** — Phase 1 derives it from this table. That is
why the corpus deliberately does not label it: quoting text nobody said, in order to label a node the
ontology produced, would defeat the entire purpose of requiring labels to be verbatim quotes.

---

## 6. Cues

**120 decision cues** and **181 premise cues**, indexed for lookup (`DECISION_CUE_INDEX`,
`PREMISE_CUE_INDEX`).

Each carries a weight and a modality implication. A cue that marks a statement as *asserted* can create an
IN node; one that marks it *hypothetical* cannot. `TOPICAL_AUTO_ACCEPT_THRESHOLD` and
`EXPLICIT_AUTO_ACCEPT_THRESHOLD` separate a premise the transcript states outright from one the topic merely
implies — and a topical cue always goes to the review queue, because inferring an assumption the speaker
never voiced is exactly the move that produces nodes nobody decided.

Two ablation switches test these tables directly: `negationCues` (predicted to be the largest extraction
delta, since "not Postgres" without negation handling becomes a decision *for* Postgres) and `noiseCollapse`
(predicted to affect only the messy tool-output transcript, which is itself a check that the toggle is
scoped correctly).

---

## 7. Extending the ontology

The tables are data, and adding to them requires no code change:

| To add | Edit | Then |
| --- | --- | --- |
| A variable | `variables.ts` — `VARIABLE_META`, `VARIABLE_ORDER` | Gate (a) covers it immediately. Add a guard template in `guards/templates/` if it should be verifiable |
| A premise type | `premise-types.ts` — `PREMISE_TYPE_META`, `PREMISE_TYPE_ORDER`, and `WORLD_OBSERVABLE` or `INTENT_BASED` | Partitioning is required, not optional: an unpartitioned type cannot be falsified correctly |
| A predicate | `premise-types.ts`, under its type | It becomes an identity target, so existing nodes with prose predicates will not merge into it |
| An alias | `aliases.ts` | Free. Canonicalisation picks it up on the next import |
| An antonym pair | `antonyms.ts` | Gate (a) starts firing on that pair — check it is genuinely exclusive, because a false antonym produces false positives |
| An exclusion rule | `exclusions.ts` | Creates OUT-list entries, which makes decisions retractable. This is the highest-consequence edit in the ontology |
| A cue | `decision-cues.ts` / `premise-cues.ts` | Decide explicit vs topical. Topical always routes to review |

**The exclusion table is the one to be careful with.** Every rule added makes some set of decisions
non-monotonic — retractable by information that never mentions them. That is the product's central
capability and also its central risk, which is why survivor preservation is measured separately from
cascade correctness and why over-retraction is the first of the four demo-killers.

A new exclusion rule should be accompanied by a corpus plant: a transcript that establishes the premise, one
that falsifies it, and a labelled expectation about what flips and what survives. Without that, the rule is
untested in the one dimension where it can do damage.
