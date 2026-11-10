import { Crate } from "@/components/lab/bside/crate"

export const metadata = { title: "Your crate · Flipside" }

export default async function BsideApp({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo = "" } = await searchParams
  return <Crate variant="app" demo={demo} />
}
