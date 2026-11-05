import { useEffect, useState } from 'react'

export function useData(loader, key = 'data') {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => { let live = true; loader().then(data => live && setState({ data, loading: false, error: null })).catch(error => live && setState({ data: null, loading: false, error })); return () => { live = false } }, [key])
  return state
}
