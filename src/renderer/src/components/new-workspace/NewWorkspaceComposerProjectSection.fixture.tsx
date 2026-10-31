import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import {
  getProjectHostSetupSelectionKey,
  type ProjectHostSetupOption
} from '@/lib/project-host-setup-options'
import { NewWorkspaceComposerProjectSection } from './NewWorkspaceComposerProjectSection'

const projects: NewWorkspaceProjectOption[] = [
  {
    kind: 'project',
    id: 'occ',
    projectId: 'occ',
    displayName: 'occ',
    badgeColor: 'var(--muted-foreground)',
    detail: 'stablyai/occ'
  },
  {
    kind: 'project',
    id: 'personal-occ',
    projectId: 'personal-occ',
    displayName: 'occ',
    badgeColor: 'var(--muted-foreground)',
    detail: 'personal/occ'
  },
  {
    kind: 'project',
    id: 'api',
    projectId: 'api',
    displayName: 'platform-api',
    badgeColor: 'var(--muted-foreground)',
    detail: 'stablyai/platform-api'
  },
  {
    kind: 'project-group',
    id: 'folder',
    projectGroupId: 'folder',
    displayName: 'Design workspace',
    badgeColor: 'var(--muted-foreground)',
    detail: '/Users/alice/Projects/design',
    parentPath: '/Users/alice/Projects/design',
    connectionId: null
  }
]
const hosts: ProjectHostSetupOption[] = [
  {
    kind: 'ready',
    id: 'local',
    projectId: 'occ',
    repoId: 'occ-local',
    hostId: 'local',
    label: 'MacBook Pro',
    detail: 'Local',
    path: '/Users/alice/Projects/occ'
  },
  {
    kind: 'ready',
    id: 'remote',
    projectId: 'occ',
    repoId: 'occ-remote',
    hostId: 'ssh:devbox',
    label: 'Dev server',
    detail: 'SSH',
    path: '/home/alice/projects/occ'
  },
  {
    kind: 'needs-setup',
    id: 'windows',
    projectId: 'occ',
    hostId: 'runtime:windows',
    label: 'Windows workstation',
    detail: 'Project location not set',
    isAvailable: true,
    attention: false,
    canSetLocation: true
  }
]

function ProjectAndHostPreview({
  folderOnly = false
}: {
  folderOnly?: boolean
}): React.JSX.Element {
  const [project, setProject] = useState(folderOnly ? 'folder' : 'occ')
  const [host, setHost] = useState('local')
  return (
    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
      <h1 className="text-base font-semibold">New worktree</h1>
      <NewWorkspaceComposerProjectSection
        projectError={null}
        selectedRepoConnectionId={null}
        selectedRepoRequiresConnection={false}
        selectedRepoConnectInProgress={false}
        projectOptions={projects}
        selectedProjectId={project}
        onProjectChange={setProject}
        projectDescriptionId="fixture-project-description"
        onAddProject={() => {}}
        focusNameInput={() => {}}
        shouldShowRunTargetPicker={!folderOnly}
        projectHostSetupOptions={hosts}
        selectedProjectHostSetupId={host}
        handleProjectHostSetupChange={(key) => {
          const option = hosts.find(
            (candidate) => getProjectHostSetupSelectionKey(candidate) === key
          )
          if (option) {
            setHost(option.id)
          }
        }}
        ephemeralVmRecipes={[]}
        handleAddSshHost={() => {}}
        handleAddRemoteServer={() => {}}
        handleConnectRunTargetHost={async () => {}}
        handleSetLocation={() => {}}
        onConnectSelectedRepo={async () => {}}
        sshStatusLabel="Connected"
        connectButtonLabel="Connect"
        selectedProjectName="occ"
      />
    </div>
  )
}

export const closed = defineFixture({ width: 560, render: () => <ProjectAndHostPreview /> })
export const narrow = defineFixture({ width: 360, render: () => <ProjectAndHostPreview /> })
export const folderOnly = defineFixture({
  width: 560,
  render: () => <ProjectAndHostPreview folderOnly />
})
export const projectMenu = defineFixture({
  ...closed,
  interact: (frame) => {
    frame.querySelector<HTMLInputElement>('[aria-label="Project"][role="combobox"]')?.focus()
  }
})
export const hostMenu = defineFixture({
  ...closed,
  interact: (frame) => {
    frame.querySelector<HTMLInputElement>('[aria-label="Run on"][role="combobox"]')?.focus()
  }
})

export const narrowProjectMenu = defineFixture({ ...projectMenu, width: 360 })
export const narrowHostMenu = defineFixture({ ...hostMenu, width: 360 })

function tooltipFixture(attribute: string) {
  return defineFixture({
    ...closed,
    interact: async (frame) => {
      frame
        .querySelector(`div[${attribute}]`)
        ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }))
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  })
}

export const projectTooltip = tooltipFixture('data-project-combobox-root')
export const hostTooltip = tooltipFixture('data-run-target-combobox-root')
