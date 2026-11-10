import { DropApp } from "@/components/lab/drop/drop-app"

export default async function DropAppPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams
  return <DropApp demo={demo} />
}
