import { atlasSetup } from "@/components/lab/atlas/data.server"
import { AtlasLanding } from "@/components/lab/atlas/atlas-landing"

export default async function AtlasLandingPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams
  return <AtlasLanding setup={atlasSetup()} demo={demo} />
}
