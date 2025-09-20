<style>
  div {
    mask-repeat: none;
    mask-size: 100% 100%;
  }
</style>

<script lang="ts">
  // Dynamically load icons by kebab-case name from src/assets/icons/*.svg
  // This avoids brittle hardcoded imports and matches the files present in this repo.

  const {
    icon,
    size = 5,
    ...restProps
  }: {
    icon: string
    size?: number
    class?: string
  } = $props()

  const px = size * 4

  // Eagerly import all SVGs in icons directory as asset URLs
  const modules = import.meta.glob("../../assets/icons/*.svg", {
    eager: true,
    as: "url",
  }) as Record<string, string>

  // Build a case-insensitive lookup by basename (without .svg)
  const byName: Record<string, string> = {}
  for (const [p, url] of Object.entries(modules)) {
    const base = p.split("/").pop() || ""
    const name = base.toLowerCase().replace(/\.svg$/, "")
    byName[name] = url
  }

  const key = typeof icon === "string" ? icon.toLowerCase() : ""
  const data: string | undefined =
    typeof icon === "string" && icon.startsWith("data:") ? icon : byName[key]

  if (!data) {
    throw new Error(`Invalid icon: ${icon}`)
  }
</script>

<div
  class="inline-block {restProps.class}"
  style="mask-image: url({data}); width: {px}px; height: {px}px; min-width: {px}px; min-height: {px}px; background-color: currentcolor;">
</div>
