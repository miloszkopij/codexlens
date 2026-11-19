export const maxAccessBatchSize = 100;

/** Keep server previews within their cap without silently dropping selected people. */
export function splitAccessBatches(memberIds: string[]): string[][] {
  const unique = [...new Set(memberIds)];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += maxAccessBatchSize) batches.push(unique.slice(start, start + maxAccessBatchSize));
  return batches;
}

/** Never advance after a failed, uncertain, or still-running membership attempt. */
export function accessBatchComplete(changes: number, verified: number | null, blockedByError: boolean, busy: boolean): boolean {
  return !blockedByError && !busy && (changes === 0 || verified === changes);
}
