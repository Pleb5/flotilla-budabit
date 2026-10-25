# Choosing a default section for new members

The community owner can choose the default section in **Admin → Community
settings → Content sections**. Existing communities initially have no default;
new communities start with General selected. The selected section still needs a
current application form, set up through **Moderation → Forms**. Guests sign in
before completing the application, review their public answers, and submit a
request. A request does not itself make someone a member.

The Home page shows membership/request status and a compact Join button for
nonmembers when an application is available. Section-specific publishing access
requests continue to use their own section.

## Budabit adoption (not performed by this change)

Exact definition: `32222:0a8ecba4868c13e1e84cc5cb58c02c1fd0880d9e5a25a5050ee96ad8a166d7c8:0a8ecba4868c13e1e84cc5cb58c02c1fd0880d9e5a25a5050ee96ad8a166d7c8`.

1. The actual definition owner opens current settings. A moderator/list owner
   cannot replace the community owner's definition.
2. Choose General; confirm its currently authorized application is available.
   Preserve the existing form and list references; this choice changes no grants.
3. Review and explicitly save the definition. The editor adds `["join"]` inside
   General and preserves other extension tags.
4. Check Home as an owner, member, pending applicant and guest. A pending request
   remains pending; no request should be submitted merely by opening Home.

This source change does not publish that definition, send a membership request,
deploy the website, or release an Android build. Adoption is a separate owner
action after review.
