import "@poppanator/sveltekit-svg/dist/svg"
import "vite-plugin-pwa/pwa-assets"

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    interface PageState {
      modal?: string
    }
    // interface Platform {}
  }

  interface ImportMetaEnv {
    readonly DEV: boolean
    readonly PROD: boolean
    readonly SSR: boolean
    // Additional Vite env vars can be declared here as needed
    readonly [key: string]: any
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

export {}
