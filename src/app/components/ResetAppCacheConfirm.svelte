<script lang="ts">
  import Confirm from "@lib/components/Confirm.svelte"
  import {resetAppCache} from "@app/util/cache-reset"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"

  const confirm = async () => {
    try {
      await resetAppCache()
      clearModals()
      window.location.reload()
    } catch (error) {
      pushToast({
        theme: "error",
        timeout: 6000,
        message: `Reset failed: ${String(error)}`,
      })
      clearModals()
    }
  }
</script>

<Confirm
  {confirm}
  title="Reset app cache"
  subtitle="Clears cached app files and service workers"
  message="This will clear cached app assets and reload the app. Your account will stay signed in." />
