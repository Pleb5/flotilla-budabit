import type {WidgetBridge} from '@flotilla/ext-shared'
import type {RepoBranchInfo, WorkflowDefinition} from './types'

interface RepoListWorkflowsResponse {
  status?: string
  error?: string
  workflows?: WorkflowDefinition[]
  branches?: RepoBranchInfo[]
  defaultBranch?: string
  selectedBranch?: string
}

export async function loadRepoMetadata(bridge: WidgetBridge): Promise<{
  workflows: WorkflowDefinition[]
  branches: RepoBranchInfo[]
  defaultBranch: string
  selectedBranch: string
}> {
  const response = (await bridge.request('repo:listWorkflows', {})) as RepoListWorkflowsResponse

  if (response && typeof response === 'object' && typeof response.error === 'string') {
    throw new Error(response.error)
  }

  return {
    workflows: Array.isArray(response?.workflows) ? response.workflows : [],
    branches: Array.isArray(response?.branches) ? response.branches : [],
    defaultBranch: response?.defaultBranch || 'main',
    selectedBranch: response?.selectedBranch || '',
  }
}
