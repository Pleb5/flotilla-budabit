import {z, RefinementCtx} from "zod"

// A Nostr tag is a tuple where the first element is the tag name and
// subsequent elements are string values. Example: ["e", "<event-id>"]
export const NostrTagSchema = z.tuple([z.string()]).rest(z.string())
export type NostrTagRuntime = z.infer<typeof NostrTagSchema>

// A minimal Nostr event-like shape that we can validate at runtime.
export const NostrEventSchema = z.object({
  id: z.string().optional(),
  kind: z.number().optional(),
  content: z.string().optional(),
  tags: z.array(NostrTagSchema),
  created_at: z.number().int().optional(),
  pubkey: z.string().optional(),
  sig: z.string().optional(),
})
export type NostrEventLike = z.infer<typeof NostrEventSchema>

// Narrow-only function: throws if tags are not valid Nostr tags.
export function assertValidTags(event: {
  tags: unknown
}): asserts event is {tags: NostrTagRuntime[]} {
  const res = z.array(NostrTagSchema).safeParse(event.tags)
  if (!res.success) {
    throw new Error(`Invalid event.tags: ${res.error.message}`)
  }
}

// Safe parse helper to validate tags and obtain parsed value or error.
export function safeParseEventTags(event: {tags: unknown}) {
  return z.array(NostrTagSchema).safeParse(event.tags)
}

// =============================
// NIP-34 specific tag schemas
// =============================

// Repository announcement tags (kind 30617)
export const DTag = z.tuple([z.literal("d"), z.string()])
export const NameTag = z.tuple([z.literal("name"), z.string()])
export const DescriptionTag = z.tuple([z.literal("description"), z.string()])
export const WebTag = z.tuple([z.literal("web"), z.string()]).rest(z.string())
export const CloneTag = z.tuple([z.literal("clone"), z.string()]).rest(z.string())
export const RelaysTag = z.tuple([z.literal("relays"), z.string()]).rest(z.string())
export const REarlyUniqueCommitTag = z.tuple([z.literal("r"), z.string(), z.literal("euc")])
export const MaintainersTag = z.tuple([z.literal("maintainers"), z.string()]).rest(z.string())
export const HashtagTag = z.tuple([z.literal("t"), z.string()])

export const RepoAnnouncementTagSchema = z.union([
  DTag,
  NameTag,
  DescriptionTag,
  WebTag,
  CloneTag,
  RelaysTag,
  REarlyUniqueCommitTag,
  MaintainersTag,
  HashtagTag,
  // Allow unknown/extra tags to pass validation without breaking
  NostrTagSchema,
])

export const RepoAnnouncementTagsSchema = z.array(RepoAnnouncementTagSchema)

// Repository state tags (kind 30618)
export const RefsTag = z.tuple([z.string().startsWith("refs/"), z.string()]).rest(z.string())
export const HeadRefTag = z.tuple([z.literal("HEAD"), z.string().startsWith("ref: refs/heads/")])
export const DeletedTag = z.tuple([z.literal("deleted")]).rest(z.string())
export const RepoStateTagSchema = z.union([DTag, RefsTag, HeadRefTag, DeletedTag])
export const RepoStateTagsSchema = z.array(RepoStateTagSchema)

export const AddressRepoTag = z.tuple([z.literal("a"), z.string()]).rest(z.string())
export const RTag = z.tuple([z.literal("r"), z.string()])
export const PTag = z.tuple([z.literal("p"), z.string()]).rest(z.string())
export const CTag = z.tuple([z.literal("c"), z.string()])
export const QReferenceTag = z.tuple([z.literal("q"), z.string()]).rest(z.string())
export const ImetaTag = z.tuple([z.literal("imeta")]).rest(z.string())

// Issue tags (kind 1621)
export const SubjectTag = z.tuple([z.literal("subject"), z.string()])
export const IssueTagSchema = z.union([
  AddressRepoTag,
  PTag,
  SubjectTag,
  HashtagTag,
  QReferenceTag,
  ImetaTag,
])
export const IssueTagsSchema = z.array(IssueTagSchema)

// Cover Letter tags (kind 1624)
export const CoverLetterETag = z.tuple([z.literal("e"), z.string()])
export const CoverLetterTagSchema = z.union([
  CoverLetterETag,
  AddressRepoTag,
  QReferenceTag,
  PTag,
  ImetaTag,
  HashtagTag,
])
export const CoverLetterTagsSchema = z.array(CoverLetterTagSchema)

// Status tags (kinds 1630..1633)
export const ETagRoot = z.tuple([z.literal("e"), z.string(), z.literal(""), z.literal("root")])
export const ETagReply = z.tuple([z.literal("e"), z.string(), z.literal(""), z.literal("reply")])
export const QTag = z.tuple([z.literal("q"), z.string(), z.string(), z.string()])
export const MergeCommitTag = z.tuple([z.literal("merge-commit"), z.string()])
export const AppliedAsCommitsTag = z
  .tuple([z.literal("applied-as-commits"), z.string()])
  .rest(z.string())
export const StatusRTag = z.tuple([z.literal("r"), z.string()])

export const StatusTagSchema = z.union([
  AddressRepoTag,
  StatusRTag,
  PTag,
  ETagRoot,
  ETagReply,
  QTag,
  MergeCommitTag,
  AppliedAsCommitsTag,
])
export const StatusTagsSchema = z.array(StatusTagSchema)

// Pull Request tags (kind 1618)
export const PullRequestTagSchema = z.union([
  AddressRepoTag,
  RTag,
  PTag,
  SubjectTag,
  HashtagTag,
  QReferenceTag,
  ImetaTag,
  CTag,
  CloneTag,
  z.tuple([z.literal("branch-name"), z.string()]),
  z.tuple([z.literal("merge-base"), z.string()]),
  z.tuple([z.literal("e"), z.string()]),
])
export const PullRequestTagsSchema = z.array(PullRequestTagSchema)

// Pull Request Update tags (kind 1619); NIP-22 E/P reference the PR
export const PullRequestUpdateETag = z.tuple([z.literal("E"), z.string()])
export const PullRequestUpdatePTag = z.tuple([z.literal("P"), z.string()])
export const PullRequestUpdateTagSchema = z.union([
  AddressRepoTag,
  RTag,
  PullRequestUpdateETag,
  PullRequestUpdatePTag,
  PTag,
  CTag,
  CloneTag,
  z.tuple([z.literal("merge-base"), z.string()]),
])
export const PullRequestUpdateTagsSchema = z.array(PullRequestUpdateTagSchema)

// User Grasp List tags (kind 10317)
export const UserGraspListTagSchema = z.tuple([z.literal("g"), z.string()])
export const UserGraspListTagsSchema = z.array(UserGraspListTagSchema)

// Stack (kind 30410)
export const StackATag = AddressRepoTag
export const StackIdTag = z.tuple([z.literal("stack"), z.string()])
export const StackMemberTag = z.tuple([z.literal("member"), z.string()])
export const StackOrderTag = z.tuple([z.literal("order"), z.string()]).rest(z.string())
export const StackTagSchema = z.union([StackATag, StackIdTag, StackMemberTag, StackOrderTag])
export const StackTagsSchema = z.array(StackTagSchema)

// Merge Metadata (kind 30411)
export const MergeMetaATag = AddressRepoTag
export const MergeMetaRootETag = ETagRoot
export const MergeBaseBranchTag = z.tuple([z.literal("base-branch"), z.string()])
export const MergeTargetBranchTag = z.tuple([z.literal("target-branch"), z.string()])
export const MergeResultTag = z.tuple([
  z.literal("result"),
  z.union([z.literal("clean"), z.literal("ff"), z.literal("conflict")]),
])
export const MergeMetaTagSchema = z.union([
  MergeMetaATag,
  MergeMetaRootETag,
  MergeBaseBranchTag,
  MergeTargetBranchTag,
  MergeResultTag,
  MergeCommitTag,
])
export const MergeMetaTagsSchema = z.array(MergeMetaTagSchema)

// Conflict Metadata (kind 30412)
export const ConflictMetaATag = AddressRepoTag
export const ConflictMetaRootETag = ETagRoot
export const ConflictFileTag = z.tuple([z.literal("file"), z.string()])
export const ConflictMetaTagSchema = z.union([
  ConflictMetaATag,
  ConflictMetaRootETag,
  ConflictFileTag,
])
export const ConflictMetaTagsSchema = z.array(ConflictMetaTagSchema)

// Convenience per-kind tag validators
export const validateRepoAnnouncementTags = (tags: unknown) =>
  RepoAnnouncementTagsSchema.safeParse(tags)
export const validateRepoStateTags = (tags: unknown) => RepoStateTagsSchema.safeParse(tags)
export const validateIssueTags = (tags: unknown) => IssueTagsSchema.safeParse(tags)
export const validateStatusTags = (tags: unknown) => StatusTagsSchema.safeParse(tags)

// =============================
// Stricter per-kind event schemas
// =============================

function hasTagName(tags: unknown[], name: string) {
  return Array.isArray(tags) && tags.some(t => Array.isArray(t) && t[0] === name)
}

function countTagName(tags: unknown[], name: string) {
  if (!Array.isArray(tags)) return 0
  return tags.filter(t => Array.isArray(t) && t[0] === name).length
}

export const RepoAnnouncementEventSchema = NostrEventSchema.extend({
  kind: z.literal(30617),
  tags: RepoAnnouncementTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "d")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repo announcement must include a 'd' tag (repo id)",
    })
  }
})

export const RepoStateEventSchema = NostrEventSchema.extend({
  kind: z.literal(30618),
  tags: RepoStateTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "d")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repo state must include a 'd' tag (repo id)",
    })
  }
})

export const IssueEventSchema = NostrEventSchema.extend({
  kind: z.literal(1621),
  tags: IssueTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "a")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Issue must include an 'a' tag (address of repo announcement)",
    })
  }
})

export const CoverLetterEventSchema = NostrEventSchema.extend({
  kind: z.literal(1624),
  tags: CoverLetterTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "e")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cover letter must include an 'e' tag (target root event)",
    })
  }
})

export const StatusEventSchema = NostrEventSchema.extend({
  kind: z.union([z.literal(1630), z.literal(1631), z.literal(1632), z.literal(1633)]),
  tags: StatusTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "e")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Status must include at least one 'e' tag (target event)",
    })
  }
  if (!hasTagName(evt.tags as unknown[], "p")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Status should include at least one 'p' tag (participants)",
    })
  }
})

// Pull Request event (kind 1618)
export const PullRequestEventSchema = NostrEventSchema.extend({
  kind: z.literal(1618),
  tags: PullRequestTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "a")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pull Request must include an 'a' tag (repo address)",
    })
  }
  if (countTagName(evt.tags as unknown[], "c") !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pull Request must include exactly one 'c' tag (tip commit)",
    })
  }
})

// Pull Request Update event (kind 1619)
export const PullRequestUpdateEventSchema = NostrEventSchema.extend({
  kind: z.literal(1619),
  tags: PullRequestUpdateTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "a")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pull Request update must include an 'a' tag (repo address)",
    })
  }
  if (!hasTagName(evt.tags as unknown[], "E")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pull Request update must include an 'E' tag (NIP-22: PR event id)",
    })
  }
  if (!hasTagName(evt.tags as unknown[], "P")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pull Request update must include a 'P' tag (NIP-22: PR author)",
    })
  }
  if (countTagName(evt.tags as unknown[], "c") !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pull Request update must include exactly one 'c' tag (tip commit)",
    })
  }
})

// User Grasp List event (kind 10317)
export const UserGraspListEventSchema = NostrEventSchema.extend({
  kind: z.literal(10317),
  tags: UserGraspListTagsSchema,
})

export const StackEventSchema = NostrEventSchema.extend({
  kind: z.literal(30410),
  tags: StackTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "a")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Stack must include an 'a' tag (repo address)",
    })
  }
  if (!hasTagName(evt.tags as unknown[], "stack")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Stack must include a 'stack' tag (stack id)",
    })
  }
})

export const MergeMetadataEventSchema = NostrEventSchema.extend({
  kind: z.literal(30411),
  tags: MergeMetaTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "a") || !hasTagName(evt.tags as unknown[], "e")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Merge metadata must include 'a' (repo) and 'e' (root) tags",
    })
  }
})

export const ConflictMetadataEventSchema = NostrEventSchema.extend({
  kind: z.literal(30412),
  tags: ConflictMetaTagsSchema,
}).superRefine((evt: NostrEventLike, ctx: RefinementCtx) => {
  if (!hasTagName(evt.tags as unknown[], "a") || !hasTagName(evt.tags as unknown[], "e")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Conflict metadata must include 'a' (repo) and 'e' (root) tags",
    })
  }
})

export const validateRepoAnnouncementEvent = (evt: unknown) =>
  RepoAnnouncementEventSchema.safeParse(evt)
export const validateRepoStateEvent = (evt: unknown) => RepoStateEventSchema.safeParse(evt)
export const validateIssueEvent = (evt: unknown) => IssueEventSchema.safeParse(evt)
export const validateCoverLetterEvent = (evt: unknown) => CoverLetterEventSchema.safeParse(evt)
export const validateStatusEvent = (evt: unknown) => StatusEventSchema.safeParse(evt)

// Convenience per-kind validators
export const validatePullRequestEvent = (evt: unknown) => PullRequestEventSchema.safeParse(evt)
export const validatePullRequestUpdateEvent = (evt: unknown) =>
  PullRequestUpdateEventSchema.safeParse(evt)
export const validateUserGraspListEvent = (evt: unknown) => UserGraspListEventSchema.safeParse(evt)
export const validateStackEvent = (evt: unknown) => StackEventSchema.safeParse(evt)
export const validateMergeMetadataEvent = (evt: unknown) => MergeMetadataEventSchema.safeParse(evt)
export const validateConflictMetadataEvent = (evt: unknown) =>
  ConflictMetadataEventSchema.safeParse(evt)
