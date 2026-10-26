'use client'
import { createContext, useContext } from 'react'

/**
 * Framework-agnostic link plumbing.
 *
 * Kit components render links through <Link>, which uses whatever link
 * component the host app injects via <LinkProvider> (e.g. next/link or a
 * react-router Link). If nothing is provided, it falls back to a plain <a>,
 * so the kit works everywhere with zero required setup.
 */
export type LinkComponentProps = {
  href: string
  children?: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export type LinkComponent = React.ComponentType<LinkComponentProps>

const LinkContext = createContext<LinkComponent | null>(null)

export function LinkProvider({
  component,
  children,
}: {
  component: LinkComponent
  children: React.ReactNode
}) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>
}

export function useLinkComponent(): LinkComponent | null {
  return useContext(LinkContext)
}

/** Renders through the injected link component, or a native <a> as fallback. */
export function Link({ href, children, ...rest }: LinkComponentProps) {
  const Component = useContext(LinkContext)
  if (Component) {
    return (
      <Component href={href} {...rest}>
        {children}
      </Component>
    )
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}
