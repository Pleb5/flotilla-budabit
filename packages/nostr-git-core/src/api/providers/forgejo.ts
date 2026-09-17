import {GiteaApi} from "./gitea.js"

/** Forgejo's compatible v1 API, with a separate identity for future capabilities. */
export class ForgejoApi extends GiteaApi {
  constructor(token: string, baseUrl?: string) {
    super(token, baseUrl, "Forgejo")
  }
}
