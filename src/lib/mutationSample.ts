export function deriveReplicate(sampleName: string | null): string | undefined {
  if (!sampleName) return undefined;

  // Older lineages end in a numeric replicate (for example, `TFMN1.fba.1`).
  const terminalNumeric = sampleName.match(/\.(\d+)$/);
  if (terminalNumeric) return terminalNumeric[1];

  // Sequenced samples often retain the transfer suffix, so accept both an
  // explicit replicate segment (`LdgoA3.A.T504`) and compact letter form
  // (`LdgoA3A.T504`). Letter replicates are limited to the A-J plate range.
  const beforeTransfer = sampleName.match(/\.([A-J]|\d+)\.T\d+(?:\.[A-Za-z]\w*)?$/i);
  if (beforeTransfer) return beforeTransfer[1];
  const compactLetter = sampleName.match(/\d([A-J])\.T\d+(?:\.[A-Za-z]\w*)?$/i);
  return compactLetter?.[1];
}
