<script lang="ts">
  import { Loader2 } from "@lucide/svelte";
  import { tick } from "svelte";
  import type { NewRepoResult } from "../../hooks/useNewRepo.svelte";
  import {
    ACCESS_TOKEN_SETTINGS_PATH,
    getAccessTokenManagementMessage,
    isAccessTokenManagementIssue,
  } from "../../utils/tokenManagement";

  interface Props {
    isCreating: boolean;
    progress: {
      step: string;
      message: string;
      completed: boolean;
      error?: string;
    }[];
    onRetry?: () => void;
    onClose?: () => void;
    /** Set when repo was just created; enables "Navigate to repo" when onNavigateToRepo is provided */
    createdRepoResult?: NewRepoResult | null;
    onNavigateToRepo?: (result: NewRepoResult) => void | Promise<void>;
  }

  const {
    isCreating,
    progress,
    onRetry,
    onClose,
    createdRepoResult = null,
    onNavigateToRepo,
  }: Props = $props();

  const completedSteps = $derived(progress.filter((step) => step.completed).length);
  const totalSteps = $derived(progress.length);
  const progressPercentage = $derived(totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0);
  const hasErrors = $derived(progress.some((step) => step.error));
  const isComplete = $derived(completedSteps === totalSteps && !hasErrors);

  let isNavigatingToRepo = $state(false);

  async function waitForNavigationFeedbackPaint() {
    await tick();
    if (typeof requestAnimationFrame !== "function") return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function handleNavigateToRepo() {
    if (!createdRepoResult || !onNavigateToRepo || isNavigatingToRepo) return;

    isNavigatingToRepo = true;
    try {
      await waitForNavigationFeedbackPaint();
      await onNavigateToRepo(createdRepoResult);
    } catch (error) {
      console.error("Failed to navigate to created repository:", error);
    } finally {
      isNavigatingToRepo = false;
    }
  }
</script>

<div class="space-y-6">
  <div class="space-y-4">
    <h2 class="text-xl font-semibold text-gray-100">
      {#if isCreating}
        Creating Repository...
      {:else if isComplete}
        Repository Created Successfully!
      {:else if hasErrors}
        Repository Creation Failed
      {:else}
        Ready to Create Repository
      {/if}
    </h2>

    {#if isCreating}
      <p class="text-sm text-gray-300">Please wait while we set up your repository.</p>
    {:else if isComplete}
      <p class="text-sm text-green-700 dark:text-green-400">
        Your repository has been created and is ready to use.
      </p>
    {:else if hasErrors}
      <p class="text-sm text-red-700 dark:text-red-400">
        There was an error creating your repository. Please try again.
      </p>
    {/if}
  </div>

  <!-- Progress Bar -->
  {#if isCreating || progress.length > 0}
    <div class="space-y-2">
      <div class="flex justify-between text-sm">
        <span class="text-gray-400">Progress</span>
        <span class="text-gray-400">{completedSteps}/{totalSteps}</span>
      </div>
      <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          class="h-2 rounded-full transition-all duration-300 ease-in-out"
          class:bg-blue-600={isCreating && !hasErrors}
          class:bg-green-600={isComplete}
          class:bg-red-600={hasErrors}
          style="width: {progressPercentage}%"
        ></div>
      </div>
    </div>
  {/if}

  <!-- Progress Steps -->
  {#if progress.length > 0}
    <div class="space-y-3">
      {#each progress as step, index}
        <div class="flex items-start space-x-3">
          <!-- Step Icon -->
          <div class="flex-shrink-0 mt-0.5">
            {#if step.error}
              <div
                class="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center"
              >
                <svg class="w-3 h-3 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  ></path>
                </svg>
              </div>
            {:else if step.completed}
              <div
                class="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center"
              >
                <svg class="w-3 h-3 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clip-rule="evenodd"
                  ></path>
                </svg>
              </div>
            {:else}
              <div
                class="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center"
              >
                {#if isCreating}
                  <div class="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                {:else}
                  <div class="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Step Content -->
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-100">
              {step.step}
            </div>
            <div class="text-sm text-gray-400">
              {step.message}
            </div>
            {#if step.error}
              <div class="text-sm text-red-700 dark:text-red-400 mt-1">
                Error: {step.error}
              </div>
              {#if isAccessTokenManagementIssue(step.error)}
                <div class="text-xs text-red-700 dark:text-red-300 mt-2">
                  {getAccessTokenManagementMessage(step.error)}
                  <a
                    href={ACCESS_TOKEN_SETTINGS_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ml-2 inline-flex items-center text-red-700 hover:text-red-800 dark:text-red-200 dark:hover:text-red-100 underline"
                  >
                    Open token settings
                  </a>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Action Buttons -->
  {#if !isCreating}
    <div
      class="flex justify-end flex-wrap gap-3 pt-4 border-t border-gray-200 dark:border-gray-700"
    >
      {#if hasErrors && onRetry}
        <button
          onclick={onRetry}
          class="px-4 py-2 text-sm font-medium !text-white bg-blue-600 hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
        >
          Try Again
        </button>
      {/if}

      {#if isComplete && onNavigateToRepo && createdRepoResult}
        <button
          onclick={handleNavigateToRepo}
          disabled={isNavigatingToRepo}
          class="px-4 py-2 text-sm font-medium !text-white bg-green-600 hover:bg-green-700 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {#if isNavigatingToRepo}
            <Loader2 class="h-4 w-4 animate-spin" />
            <span>Opening repository...</span>
          {:else}
            <span>Go to repo</span>
          {/if}
        </button>
      {/if}

      {#if onClose}
        <button
          onclick={onClose}
          disabled={isNavigatingToRepo}
          class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isComplete ? "Done" : "Close"}
        </button>
      {/if}
    </div>
  {/if}
</div>
