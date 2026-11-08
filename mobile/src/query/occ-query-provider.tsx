import { useEffect, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { createOCCQueryClient } from './occ-query-client'

// React Native has no visibilitychange, so foreground revalidation follows AppState.
function followAppState(setFocused: (focused?: boolean) => void): () => void {
  const subscription = AppState.addEventListener('change', (state) =>
    setFocused(state === 'active')
  )
  return () => subscription.remove()
}

export function OCCQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createOCCQueryClient)
  useEffect(() => focusManager.setEventListener(followAppState), [])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
