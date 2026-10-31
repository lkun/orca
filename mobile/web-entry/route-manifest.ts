import type { RequireContext } from 'expo-router/build/types'

// The web builder replaces this placeholder with static imports; esbuild cannot use Metro’s require.context.
const routeContext: RequireContext = Object.assign(
  (id: string): never => {
    throw new Error(`[occ-mobile-web-app] route manifest was not generated: ${id}`)
  },
  {
    keys: (): string[] => [],
    resolve: (id: string): string => {
      throw new Error(`[occ-mobile-web-app] route manifest was not generated: ${id}`)
    },
    id: 'occ-mobile-web-app-routes'
  }
)

export default routeContext
