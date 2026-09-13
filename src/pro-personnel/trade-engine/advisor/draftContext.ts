export function draftTradeContext(cfcYear: number, status?: { complete: boolean; dayOneComplete: boolean }): string {
  if (status?.complete) return `The ${cfcYear} rookie draft is complete; ${cfcYear + 1}+ picks remain tradeable.`;
  if (status?.dayOneComplete) return `Round 1 of the ${cfcYear} rookie draft is complete; later-round ${cfcYear} picks may still be tradeable.`;
  return `The ${cfcYear} rookie draft is not complete; use the supplied tradeable assets without assuming a round has finished.`;
}
