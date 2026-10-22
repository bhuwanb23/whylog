/**
 * The decision-card components — Phase 6 · 6.2.
 *
 * One card, the whole formalism. The four sections no competitor has — RESTS ON / EXCLUDES with live
 * premise labels, ACCEPTED DOWNSIDE, ENTRENCHMENT with its five weighted terms, and PROVENANCE with
 * the verbatim snippet — are together the entire concept on one screen.
 */

export { DecisionCard, type DecisionCardProps, type CardAction } from "./DecisionCard";
export {
  PremiseList,
  premiseEntries,
  SectionLabel,
  type PremiseEntry,
} from "./PremiseList";
export { ProvenanceBlock, ORIGIN_MEANING } from "./ProvenanceBlock";
export { EntrenchmentBreakdown } from "./EntrenchmentBreakdown";
export { AuditTrail } from "./AuditTrail";
export {
  YStatement,
  AlternativeList,
  AcceptedDownside,
  GuardSummary,
  RelationList,
} from "./sections";
