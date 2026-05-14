<script lang="ts">
  import Dialog from "@lib/components/Dialog.svelte"
  import LogIn from "@app/components/LogIn.svelte"
</script>

<Dialog>
  <div class="grid max-w-md gap-6 p-2 text-center md:p-4" data-testid="login-screen">
    <div class="column items-center gap-3">
      <img alt="BudaBit" src="/pwa-512x512-dark.png" class="h-20 w-20 object-contain" />
      <div>
        <h1 class="text-5xl font-bold leading-tight">BudaBit</h1>
        <p class="mt-2 text-lg opacity-70">Developer Community Network</p>
      </div>
    </div>
    <div class="rounded-box bg-base-100 p-4 shadow-lg">
      <LogIn />
    </div>
  </div>
</Dialog>
