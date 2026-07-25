import {defineConfig, minimalPreset as preset} from "@vite-pwa/assets-generator/config"

export default defineConfig({
  preset,
  // The source must be a local build input. VITE_APP_LOGO is public runtime
  // metadata and may legitimately be an absolute URL.
  images: ["static/budabit.png"],
})
