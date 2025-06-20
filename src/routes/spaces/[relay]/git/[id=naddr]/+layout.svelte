<script lang="ts">
  import {FunctionProvider, RepoHeader, RepoTab, toast} from "@nostr-git/ui"
  import {ConfigProvider} from "@nostr-git/ui"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, PencilRuler, GitCommit} from "@lucide/svelte"
  import {page} from "$app/stores"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import Avatar from "@lib/components/Avatar.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import Input from "@lib/components/Field.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {setContext} from "svelte"
  import {pushToast} from "@src/app/toast"

  const {id, relay} = $page.params
  let {data, children} = $props()
  const {repoClass, functionRegistry} = data

  let activeTab: string | undefined = $page.url.pathname.split("/").pop()
  const encodedRelay = encodeURIComponent(relay)

  // Connect the nostr-git toast store to the toast component
  $effect(() => {
    if ($toast.length > 0) {
      $toast.forEach(t => {
        pushToast({
          message: t.description!,
          theme: t.variant === "error" ? "error" : undefined,
        })
      })
      toast.clear()
    }
  })

  setContext("functions", functionRegistry)
  setContext("repoClass", repoClass)

</script>

<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if repoClass === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !repoClass}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader event={repoClass.repoEvent} {activeTab} isRepoWatched={false}>
      {#snippet children(activeTab: string)}
        <RepoTab
          tabValue={id}
          label="Overview"
          href={`/spaces/${encodedRelay}/git/${id}`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="code"
          label="Code"
          href={`/spaces/${encodedRelay}/git/${id}/code`}
          {activeTab}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="issues"
          label="Issues"
          href={`/spaces/${encodedRelay}/git/${id}/issues`}
          {activeTab}>
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="patches"
          label="Patches"
          href={`/spaces/${encodedRelay}/git/${id}/patches`}
          {activeTab}>
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="commits"
          label="Commits"
          href={`/spaces/${encodedRelay}/git/${id}/commits`}
          {activeTab}>
          {#snippet icon()}
            <GitCommit class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="workbench"
          label="Workbench"
          href={`/spaces/${encodedRelay}/git/${id}/workbench`}
          {activeTab}>
          {#snippet icon()}
            <PencilRuler class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    <FunctionProvider functions={functionRegistry}>
      <ConfigProvider
        components={{
          AvatarImage: Avatar as typeof import("@nostr-git/ui").AvatarImage,
          Separator: Divider as typeof import("@nostr-git/ui").Separator,
          Input: Input as typeof import("@nostr-git/ui").Input,
          Alert: Dialog as typeof import("@nostr-git/ui").Alert,
        }}>
        {@render children()}
      </ConfigProvider>
    </FunctionProvider>
  {/if}
</PageContent>
