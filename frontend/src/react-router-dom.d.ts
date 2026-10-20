declare module 'react-router-dom' {
  import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react'

  export type NavigateFunction = (to: string | number, options?: { replace?: boolean }) => void
  export type NavLinkState = { isActive: boolean; isPending: boolean; isTransitioning: boolean }
  export type NavLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
    to: string
    end?: boolean
    className?: string | ((state: NavLinkState) => string)
  }
  export type RouteProps = { path?: string; index?: boolean; element?: ReactNode; children?: ReactNode }
  export const BrowserRouter: ComponentType<{ children?: ReactNode }>
  export const Navigate: ComponentType<{ to: string; replace?: boolean }>
  export const Outlet: ComponentType<Record<string, never>>
  export const Route: ComponentType<RouteProps>
  export const Routes: ComponentType<{ children?: ReactNode }>
  export const NavLink: ComponentType<NavLinkProps>
  export function useNavigate(): NavigateFunction
}
