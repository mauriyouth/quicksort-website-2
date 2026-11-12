/**
 * Cmd+S / Ctrl+S saves whatever is being edited instead of opening the
 * browser's "Save page as…" dialog.
 *
 * The target is resolved from where the user is:
 *  1. the nearest save scope around the focused element — a `<form>` (its
 *     submit button, including one outside it via `form="…"`) or an element
 *     marked `data-save-scope` (its `[data-save-shortcut]` button);
 *  2. otherwise the single visible `[data-save-shortcut]` button.
 * An open modal (`aria-modal="true"`) confines both lookups to itself.
 * Disabled buttons are left alone, so the shortcut never bypasses validation
 * or a save already in flight.
 */

function visible(el: Element) {
  return el.getClientRects().length > 0;
}

function submitButtonOf(form: HTMLFormElement) {
  return Array.from(form.elements).find(
    (el): el is HTMLButtonElement | HTMLInputElement =>
      (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === "submit",
  );
}

function saveTarget(): HTMLElement | undefined {
  const modals = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter(visible);
  const root = modals[modals.length - 1] ?? document.body;

  const focused = document.activeElement;
  const scope = focused && root.contains(focused) ? focused.closest("form, [data-save-scope]") : null;
  if (scope && root.contains(scope)) {
    return scope instanceof HTMLFormElement
      ? submitButtonOf(scope)
      : scope.querySelector<HTMLElement>("[data-save-shortcut]") ?? undefined;
  }

  const marked = Array.from(root.querySelectorAll<HTMLElement>("[data-save-shortcut]")).filter(visible);
  return marked.length === 1 ? marked[0] : undefined;
}

export function installSaveShortcut() {
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (event.repeat) return;
    const button = saveTarget();
    if (button && !(button as HTMLButtonElement).disabled) button.click();
  });
}
