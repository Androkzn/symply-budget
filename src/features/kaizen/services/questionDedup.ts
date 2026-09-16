/** FNV-1a 32-bit hex — same approach as backend health-coach validators. */
export function hashPrompt(prompt: string): string {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isDuplicatePrompt(
  prompt: string,
  existing: Array<{ prompt: string; source_hash?: string | null; deleted_at?: string | null }>,
): boolean {
  const hash = hashPrompt(prompt);
  return existing.some(
    row =>
      !row.deleted_at &&
      (row.source_hash === hash || hashPrompt(row.prompt) === hash),
  );
}
