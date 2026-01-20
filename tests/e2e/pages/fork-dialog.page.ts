import {expect, type Locator, type Page} from "@playwright/test"

/**
 * Page object for the Fork Repository Dialog (ForkRepoDialog component)
 *
 * This dialog allows users to fork a repository to their preferred
 * git service (GitHub, GitLab, Bitbucket, or GRASP).
 *
 * The dialog contains:
 * - Original repository information
 * - Git service selection dropdown
 * - Fork name input with validation
 * - GRASP relay URL input (when GRASP is selected)
 * - Earliest unique commit selection
 * - Progress indicators during fork operation
 * - Success/error states with action buttons
 */
export class ForkDialogPage {
  readonly page: Page

  // Main dialog container
  readonly dialog: Locator
  readonly dialogTitle: Locator
  readonly closeButton: Locator

  // Original repo info section
  readonly originalRepoInfo: Locator

  // Form elements
  readonly gitServiceSelect: Locator
  readonly forkNameInput: Locator
  readonly relayUrlInput: Locator
  readonly earliestCommitInput: Locator

  // Validation errors
  readonly forkNameError: Locator
  readonly relayUrlError: Locator

  // Buttons
  readonly forkButton: Locator
  readonly cancelButton: Locator
  readonly retryButton: Locator
  readonly closeSuccessButton: Locator

  // Status indicators
  readonly existingForkStatus: Locator
  readonly checkingForkSpinner: Locator
  readonly forkErrorMessage: Locator
  readonly successMessage: Locator
  readonly progressSteps: Locator
  readonly loadingSpinner: Locator

  // GRASP-specific elements
  readonly graspServerChips: Locator

  // Success state elements
  readonly forkUrlLink: Locator
  readonly copyUrlButton: Locator
  readonly copyCloneButton: Locator
  readonly showDetailsButton: Locator

  constructor(page: Page) {
    this.page = page

    // Main dialog
    this.dialog = page.locator('[role="dialog"][aria-labelledby="fork-dialog-title"]')
    this.dialogTitle = page.locator("#fork-dialog-title")
    this.closeButton = this.dialog.locator('button[aria-label="Close dialog"]')

    // Original repo info
    this.originalRepoInfo = this.dialog.locator('[class*="bg-gray-800"]').first()

    // Form elements
    this.gitServiceSelect = page.locator("#git-service")
    this.forkNameInput = page.locator("#fork-name")
    this.relayUrlInput = page.locator("#relay-url")
    this.earliestCommitInput = page.locator("#earliest-commit")

    // Validation errors
    this.forkNameError = page.locator("#fork-name-error")
    this.relayUrlError = page.locator("#relay-url-error")

    // Buttons
    this.forkButton = this.dialog.locator('button[type="submit"]')
    this.cancelButton = this.dialog.locator("button").filter({hasText: "Cancel"})
    this.retryButton = this.dialog.locator("button").filter({hasText: "Try again"})
    this.closeSuccessButton = this.dialog.locator("button").filter({hasText: /Close|Done/})

    // Status indicators
    this.existingForkStatus = this.dialog.locator('[class*="bg-gray-800"]').filter({
      hasText: /fork|repository/i,
    })
    this.checkingForkSpinner = this.dialog.locator('[class*="animate-spin"]').filter({
      has: page.locator('text="Checking"'),
    })
    this.forkErrorMessage = this.dialog.locator('[class*="bg-red-900"]')
    this.successMessage = this.dialog.locator('[class*="text-green-400"]').filter({
      hasText: /success/i,
    })
    this.progressSteps = this.dialog.locator('[class*="space-y-2"]').locator('[class*="flex items-center"]')
    this.loadingSpinner = this.dialog.locator('[class*="animate-spin"]')

    // GRASP-specific
    this.graspServerChips = this.dialog.locator("button").filter({hasText: /wss?:\/\//i})

    // Success state elements
    this.forkUrlLink = this.dialog.locator('a[target="_blank"]').filter({
      hasText: /github\.com|gitlab\.com|bitbucket\.org|wss?:\/\//i,
    })
    this.copyUrlButton = this.dialog.locator("button").filter({hasText: "Copy URL"})
    this.copyCloneButton = this.dialog.locator("button").filter({hasText: "Copy"})
    this.showDetailsButton = this.dialog.locator("button").filter({hasText: /details/i})
  }

  /**
   * Wait for the fork dialog to open and be visible
   */
  async waitForDialogOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible({timeout: 10000})
    await expect(this.dialogTitle).toContainText("Fork Repository")
  }

  /**
   * Wait for the fork dialog to close
   */
  async waitForDialogClose(): Promise<void> {
    await expect(this.dialog).not.toBeVisible({timeout: 10000})
  }

  /**
   * Check if the dialog is currently open
   */
  async isOpen(): Promise<boolean> {
    return await this.dialog.isVisible()
  }

  /**
   * Close the dialog using the close button (X)
   */
  async close(): Promise<void> {
    await this.closeButton.click()
    await this.waitForDialogClose()
  }

  /**
   * Cancel the fork operation
   */
  async clickCancel(): Promise<void> {
    await this.cancelButton.click()
    await this.waitForDialogClose()
  }

  /**
   * Select a git service from the dropdown
   */
  async selectGitService(service: "github.com" | "gitlab.com" | "bitbucket.org" | "grasp"): Promise<void> {
    await this.gitServiceSelect.selectOption(service)
    // Wait for any UI updates based on service selection
    await this.page.waitForTimeout(200)
  }

  /**
   * Get the currently selected git service
   */
  async getSelectedGitService(): Promise<string> {
    return await this.gitServiceSelect.inputValue()
  }

  /**
   * Set the fork name
   */
  async setForkName(name: string): Promise<void> {
    await this.forkNameInput.clear()
    await this.forkNameInput.fill(name)
  }

  /**
   * Get the current fork name value
   */
  async getForkName(): Promise<string> {
    return await this.forkNameInput.inputValue()
  }

  /**
   * Set the GRASP relay URL (only visible when GRASP is selected)
   */
  async setRelayUrl(url: string): Promise<void> {
    await expect(this.relayUrlInput).toBeVisible()
    await this.relayUrlInput.clear()
    await this.relayUrlInput.fill(url)
  }

  /**
   * Get the relay URL value
   */
  async getRelayUrl(): Promise<string> {
    return await this.relayUrlInput.inputValue()
  }

  /**
   * Click a known GRASP server chip to auto-fill relay URL
   */
  async selectKnownGraspServer(url: string): Promise<void> {
    const serverChip = this.dialog.locator("button").filter({hasText: url})
    await expect(serverChip).toBeVisible()
    await serverChip.click()
  }

  /**
   * Set the earliest unique commit hash
   */
  async setEarliestCommit(commit: string): Promise<void> {
    await this.earliestCommitInput.fill(commit)
  }

  /**
   * Focus on the earliest commit input to show dropdown
   */
  async focusCommitInput(): Promise<void> {
    await this.earliestCommitInput.focus()
  }

  /**
   * Select a commit from the dropdown
   */
  async selectCommitFromDropdown(commitOidPrefix: string): Promise<void> {
    await this.focusCommitInput()
    await this.page.waitForTimeout(300) // Wait for dropdown to appear
    const commitOption = this.dialog.locator("button").filter({hasText: commitOidPrefix})
    await commitOption.click()
  }

  /**
   * Clear the selected commit
   */
  async clearSelectedCommit(): Promise<void> {
    const clearButton = this.dialog.locator('button[aria-label="Clear commit"]')
    if (await clearButton.isVisible()) {
      await clearButton.click()
    }
  }

  /**
   * Click the fork button to start the fork operation
   */
  async clickFork(): Promise<void> {
    await expect(this.forkButton).toBeEnabled()
    await this.forkButton.click()
  }

  /**
   * Click retry after a fork failure
   */
  async clickRetry(): Promise<void> {
    await expect(this.retryButton).toBeVisible()
    await this.retryButton.click()
  }

  /**
   * Wait for the fork operation to complete successfully
   */
  async waitForForkComplete(): Promise<void> {
    await expect(this.successMessage).toBeVisible({timeout: 60000})
  }

  /**
   * Wait for a fork error to appear
   */
  async waitForForkError(): Promise<void> {
    await expect(this.forkErrorMessage).toBeVisible({timeout: 30000})
  }

  /**
   * Check if fork operation is currently in progress
   */
  async isForking(): Promise<boolean> {
    const spinnerCount = await this.loadingSpinner.count()
    const buttonText = await this.forkButton.textContent()
    return spinnerCount > 0 || (buttonText?.toLowerCase().includes("forking") ?? false)
  }

  /**
   * Check if fork name validation error is shown
   */
  async hasForkNameError(): Promise<boolean> {
    return await this.forkNameError.isVisible()
  }

  /**
   * Get the fork name validation error message
   */
  async getForkNameErrorMessage(): Promise<string | null> {
    if (await this.forkNameError.isVisible()) {
      return await this.forkNameError.textContent()
    }
    return null
  }

  /**
   * Check if relay URL validation error is shown
   */
  async hasRelayUrlError(): Promise<boolean> {
    return await this.relayUrlError.isVisible()
  }

  /**
   * Get the relay URL validation error message
   */
  async getRelayUrlErrorMessage(): Promise<string | null> {
    if (await this.relayUrlError.isVisible()) {
      return await this.relayUrlError.textContent()
    }
    return null
  }

  /**
   * Get the fork error message
   */
  async getForkErrorMessage(): Promise<string | null> {
    if (await this.forkErrorMessage.isVisible()) {
      return await this.forkErrorMessage.textContent()
    }
    return null
  }

  /**
   * Check if the existing fork warning is shown
   */
  async hasExistingForkWarning(): Promise<boolean> {
    const warning = this.dialog.locator('[class*="yellow"]').filter({
      hasText: /fork|already exists/i,
    })
    return await warning.isVisible()
  }

  /**
   * Check if the "can't fork own repo" warning is shown
   */
  async hasForkOwnRepoWarning(): Promise<boolean> {
    const warning = this.dialog.locator('[class*="yellow"]').filter({
      hasText: /cannot fork your own|own repository/i,
    })
    return await warning.isVisible()
  }

  /**
   * Get all progress step messages
   */
  async getProgressMessages(): Promise<string[]> {
    const messages: string[] = []
    const count = await this.progressSteps.count()
    for (let i = 0; i < count; i++) {
      const text = await this.progressSteps.nth(i).textContent()
      if (text) {
        messages.push(text.trim())
      }
    }
    return messages
  }

  /**
   * Get the fork URL after successful completion
   */
  async getForkUrl(): Promise<string | null> {
    if (await this.forkUrlLink.isVisible()) {
      return await this.forkUrlLink.getAttribute("href")
    }
    return null
  }

  /**
   * Copy the fork URL to clipboard
   */
  async copyForkUrl(): Promise<void> {
    await expect(this.copyUrlButton).toBeVisible()
    await this.copyUrlButton.click()
  }

  /**
   * Copy the git clone command to clipboard
   */
  async copyCloneCommand(): Promise<void> {
    await expect(this.copyCloneButton).toBeVisible()
    await this.copyCloneButton.click()
  }

  /**
   * Toggle the details section visibility
   */
  async toggleDetails(): Promise<void> {
    if (await this.showDetailsButton.isVisible()) {
      await this.showDetailsButton.click()
    }
  }

  /**
   * Get the original repository info displayed in the dialog
   */
  async getOriginalRepoInfo(): Promise<{owner: string; name: string; description?: string}> {
    const infoText = await this.originalRepoInfo.textContent()
    // Parse "owner/name" format
    const match = infoText?.match(/([^/\s]+)\/([^\s]+)/)
    if (match) {
      return {
        owner: match[1],
        name: match[2],
        description: infoText?.replace(match[0], "").trim() || undefined,
      }
    }
    return {owner: "", name: infoText || ""}
  }

  /**
   * Get available git service options
   */
  async getAvailableGitServices(): Promise<string[]> {
    const options = await this.gitServiceSelect.locator("option").allTextContents()
    return options
  }

  /**
   * Check if GRASP is available as a git service option
   */
  async isGraspAvailable(): Promise<boolean> {
    const services = await this.getAvailableGitServices()
    return services.some((s) => s.toLowerCase().includes("grasp"))
  }

  /**
   * Check if the fork button is enabled
   */
  async isForkButtonEnabled(): Promise<boolean> {
    return await this.forkButton.isEnabled()
  }

  /**
   * Assert the dialog is accessible
   * Checks for proper ARIA attributes and focus management
   */
  async assertAccessible(): Promise<void> {
    // Dialog should have proper ARIA attributes
    await expect(this.dialog).toHaveAttribute("aria-modal", "true")
    await expect(this.dialog).toHaveAttribute("role", "dialog")
    await expect(this.dialog).toHaveAttribute("aria-labelledby", "fork-dialog-title")

    // Title should be visible and properly associated
    await expect(this.dialogTitle).toBeVisible()
    await expect(this.dialogTitle).toHaveAttribute("id", "fork-dialog-title")
  }
}
