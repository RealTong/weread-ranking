import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AioResponse, FriendHistoryResponse } from '@/lib/api'
import { apiFetch } from '@/lib/api'
import { delta, formatDurationSeconds, formatIso, formatShortTime, formatSignedDurationSeconds } from '@/lib/format'
import { useSettings } from '@/lib/settings'

function asInt(input: string | undefined): number | null {
  if (!input) return null
  const n = Number.parseInt(input, 10)
  return Number.isFinite(n) ? n : null
}

export function FriendPage() {
  const { settings } = useSettings()
  const params = useParams()
  const userVid = asInt(params.userVid)

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [aio, setAio] = React.useState<AioResponse | null>(null)
  const [history, setHistory] = React.useState<FriendHistoryResponse | null>(null)

  const load = React.useCallback(async () => {
    if (!userVid) return
    setLoading(true)
    setError(null)
    try {
      const [aioData, histData] = await Promise.all([
        apiFetch<AioResponse>(settings, '/api/aio?limit=500&offset=0'),
        apiFetch<FriendHistoryResponse>(settings, `/api/friends/${userVid}/history?limit=200`),
      ])
      setAio(aioData)
      setHistory(histData)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setAio(null)
      setHistory(null)
    } finally {
      setLoading(false)
    }
  }, [settings, userVid])

  React.useEffect(() => {
    void load()
  }, [load])

  const friend = React.useMemo(() => {
    if (!aio || !userVid) return null
    return aio.friends.find((f) => f.userVid === userVid) ?? null
  }, [aio, userVid])

  const metaAsc = React.useMemo(() => {
    const items = history?.history.meta ?? []
    return [...items].reverse()
  }, [history?.history.meta])

  const rankingAsc = React.useMemo(() => {
    const items = history?.history.ranking ?? []
    return [...items].reverse()
  }, [history?.history.ranking])

  const metaChartData = React.useMemo(() => {
    return metaAsc.map((m) => ({
      capturedAt: m.capturedAt,
      total: m.totalReadingTime,
    }))
  }, [metaAsc])

  const rankingChartData = React.useMemo(() => {
    return rankingAsc.map((r) => ({
      capturedAt: r.capturedAt,
      readingTime: r.readingTime,
      orderIndex: r.orderIndex,
    }))
  }, [rankingAsc])

  if (!userVid) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>无效的 userVid</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link to="/">返回</Link>
        </Button>
        <Button variant="outline" onClick={load} disabled={loading}>
          重新加载
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                {friend?.avatarUrl ? (
                  <img src={friend.avatarUrl} alt={friend.name ?? String(userVid)} className="h-10 w-10 object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="truncate">{friend?.name ?? `Vid ${userVid}`}</div>
                <div className="truncate text-sm font-normal text-muted-foreground">{friend?.location ?? '-'}</div>
              </div>
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              Vid {userVid}{' '}
              {friend?.isWeChatFriend === 1 ? <Badge variant="secondary">微信好友</Badge> : null}{' '}
              {friend?.isHide === 1 ? <Badge variant="outline">隐藏</Badge> : null}
            </div>
          </div>

          <div className="text-right text-sm">
            <div>
              <span className="text-muted-foreground">累计：</span>
              <span className="font-mono tabular-nums">{formatDurationSeconds(friend?.latestTotalReadingTime ?? null)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">周榜：</span>
              <span className="font-mono tabular-nums">{friend?.latestRanking ? `#${friend.latestRanking.orderIndex}` : '-'}</span>
            </div>
            <div className="text-xs text-muted-foreground">更新时间：{formatIso(friend?.latestMetaCapturedAt ?? null)}</div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">累计阅读（随时间变化）</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      total: { label: '累计阅读', color: 'hsl(var(--chart-1))' },
                    }}
                    className="h-[220px] w-full"
                  >
                    <LineChart data={metaChartData} margin={{ left: 12, right: 12, top: 10, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="capturedAt"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={(v) => formatShortTime(Number(v))}
                      />
                      <YAxis
                        width={48}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(v) => `${Math.round(Number(v) / 3600)}h`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="var(--color-total)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">周阅读（随时间变化）</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      readingTime: { label: '周阅读', color: 'hsl(var(--chart-2))' },
                    }}
                    className="h-[220px] w-full"
                  >
                    <LineChart data={rankingChartData} margin={{ left: 12, right: 12, top: 10, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="capturedAt"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={(v) => formatShortTime(Number(v))}
                      />
                      <YAxis
                        width={48}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(v) => `${Math.round(Number(v) / 60)}m`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="monotone"
                        dataKey="readingTime"
                        stroke="var(--color-readingTime)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">累计阅读快照</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead className="text-right">累计</TableHead>
                        <TableHead className="text-right">增量</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history?.history.meta ?? []).map((m, idx, arr) => {
                        const prev = idx + 1 < arr.length ? arr[idx + 1] : null
                        const d = prev ? delta(m.totalReadingTime, prev.totalReadingTime) : null
                        return (
                          <TableRow key={m.capturedAt}>
                            <TableCell className="text-xs text-muted-foreground">{formatIso(m.capturedAt)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatDurationSeconds(m.totalReadingTime)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {d === null ? '-' : formatSignedDurationSeconds(d)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">周榜快照</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead className="text-right">排名</TableHead>
                        <TableHead className="text-right">周阅读</TableHead>
                        <TableHead className="text-right">增量</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history?.history.ranking ?? []).map((r, idx, arr) => {
                        const prev = idx + 1 < arr.length ? arr[idx + 1] : null
                        const d = prev ? delta(r.readingTime, prev.readingTime) : null
                        return (
                          <TableRow key={`${r.capturedAt}-${r.orderIndex}`}>
                            <TableCell className="text-xs text-muted-foreground">{formatIso(r.capturedAt)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">#{r.orderIndex}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatDurationSeconds(r.readingTime)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {d === null ? '-' : formatSignedDurationSeconds(d)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
