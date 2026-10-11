import type { TokenInfo } from './tokenizers.js';
import type { PositionedToken } from './tokenContext.js';

export function isKanaHeavy(_sentence: string): boolean {
  return false;
}

export function kanaLemma(_convSurface: string, _kanaSurface: string, _lemma: string): string | undefined {
  return undefined;
}

export function alignConverted(_original: string, _offset: number, _conv: TokenInfo[]): PositionedToken[] | null {
  return null;
}
