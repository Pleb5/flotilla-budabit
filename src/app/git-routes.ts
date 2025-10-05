import {makeSpacePath} from "@app/routes"

export const makeJobPath = (url: string, eventId?: string) => makeSpacePath(url, "jobs", eventId)

export const makeGitPath = (url: string, eventId?: string) => makeSpacePath(url, "git", eventId)

export const makeGitRepoPath = (url: string, eventId?: string) =>
  makeSpacePath(url, "git", eventId, "repos")

export const makeGitIssuePath = (url: string, eventId?: string) =>
  makeSpacePath(url, "git", eventId, "issues")

export const makeGitIssueCommentPath = (url: string, eventId?: string) =>
  makeSpacePath(url, "git", eventId, "issues", "comments")
