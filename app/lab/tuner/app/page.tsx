import { TunerApp } from "@/components/lab/tuner/tuner-app"

export default async function TunerAppPage({ searchParams }: { searchParams: Promise<{ demo?: string; station?: string }> }) {
  const { demo, station } = await searchParams
  return <TunerApp demo={demo === "on"} initialStation={station} />
}
