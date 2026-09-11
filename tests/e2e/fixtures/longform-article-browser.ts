/// <reference types="vite/client" />
/// <reference types="@sveltejs/kit" />
import {mount, unmount} from "svelte"
import {repository} from "@welshman/app"
import {defaultSettings} from "@app/core/state"
import Content from "@app/components/Content.svelte"
import ContentMinimal from "@app/components/ContentMinimal.svelte"
import ArticleCard from "@app/components/ArticleCard.svelte"
import {article, articleProfile, articleRelay} from "./longform-article"

export const cacheArticleFixture = () => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  // Local read cache only. No signed-in account and no relay publication.
  repository.publish(articleProfile)
  repository.publish(article)
}

export const mountArticleFixture = (mode: "content" | "minimal" | "card", showMedia = true) => {
  cacheArticleFixture()
  const previousMedia = defaultSettings.show_media
  defaultSettings.show_media = showMedia
  const target = document.createElement("section")
  target.dataset.longformFixture = mode
  target.className = "mx-auto max-w-3xl p-4"
  document.querySelector('[data-component="PageContent"]')!.appendChild(target)
  const component =
    mode === "content"
      ? mount(Content, {target, props: {event: article, url: articleRelay, showEntire: true}})
      : mode === "minimal"
        ? mount(ContentMinimal, {target, props: {event: article, url: articleRelay}})
        : mount(ArticleCard, {target, props: {event: article, relays: [articleRelay]}})
  return async () => {
    await unmount(component)
    target.remove()
    defaultSettings.show_media = previousMedia
  }
}
