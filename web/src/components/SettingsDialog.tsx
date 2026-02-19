import * as React from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSettings } from '@/lib/settings'

export function SettingsDialog() {
  const { settings, setSettings } = useSettings()

  const [open, setOpen] = React.useState(false)
  const [apiBaseUrl, setApiBaseUrl] = React.useState(settings.apiBaseUrl)
  const [apiKey, setApiKey] = React.useState(settings.apiKey)

  React.useEffect(() => {
    if (!open) return
    setApiBaseUrl(settings.apiBaseUrl)
    setApiKey(settings.apiKey)
  }, [open, settings.apiBaseUrl, settings.apiKey])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="mr-2 h-4 w-4" />
          设置
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API 设置</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="apiBaseUrl">API Base URL（可留空，默认走同域 / Vite 代理）</Label>
            <Input
              id="apiBaseUrl"
              placeholder="例如：https://weread-ranking.<your>.workers.dev"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              placeholder="x-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              autoComplete="off"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
              }}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                setSettings({ apiBaseUrl, apiKey })
                setOpen(false)
              }}
            >
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

