import { atlasSetup } from "@/components/lab/atlas/data.server"
import { AtlasApp } from "@/components/lab/atlas/atlas-app"

export default async function AtlasAppPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams
  return <AtlasApp setup={atlasSetup()} demo={demo} />
}
