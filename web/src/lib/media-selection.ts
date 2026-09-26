/** Toggle one item, or the visible range between it and the previous click. */
export function toggleMediaSelection(
  selected: ReadonlySet<string>,
  visibleIds: string[],
  id: string,
  anchor: string | null,
  extend: boolean,
): Set<string> {
  const first = anchor && selected.size ? visibleIds.indexOf(anchor) : -1;
  const last = visibleIds.indexOf(id);
  const targets =
    extend && first !== -1 && last !== -1
      ? visibleIds.slice(Math.min(first, last), Math.max(first, last) + 1)
      : [id];
  const next = new Set(selected);
  const remove = selected.has(id);
  for (const target of targets) {
    if (remove) next.delete(target);
    else if (next.size < 500) next.add(target);
  }
  return next;
}
