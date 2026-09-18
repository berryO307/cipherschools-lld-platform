import { useEffect, useState } from 'react'
import { api } from '@/api/client'

interface CurrentUser {
  id: string
  displayName: string
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getMe()
      .then((me) => {
        if (!cancelled) setUser({ id: me.id, displayName: me.displayName })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load user')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { user, error, loading: !user && !error }
}
