/**
 * Page Object Model exports for Git E2E testing
 *
 * These page objects encapsulate the UI interactions for the Git-related
 * pages in the flotilla-budabit application, following Playwright best practices.
 *
 * Usage:
 * ```typescript
 * import { GitHubPage, RepoListPage, RepoDetailPage, CloneDialogPage } from './pages'
 *
 * test('example', async ({ page }) => {
 *   const gitHub = new GitHubPage(page, 'relay-url')
 *   await gitHub.goto()
 *   await gitHub.clickNewRepo()
 * })
 * ```
 */

export {GitHubPage} from "./git-hub.page"
export {RepoListPage} from "./repo-list.page"
export {RepoDetailPage, type RepoTab} from "./repo-detail.page"
export {CloneDialogPage} from "./clone-dialog.page"
export {ForkDialogPage} from "./fork-dialog.page"
