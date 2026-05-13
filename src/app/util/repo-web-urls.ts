export type RepoWebUrlSource = {
  web?: readonly string[] | null
}

export const getDisplayedRepoWebUrls = (repo: RepoWebUrlSource | null | undefined): string[] =>
  Array.isArray(repo?.web) ? [...repo.web] : []
