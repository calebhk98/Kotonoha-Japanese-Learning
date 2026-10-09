// Stub: implemented in the next commit.
export interface ContextCandidate { start: number; end: number; senses: string[][] }
export interface ContextSentenceIn { text: string; candidates: ContextCandidate[] }
export interface ContextSentenceOut { translation: string | null; candidates: { aligned: string[]; sims: number[] }[] }
export interface ContextModel { enrich(sentences: ContextSentenceIn[]): Promise<ContextSentenceOut[]> }
export const SENSE_MARGIN = 0.12;
export function chooseSense(_sims: number[]): number {
  return 0;
}
