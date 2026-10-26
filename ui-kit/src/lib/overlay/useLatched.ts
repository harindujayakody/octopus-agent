import { useRef } from 'react'

/** The last shown value: a dialog keeps drawing its subject while it leaves
 *  after the subject is gone (FEEL-01: `open={target != null}` with the latch). */
export function useLatched<T>(value: T | null | undefined | false): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  if (value !== null && value !== undefined && value !== false) ref.current = value as T
  return ref.current
}
