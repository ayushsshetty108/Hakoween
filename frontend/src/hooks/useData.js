import { useQuery } from '@tanstack/react-query'

export function useData(loader, key = 'data') {
  const query = useQuery({
    queryKey: ['workspace', key],
    queryFn: loader,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  return { data: query.data ?? null, loading: query.isPending, error: query.error }
}
