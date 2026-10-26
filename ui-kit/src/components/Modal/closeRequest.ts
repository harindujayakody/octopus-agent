import { createContext, useContext } from 'react'

/** Asks the dialog around it to close, the way Esc, the backdrop and the
 *  close button do: with unsaved input (`dirty`) it asks Discard / Keep
 *  editing first. `then` runs in place of the plain close once the close is
 *  agreed (a DialogModal's `onCancel`). */
export type RequestClose = (then?: () => void) => void

export const RequestCloseContext = createContext<RequestClose | null>(null)

/** The close request of the Modal this renders in; null outside one. */
export const useRequestClose = () => useContext(RequestCloseContext)
