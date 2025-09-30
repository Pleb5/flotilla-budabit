import {makeSpacePath} from "./routes"

export const makeJobPath = (url: string, eventId?: string) => makeSpacePath(url, "jobs", eventId)

export const makeGitPath = (url: string, eventId?: string) => makeSpacePath(url, "git", eventId)

export const makeGitRepoPath = (url: string, eventId?: string) =>
  makeSpacePath(url, "git", "repos", eventId)

export const makeGitIssuePath = (url: string, eventId?: string) =>
  makeSpacePath(url, "git", "issues", eventId)

export const makeGitIssueCommentPath = (url: string, eventId?: string) =>
  makeSpacePath(url, "git", "issues", eventId, "comments")
