import {expect, type Locator, type Page} from "@playwright/test"

/**
 * Page object for the Clone Repository Dialog
 *
 * This dialog is used to clone git repositories from remote URLs.
 * Based on the CloneRepoDialog.svelte component, it provides:
 * - URL input for the repository to clone
 * - Destination path input
 * - Clone depth selector (shallow/full)
 * - Progress indicators during clone
 * - Error display and retry functionality
 */
export class CloneDialogPage {
  readonly page: Page

  // Dialog container
  readonly dialogContainer: Locator
  readonly dialogTitle: Locator

  // Form inputs
  readonly urlInput: Locator
  readonly destinationInput: Locator
  readonly cloneDepthSelect: Locator

  // Buttons
  readonly cloneButton: Locator
  readonly cancelButton: Locator
  readonly closeButton: Locator
  readonly retryButton: Locator

  // Progress elements
  readonly progressBar: Locator
  readonly progressStage: Locator
  readonly progressPercentage: Locator

  // Error elements
  readonly validationError: Locator
  readonly cloneError: Locator

  constructor(page: Page) {
    this.page = page

    // Dialog container (modal)
    this.dialogContainer = page.locator(".fixed.inset-0").filter({hasText: "Clone Repository"})
    this.dialogTitle = page.locator("h2").filter({hasText: "Clone Repository"})

    // Form inputs - based on CloneRepoDialog.svelte
    this.urlInput = page.locator('input#repo-url').or(
      page.locator('input[type="url"]')
    ).first()
    this.destinationInput = page.locator('input#destination').or(
      page.locator('input[placeholder*="my-repo"]')
    ).first()
    this.cloneDepthSelect = page.locator('select#clone-depth')

    // Action buttons
    this.cloneButton = page.locator("button").filter({hasText: "Clone Repository"})
    this.cancelButton = page.locator("button").filter({hasText: "Cancel"})
    this.closeButton = page.locator('[aria-label="Close dialog"]')
    this.retryButton = page.locator("button").filter({hasText: "Retry Clone"})

    // Progress indicators
    this.progressBar = page.locator(".h-2.rounded-full")
    this.progressStage = page.locator(".text-sm.font-medium.text-gray-100")
    this.progressPercentage = page.locator("text=% complete")

    // Error elements
    this.validationError = page.locator(".bg-red-900\\/20.border-red-500 p.text-red-400")
    this.cloneError = page.locator(".bg-red-900\\/20").filter({hasText: "Error:"})
  }

  /**
   * Check if the clone dialog is open
   */
  async isOpen(): Promise<boolean> {
    return await this.dialogTitle.isVisible()
  }

  /**
   * Wait for the dialog to be open
   */
  async waitForOpen(): Promise<void> {
    await expect(this.dialogTitle).toBeVisible()
  }

  /**
   * Wait for the dialog to be closed
   */
  async waitForClose(): Promise<void> {
    await expect(this.dialogTitle).not.toBeVisible()
  }

  /**
   * Fill in the repository URL
   */
  async fillUrl(url: string): Promise<void> {
    await expect(this.urlInput).toBeVisible()
    await this.urlInput.fill(url)
    // Wait for any effects (e.g., auto-generating destination path)
    await this.page.waitForTimeout(300)
  }

  /**
   * Fill in the destination path
   */
  async fillDestination(path: string): Promise<void> {
    await expect(this.destinationInput).toBeVisible()
    await this.destinationInput.fill(path)
  }

  /**
   * Get the current destination path value
   */
  async getDestination(): Promise<string> {
    await expect(this.destinationInput).toBeVisible()
    return await this.destinationInput.inputValue()
  }

  /**
   * Select clone depth
   * @param depth - "shallow" for 1 commit, "full" for complete history
   */
  async selectCloneDepth(depth: "shallow" | "full"): Promise<void> {
    await expect(this.cloneDepthSelect).toBeVisible()
    await this.cloneDepthSelect.selectOption(depth)
  }

  /**
   * Get the current clone depth selection
   */
  async getCloneDepth(): Promise<string> {
    await expect(this.cloneDepthSelect).toBeVisible()
    return await this.cloneDepthSelect.inputValue()
  }

  /**
   * Click the Clone Repository button
   */
  async clickClone(): Promise<void> {
    await expect(this.cloneButton).toBeVisible()
    await expect(this.cloneButton).toBeEnabled()
    await this.cloneButton.click()
  }

  /**
   * Click the Cancel button
   */
  async clickCancel(): Promise<void> {
    await expect(this.cancelButton).toBeVisible()
    await this.cancelButton.click()
  }

  /**
   * Click the X close button
   */
  async clickClose(): Promise<void> {
    await expect(this.closeButton).toBeVisible()
    await this.closeButton.click()
  }

  /**
   * Click the Retry Clone button (visible after error)
   */
  async clickRetry(): Promise<void> {
    await expect(this.retryButton).toBeVisible()
    await this.retryButton.click()
  }

  /**
   * Check if Clone button is enabled
   */
  async isCloneButtonEnabled(): Promise<boolean> {
    return await this.cloneButton.isEnabled()
  }

  /**
   * Check if a validation error is displayed
   */
  async hasValidationError(): Promise<boolean> {
    return await this.validationError.isVisible().catch(() => false)
  }

  /**
   * Get the validation error message
   */
  async getValidationError(): Promise<string | null> {
    if (await this.hasValidationError()) {
      return await this.validationError.textContent()
    }
    return null
  }

  /**
   * Check if a clone error is displayed
   */
  async hasCloneError(): Promise<boolean> {
    return await this.cloneError.isVisible().catch(() => false)
  }

  /**
   * Get the clone error message
   */
  async getCloneError(): Promise<string | null> {
    if (await this.hasCloneError()) {
      return await this.cloneError.textContent()
    }
    return null
  }

  /**
   * Check if the progress bar is visible (cloning in progress)
   */
  async isCloning(): Promise<boolean> {
    return await this.progressBar.isVisible()
  }

  /**
   * Get the current progress stage text
   */
  async getProgressStage(): Promise<string | null> {
    if (await this.isCloning()) {
      return await this.progressStage.textContent()
    }
    return null
  }

  /**
   * Get the current progress percentage
   */
  async getProgressPercentage(): Promise<number | null> {
    const percentText = await this.progressPercentage.textContent().catch(() => null)
    if (percentText) {
      const match = percentText.match(/(\d+)%/)
      return match ? parseInt(match[1], 10) : null
    }
    return null
  }

  /**
   * Check if clone was successful (green progress bar, success message)
   */
  async isCloneSuccessful(): Promise<boolean> {
    const greenBar = this.page.locator('[class*="bg-green-600"]')
    const successMessage = this.page.locator("text=completed successfully")
    return await greenBar.isVisible() || await successMessage.isVisible()
  }

  /**
   * Wait for clone to complete (either success or error)
   * @param timeout - Maximum time to wait in milliseconds
   */
  async waitForCloneComplete(timeout: number = 30000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const greenBar = document.querySelector('[class*="bg-green-600"]')
        const errorContainer = document.querySelector('[class*="bg-red-900"]')
        const successText = document.body.textContent?.includes("completed successfully")
        return greenBar || errorContainer || successText
      },
      {timeout}
    )
  }

  /**
   * Fill the clone form with complete details
   */
  async fillCloneForm(options: {
    url: string
    destination?: string
    depth?: "shallow" | "full"
  }): Promise<void> {
    await this.fillUrl(options.url)

    if (options.destination) {
      await this.fillDestination(options.destination)
    }

    if (options.depth) {
      await this.selectCloneDepth(options.depth)
    }
  }

  /**
   * Perform a complete clone operation
   * Fills the form and clicks clone
   */
  async performClone(options: {
    url: string
    destination?: string
    depth?: "shallow" | "full"
  }): Promise<void> {
    await this.fillCloneForm(options)
    await this.clickClone()
  }

  /**
   * Assert that the dialog is in the form state (not cloning)
   */
  async assertFormState(): Promise<void> {
    await expect(this.urlInput).toBeVisible()
    await expect(this.destinationInput).toBeVisible()
    await expect(this.cloneDepthSelect).toBeVisible()
    await expect(this.cloneButton).toBeVisible()
    await expect(this.cancelButton).toBeVisible()
  }

  /**
   * Assert that the dialog is in the progress state (cloning)
   */
  async assertProgressState(): Promise<void> {
    await expect(this.progressBar).toBeVisible()
    await expect(this.progressStage).toBeVisible()
    // Form should not be visible during progress
    await expect(this.urlInput).not.toBeVisible()
  }

  /**
   * Assert that the dialog shows an error state
   */
  async assertErrorState(): Promise<void> {
    // Error container should be visible
    await expect(this.cloneError).toBeVisible()
    // Retry button should be available
    await expect(this.retryButton).toBeVisible()
  }

  /**
   * Validate a repository URL using the same logic as the component
   * Useful for testing validation in isolation
   */
  static validateUrl(url: string): {isValid: boolean; error?: string} {
    if (!url.trim()) {
      return {isValid: false, error: "Repository URL is required"}
    }

    try {
      const parsedUrl = new URL(url)

      // Check for supported protocols
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return {isValid: false, error: "Only HTTP and HTTPS URLs are supported"}
      }

      // Check for common Git hosting patterns
      const hostname = parsedUrl.hostname.toLowerCase()
      const supportedHosts = ["github.com", "gitlab.com", "bitbucket.org"]
      const isKnownHost = supportedHosts.some(
        (host) => hostname === host || hostname.endsWith("." + host)
      )

      if (!isKnownHost && !parsedUrl.pathname.endsWith(".git")) {
        return {
          isValid: false,
          error: "URL should end with .git or be from a known Git hosting service",
        }
      }

      return {isValid: true}
    } catch {
      return {isValid: false, error: "Invalid URL format"}
    }
  }

  /**
   * Validate a destination path using the same logic as the component
   */
  static validateDestination(path: string): {isValid: boolean; error?: string} {
    if (!path.trim()) {
      return {isValid: false, error: "Destination path is required"}
    }

    const invalidChars = /[<>:"|?*]/
    if (invalidChars.test(path)) {
      return {isValid: false, error: "Destination path contains invalid characters"}
    }

    return {isValid: true}
  }
}
