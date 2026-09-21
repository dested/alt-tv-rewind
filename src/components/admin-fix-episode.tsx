import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { episodeCode } from '~/lib/format'

// Admin-only: reassign a thread's primary episode, or mark it spam. Mounted by
// the thread page only when a session exists, so its episode list query runs for
// admins alone.
export function AdminFixEpisode({
  threadId,
  threadSlug,
  showSlug,
  currentEpisodeSlug,
}: {
  threadId: number
  threadSlug: string
  showSlug: string
  currentEpisodeSlug: string | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(currentEpisodeSlug ?? '')

  const episodesQuery = useQuery(trpc.episodes.list.queryOptions({ slug: showSlug }))
  const episodes = episodesQuery.data ?? []

  const invalidateThread = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.threads.get.queryKey({ show: showSlug, slug: threadSlug }),
    })

  const setEpisode = useMutation(
    trpc.admin.setThreadEpisode.mutationOptions({ onSuccess: invalidateThread })
  )
  const setSpam = useMutation(
    trpc.admin.setThreadSpam.mutationOptions({ onSuccess: invalidateThread })
  )

  function save(e: React.FormEvent) {
    e.preventDefault()
    const episodeId = episodes.find((ep) => ep.slug === selected)?.id ?? null
    setEpisode.mutate({ threadId, episodeId })
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-sm">
      <Label htmlFor="fix-episode">Episode</Label>
      <select
        id="fix-episode"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="border-input bg-background h-8 rounded-md border px-2 text-sm">
        <option value="">— none —</option>
        {episodes.map((ep) => (
          <option key={ep.slug} value={ep.slug}>
            {episodeCode(ep.seasonNumber, ep.number)} {ep.title}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={setEpisode.isPending}>
        {setEpisode.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={setSpam.isPending}
        onClick={() => setSpam.mutate({ threadId, isSpam: true })}>
        {setSpam.isPending ? '…' : 'Mark spam'}
      </Button>
      {setEpisode.error && (
        <span className="text-destructive text-sm">{setEpisode.error.message}</span>
      )}
    </form>
  )
}
