import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  occRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.occRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.occRendererRoot = root
  }
  return root
}
