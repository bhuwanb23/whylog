/**
 * Keyboard — 6.9.
 *
 * Phase 6 · sub-phase 6.9
 * Plan: plan/phase-6-presentation.md §6.9
 *
 * ---------------------------------------------------------------------------
 * FOUR BINDINGS, AND WHY THESE FOUR
 *
 *   ⌘K / Ctrl+K   ask          the product's primary verb, and the binding muscle memory already
 *                              knows from every other tool
 *   N             quick log    for someone mid-flow who just made a decision and does not want to
 *                              lose it — ten seconds, no transcript
 *   P             paste        the entry point; first-run drop-off is the most common failure in
 *                              this category and the paste target should be one keystroke away
 *   Esc           dismiss      close whatever is open, without hunting for the button
 *
 * Nothing else is bound. A keyboard scheme with thirty bindings is one nobody learns, and the four
 * above cover the four actions that account for almost all use.
 *
 * ---------------------------------------------------------------------------
 * BINDINGS NEVER FIRE WHILE TYPING
 *
 * Every one of these is a single letter except ⌘K, and a single-letter binding that fires inside a
 * text field makes the product unusable — you cannot type the word "no" into a search box without
 * being navigated twice. So the handler checks the event target and bails on any editable element.
 *
 * This is the bug that makes keyboard support feel broken rather than helpful, and it is invisible
 * until someone tries to type.
 * ---------------------------------------------------------------------------
 */

import { type ReactElement, useEffect } from "react";

export interface KeybindAction {
  readonly key: string;
  readonly meta?: boolean;
  readonly label: string;
  readonly run: () => void;
}

/** Is the event target an editable element? Covers inputs, textareas, selects and anything
 *  contenteditable, which is what a paste target usually is. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;

  const element = target as HTMLElement;
  const tag = element.tagName;

  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable === true) return true;

  return false;
}

/**
 * Install the bindings.
 *
 * Returns nothing and cleans up on unmount, so it can be called once at the app root.
 */
export function useKeybinds(actions: readonly KeybindAction[]): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      /* Esc always works, including inside a text field — dismissing a modal while typing into it
       * is exactly when you want to dismiss it. */
      if (event.key === "Escape") {
        const dismiss = actions.find((action) => action.key === "Escape");
        if (dismiss !== undefined) {
          dismiss.run();
          return;
        }
      }

      if (isTypingTarget(event.target)) return;

      for (const action of actions) {
        if (action.key === "Escape") continue;

        const wantsMeta = action.meta === true;
        const hasMeta = event.metaKey || event.ctrlKey;
        if (wantsMeta !== hasMeta) continue;

        if (event.key.toLowerCase() !== action.key.toLowerCase()) continue;

        event.preventDefault();
        action.run();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}

/** The bindings, as a printable list. Rendered in the settings view and the first-run state,
 *  because a keyboard scheme nobody can look up is a keyboard scheme nobody uses. */
export function describeKeybinds(actions: readonly KeybindAction[]): string {
  return actions
    .map((action) => {
      const key =
        action.meta === true
          ? "⌘/Ctrl + " + action.key
          : action.key === "Escape"
            ? "Esc"
            : action.key;
      return key.padEnd(12) + action.label;
    })
    .join("\\n");
}

/** A hint chip, rendered beside a button that also has a binding, so the binding is discoverable
 *  from the thing it acts on rather than only from a reference panel. */
export function KeyHint({ binding }: { binding: string }): ReactElement {
  return (
    <kbd
      className="mono faint"
      style={{
        fontSize: 9,
        border: "1px solid var(--border-strong)",
        borderRadius: 3,
        padding: "1px 4px",
        marginLeft: 6,
        background: "var(--surface-sunken)",
      }}
    >
      {binding}
    </kbd>
  );
}
