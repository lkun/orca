import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // A string tsconfig skips the lookup, which otherwise climbs to the desktop app's tsconfig.
  oxc: { tsconfig: false },
  resolve: {
    alias: {
      // The directory, so subpath imports (relay-contract/relay-regions) resolve too.
      '@occ-cloud/relay-contract': fileURLToPath(new URL('../../packages/relay-contract/src', import.meta.url)),
      // Tests only: lets them import the relay's database module for the live schema.
      '@occ-cloud/postgres-schema': fileURLToPath(new URL('../../packages/postgres-schema/src', import.meta.url))
    }
  },
  test: { include: ['test/**/*.test.ts'] }
})
