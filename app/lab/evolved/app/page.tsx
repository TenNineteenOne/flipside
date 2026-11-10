import { Discover } from "@/components/lab/evolved/discover"

export const metadata = { title: "Feed · flipside" }

export default async function EvolvedApp({ searchParams }: { searchParams: Promise<{ demo?: string; view?: string; at?: string }> }) {
  const { demo, view, at } = await searchParams
  return <Discover demo={demo} view={view} at={at ? Number(at) : undefined} />
}
