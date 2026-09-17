// Length cut shared by the inbox filter grammar and the palette search (review IN-07: the same
// function was copied into both). No imports: the worker may bundle its callers.

/** Cuts to max UTF-16 units without leaving a lone high surrogate at the end. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}
