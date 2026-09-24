// Leave native text editing, held keys, and already-handled events alone.
export function kanbanHistoryShortcut(event: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
  altKey: boolean; repeat: boolean; defaultPrevented: boolean; target: EventTarget | null;
}) {
  const target = event.target as HTMLElement | null;
  const matches = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z"
    && !event.altKey && !event.repeat && !event.defaultPrevented
    && !target?.isContentEditable
    && !target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]');
  return matches ? (event.shiftKey ? "redo" : "undo") : null;
}
