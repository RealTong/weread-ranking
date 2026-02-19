import * as React from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AioResponse, RefreshResponse } from '@/lib/api'
import { apiFetch } from '@/lib/api'
import { formatDurationSeconds, formatIso, formatShortTime } from '@/lib/format'
import { useSettings } from '@/lib/settings'

export function FriendsPage() {
  const { settings } = useSettings()

  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [aio, setAio] = React.useState<AioResponse | null>(null)
  const [lastRefreshResult, setLastRefreshResult] = React.useState<RefreshResponse | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<AioResponse>(settings, '/api/aio?limit=500&offset=0')
      setAio(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setAio(null)
    } finally {
      setLoading(false)
    }
  }, [settings])

  React.useEffect(() => {
    void load()
  }, [load])

  const friends = React.useMemo(() => {
    const items = aio?.friends ?? []
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((f) => (f.name ?? String(f.userVid)).toLowerCase().includes(q))
  }, [aio?.friends, search])

  async function doRefresh() {
    setRefreshing(true)
    setLastRefreshResult(null)
    setError(null)
    try {
      const result = await apiFetch<RefreshResponse>(settings, '/api/refresh', { method: 'POST' })
      setLastRefreshResult(result)
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>朋友阅读数据</CardTitle>
            <div className="text-sm text-muted-foreground">
              最新抓取：累计阅读 {formatIso(aio?.latest.metaCapturedAt ?? null)}；周榜 {formatIso(aio?.latest.rankingCapturedAt ?? null)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading || refreshing}>
              重新加载
            </Button>
            <Button onClick={doRefresh} disabled={loading || refreshing}>
              {refreshing ? '刷新中…' : '刷新数据'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-sm">
              <Input placeholder="搜索朋友（名称 / Vid）" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="text-sm text-muted-foreground">共 {friends.length} 人</div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>请求失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {lastRefreshResult ? (
            <Alert>
              <AlertTitle>刷新完成</AlertTitle>
              <AlertDescription>
                friendsMeta={lastRefreshResult.counts.friendsMeta}, profiles={lastRefreshResult.counts.profiles}, ranking=
                {lastRefreshResult.counts.ranking}, avatarsStored={lastRefreshResult.counts.avatarsStored}（{lastRefreshResult.finishedAt}）
              </AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>朋友</TableHead>
                    <TableHead className="text-right">累计阅读</TableHead>
                    <TableHead className="text-right">周榜</TableHead>
                    <TableHead className="text-right">周阅读</TableHead>
                    <TableHead className="text-right">更新时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {friends.map((f) => (
                    <TableRow key={f.userVid} className="hover:bg-muted/50">
                      <TableCell>
                        <Link to={`/friends/${f.userVid}`} className="flex items-center gap-3">
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
                            {f.avatarUrl ? (
                              <img src={f.avatarUrl} alt={f.name ?? String(f.userVid)} className="h-9 w-9 object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {f.name ?? `Vid ${f.userVid}`}{' '}
                              {f.isWeChatFriend === 1 ? <Badge variant="secondary">微信好友</Badge> : null}
                              {f.isHide === 1 ? <Badge variant="outline" className="ml-1">隐藏</Badge> : null}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{f.location ?? '-'}</div>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatDurationSeconds(f.latestTotalReadingTime)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {f.latestRanking ? `#${f.latestRanking.orderIndex}` : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatDurationSeconds(f.latestRanking?.readingTime ?? null)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatShortTime(f.latestMetaCapturedAt ?? null)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

