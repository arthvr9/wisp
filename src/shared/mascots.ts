export type MascotName = 'wisp' | 'coffee' | 'cat' | 'ghost' | 'plant';

export const MASCOTS: readonly MascotName[] = ['wisp', 'coffee', 'cat', 'ghost', 'plant'];

export function isMascot(value: unknown): value is MascotName {
  return typeof value === 'string' && (MASCOTS as readonly string[]).includes(value);
}
