import { createPortal } from 'react-dom'

/** Renders into `#portal-root` when the host page has one, else `body`. */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.getElementById('portal-root') ?? document.body)
}
