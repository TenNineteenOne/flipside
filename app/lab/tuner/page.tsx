import { Landing } from "@/components/lab/tuner/landing"

export default async function TunerLanding({ searchParams }: { searchParams: Promise<{ demo?: string; station?: string }> }) {
  const { demo, station } = await searchParams
  return <Landing demo={demo === "on"} initialStation={station} />
}
