import { Route, Routes } from 'react-router-dom'
import { SettingsDialog } from '@/components/SettingsDialog'
import { FriendsPage } from '@/pages/FriendsPage'
import { FriendPage } from '@/pages/FriendPage'

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">WeRead Ranking</div>
            <div className="truncate text-xs text-muted-foreground">朋友阅读数据与历史变化</div>
          </div>
          <SettingsDialog />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<FriendsPage />} />
          <Route path="/friends/:userVid" element={<FriendPage />} />
        </Routes>
      </main>
    </div>
  )
}
