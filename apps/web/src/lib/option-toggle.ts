export function toggleSingle<T extends string>(current: T | null, target: T): T | null {
  return current === target ? null : target;
}

export function toggleMulti<T extends string>(current: readonly T[], target: T): T[] {
  if (current.includes(target)) {
    return current.filter((v) => v !== target);
  }
  return [...current, target];
}
