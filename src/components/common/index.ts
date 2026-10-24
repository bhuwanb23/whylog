/**
 * Shared presentation primitives — Phase 6.
 *
 * One import site for the pieces every view uses, so the visual language is applied consistently
 * rather than re-decided per screen. Consistency here is not aesthetic: a status badge that means
 * one thing on the timeline and a slightly different thing on the card teaches the user nothing.
 */

export {
  LabelBadge,
  StatusBadge,
  TimelineStatusBadge,
  StatusLegend,
  timelineStatusOf,
  TIMELINE_STATUS_COLOUR,
  TIMELINE_STATUS_MEANING,
  type TimelineStatus,
} from "./StatusBadge";

export { EmptyState, FirstRunState, type EmptyStateProps } from "./EmptyState";
export { Collapsible, type CollapsibleProps } from "./Collapsible";
export { ConfidenceBar } from "./ConfidenceBar";
export { EngineBadge, ModeBadge } from "./EngineBadge";
export {
  useKeybinds,
  describeKeybinds,
  isTypingTarget,
  KeyHint,
  type KeybindAction,
} from "./Keybind";
