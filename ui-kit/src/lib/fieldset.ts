import { useLayoutEffect, useState, type RefObject } from 'react'

/** Whether a disabled <fieldset> holds the element. HTML turns off only the form
 *  controls inside it; a control drawn on a div follows them through this. */
export function useFieldsetDisabled(ref: RefObject<HTMLElement | null>): boolean {
  const [off, setOff] = useState(false)
  // Read after each render: the fieldset changes with the form around it.
  useLayoutEffect(() => {
    const now = !!ref.current?.closest('fieldset:disabled')
    if (now !== off) setOff(now)
  })
  return off
}
