export function formatIso(ms: number | null | undefined): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString()
}

export function formatShortTime(ms: number | null | undefined): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-'
  if (!Number.isFinite(seconds)) return '-'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatSignedDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-'
  if (!Number.isFinite(seconds)) return '-'
  const sign = seconds < 0 ? '-' : '+'
  const abs = Math.abs(seconds)
  return `${sign}${formatDurationSeconds(abs)}`
}

export function delta(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return null
  if (b === null || b === undefined) return null
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return a - b
}
