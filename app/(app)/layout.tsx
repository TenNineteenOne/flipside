import { AppNav } from "@/components/nav/app-nav"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppNav />
      {/* pb-16 on mobile to clear the fixed bottom nav */}
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
    </div>
  )
}
