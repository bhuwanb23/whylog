# Needs Validation

## Outstanding Validation Requirements

The following items require independent verification before the audit can be complete:

1. **Coverage Ledger Validation**: The coverage-ledger.json units must be validated against the actual source tree to ensure all entry surfaces, trust boundaries, subsystems, and attack classes are properly captured.

2. **Attack Class Definitions**: The attack classes referenced in the ledger (DEFAULT, VALIDATION, ENTRENCHMENT, BACKTRACK, CONSISTENCY-GATE, TEMPLATES, AUTO-APPLY) must be verified against the ATTACK-CLASSES.md source definitions.

3. **Canonical Reference Stability**: The canonical references (entry paths, boundary definitions, subsystem modules, attack class blocks) must be verified as source-grounded and stable across runs.

4. **Prior Run Carry-Over**: If this audit builds on prior runs, the carry-over of confirmed records must be validated with fingerprints matched against current source.

5. **Sandbox Capability Verification**: The sandbox constraints (no external network, empty allowlisted environment, read-only target/toolchain, scratch-only writes) must be verified as enforceable in the execution environment.

6. **Promotion Capability Verification**: The parent-side code's ability to promote scratch files to artifacts with path-confined no-follow descriptor traversal must be verified.

## Validation Plan

- Phase 3 verifiers will independently re-check each candidate unit
- Canonical references will be walked from the retained scratch-root descriptor
- fstat checks will verify regular file identity, link count, and size bounds
- Destination files will be verified as regularly-created with exclusive creation
- Final validation report will list any unvalidated fingerprints and their units

## Status

- Coverage ledger: 7 units planned, awaiting source validation
- Findings: Empty, awaiting hunter results
- Architecture: Created and documented
- Run metadata: Established with standard profile, budget 50
