/**
 * Rehydration State - Lightweight module for rehydration scheduling state
 *
 * This module is separated to avoid circular dependency chains.
 * It has NO imports to keep the dependency graph clean.
 */

let rehydrationScheduled = false;

export function isRehydrationScheduled(): boolean {
  return rehydrationScheduled;
}

export function setRehydrationScheduled(value: boolean): void {
  rehydrationScheduled = value;
}
