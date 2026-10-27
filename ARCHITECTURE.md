# Architecture Summary: WhyLog Security Audit

## Product and Purpose
- **Product**: WhyLog, a truth maintenance system for decisions made while building with AI agents
- **Purpose**: Tracks decisions under assumptions, detects when assumptions change, and flags affected downstream decisions
- **Users**: AI development teams, coding agents, developers building with AI

## Normal Authority and Trust boundaries
- **Lower-trust principals**: AI coding agents making decisions without full context
- **Higher-trust principals**: Human developers reviewing and disposing proposals
- **Protected resources**: Decision logs, premise stores, cascade results, export configurations
- **Trust boundary**: The system treats decisions as beliefs held under assumptions; when assumptions change, it flags affected decisions

## Tech Stack and Source-Visible Deployment
- **Languages**: TypeScript/Node.js
- **Build system**: npm/vite based (from package.json observations)
- **Runtime**: Node.js >= 20.11.0
- **Local engine**: Default engine runs keyless/deterministically offline
- **Offline build/test**: `npm run check:structure`, `npm run verify`, `npm run typecheck`
- **Offline eval**: `npm run eval`, `npm run eval:ablation`, `npm run eval:report`
- **Key directories**: `src/`, `plan/`, `docs/`, `tests/`

## Entry Surfaces and Source-to-Sink Paths
1. **CLI/env/config**: `npm run dev`, `npm run check:*`, `npm run eval:*` - all local, no network
2. **Decision inputs**: Transcripts pasted into `Import & review` view, processed by local engine
3. **Premise storage**: Append-only bi-temporal event log (Phase 0 substrate)
4. **Cascade propagation**: Real-time label diff analysis (Phase 5)
5. **Export output**: Graph → CIF → 5 artifacts in single pass (Phase 5)
6. **Guard compilation**: Templates that COMPILE decisions into checks (Phase 4)

## Trust Boundaries and Source-Visible Controls
- **Decision as belief under assumption**: Core invariant - nodes relabelled, immutable events with reasons
- **Premises are shared nodes**: `single-user` is one node that multiple decisions point at
- **Retrieval proposes, classifier disposes**: Cosine similarity never produces verdict; `Use Postgres` and `don't use Postgres` are similar
- **System proposes, human disposes**: No auto-applied retraction, reversal, guard or export
- **Keyless by default**: Local engine default, no API keys required

## Repository-Relative Starting Paths
- `STRUCTURE.md` - file-by-file map
- `THEORY.md` - TMS, entrenchment, cascading, deviations
- `LIMITATIONS.md` - 10 real constraints
- `plan/OVERVIEW.md` - six layers, AI seam, four invariants, three gates
- `docs/` - research documents
- `src/types/` - type contracts
- `src/substrate/` - event log, fold, bi-temporal, identity, hash chain

## Prior Coverage Gaps (from previous runs if applicable)
- No prior audit runs found for this repository
- Security invariants deliberately documented in theory and limitations
- Gates (a) and (c), backtracking, cascade, entrenchment and adjudication claimed deterministic and engine-independent
- LLM only improves gate (b)'s recall and proposal phrasing, not load-bearing for correctness

## Companion Selection (per ATTACK-CLASSES.md)
- **DATA-ISOLATION-AND-LIFECYCLE.md**: For premise lifecycle and entrenchment tracking
- **CLIENT-SIDE.md**: For any client-side components (likely minimal given keyless design)
- **CLOUD-AND-DEPLOYMENT.md**: For deployment models - likely minimal as default is keyless local
- **SUPPLY-CHAIN-AND-RELEASE.md**: For dependency chains in Phase 7 hardening

## Deterministic Coverage Ledger (initial)
- One unit per combination of entry surface, trust boundary, subsystem, and attack class
- Profile: standard -> full coverage at defined granularity
- Canonical references: repository-relative paths + attack class blocks