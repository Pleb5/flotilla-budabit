<script lang="ts">
  import Confirm from "@lib/components/Confirm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@src/app/util/toast"

  type Props = {
    repoClass: any
    repoName: string
  }

  const {repoClass, repoName}: Props = $props()

  const confirm = async () => {
    try {
      await repoClass.reset()

      pushToast({
        message: "Repository reset complete - local state now matches remote",
        timeout: 4000,
      })

      clearModals()
    } catch (error) {
      pushToast({
        message: `Reset failed: ${error}`,
        timeout: 6000,
        theme: "error",
      })

      clearModals()
    }
  }
</script>

<Confirm
  {confirm}
  title="Reset Repository"
  subtitle="This will permanently discard local changes"
  message="This action will reset the local repository '{repoName}' to match the remote HEAD state. Any local commits, uncommitted changes, or merge attempts will be permanently lost. This cannot be undone." />
