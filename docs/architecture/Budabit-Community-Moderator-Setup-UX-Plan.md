# Budabit Community Moderator Setup UX Plan

This plan replaces the current protocol-shaped moderation form editor with a moderator-facing setup flow for accepting and reviewing section applications.

The first priority is setup UX: a moderator should quickly understand whether users can apply, create or edit one active form per grantable section, preview the applicant experience, and publish without knowing Nostr form internals.

## Goals

- Make `/c/[community]/moderation` review-first by default.
- Surface setup health before the review queue.
- Highlight grantable sections that do not have an application form.
- Provide an `Edit forms` setup flow for section application forms.
- Never ask moderators to type or understand a `d` tag.
- Never ask moderators to construct raw field syntax.
- Let any eligible moderator edit the latest active form for a section by copying its values and publishing a newer valid form.
- Support multi-question application forms with preview before publishing.

## Non-Goals

- Redesign applicant-side submission UX in this pass.
- Add encrypted or anonymous applications.
- Add advanced NIP-101 field types beyond the first setup set.
- Add custom free-text handling for `Other` options in this pass.
- Add DM/NIP-44 notifications.

## Default Moderation Page

The moderation page opens in queue mode.

At the top, show an application setup card:

- If all grantable sections have forms, show a neutral/success state: `All grantable sections are accepting applications.`
- If one or more grantable sections are missing forms, show a warning state: `Users cannot apply to: General, Repositories.`
- Put the `Edit forms` button inside this setup card.
- The warning should visually surround the setup CTA so the moderator understands the fix is to edit forms.

Below the setup card, show the review queue:

- New applications first.
- Granted and rejected applications after new applications.
- If setup is incomplete and the queue is empty, explain that missing forms prevent users from applying.
- If setup is complete and the queue is empty, say there are no applications yet.

## Edit Forms Flow

Clicking `Edit forms` switches the page to form setup mode.

Setup mode has two primary regions:

- Section list.
- Form builder and preview for the selected section.

### Section List

List every section the current signer can grant.

Each section item shows:

- Section name.
- Setup status: `Ready`, `Missing form`, or `Draft changes`.
- Active form name when a form exists.
- A clear selected state.

Missing-form sections use warning styling. The selected section must be obvious on the list item, not only inferred from the editor.

### Active Form Rule

Budabit has one active application form per content section.

The active form is the latest valid `kind:30168` form from an eligible moderator for that section, using the deterministic latest-form ordering already defined by community admission helpers.

When a moderator edits a section:

- If a latest active form exists, load its name, description, and questions into the draft.
- If no form exists, create a draft with generated defaults.
- Publishing always emits a new valid `kind:30168` form authored by the current signer.
- The newly published form becomes the active form for all moderators and users when it wins latest-form selection.

### Identifier Rule

The moderator never sees or edits the `d` tag.

Identifier behavior:

- If the current moderator already has a form for that section, preserve that moderator-owned identifier so publishing replaces their addressable form.
- If the latest active form was authored by another moderator, copy its content but publish with the current moderator's generated identifier.
- If no current-moderator form exists, generate a stable identifier from community and section, for example `community-<community-prefix>-<section-slug>-application`.

## Form Builder

Each selected section gets a structured draft.

Draft fields:

- `sectionName`
- `identifier`
- `name`
- `description`
- `questions`
- `dirty`

Default values:

- Name: `<sectionName> application`
- Description: `Request access to publish in the <sectionName> section.`
- First question: `Describe your application to publish in <sectionName>`

Generated defaults count as valid. Moderators can publish without changing them.

### Question Cards

Question cards are inspired by `nostr-forms` but fit Budabit's Svelte UI.

Each card supports:

- Editable question text.
- Question type selector.
- Required toggle.
- Delete button.
- Move up/down buttons.
- Disabled answer preview.

Supported question types for this pass:

- Short answer: one-line disabled input preview.
- Paragraph: disabled textarea preview.
- Single choice: radio options, `Add option`, and `add other`.
- Multiple choice: checkbox options, `Add option`, and `add other`.

`add other` simply adds an `Other` option for now. Applicant-side custom free-text handling is deferred to the applicant UX pass.

## Preview Before Publish

The form setup flow includes a preview mode before publish.

On desktop, preview may appear beside the builder. On mobile, use `Build` and `Preview` toggles.

Preview shows:

- Form name.
- Form description.
- Selected section.
- All questions in order.
- Disabled applicant-style answer controls.

Publishing is disabled until validation passes:

- Name is present.
- Description is present.
- At least one question exists.
- Every question has text.
- Single-choice and multiple-choice questions have at least two non-empty options.

## NIP-101 Encoding

The builder converts structured drafts into existing Budabit admission form templates.

Mapping:

- Short answer -> `field` type `text`, settings `{renderElement: "shortText", required: true}`.
- Paragraph -> `field` type `text`, settings `{renderElement: "paragraph", required: true}`.
- Single choice -> `field` type `option`, settings `{renderElement: "singleChoice", required: true}`.
- Multiple choice -> `field` type `option`, settings `{renderElement: "multipleChoice", required: true}`.

Choice options remain normal NIP-101 option values. `Other` is encoded as a normal option with settings `{isOther: true}`.

Required template tags remain:

- `d`
- `a = 10222:<community-pubkey>:`
- `content = <sectionName>`
- `name`
- `settings` with description
- `relay` tags
- `field` tags

Forms publish only to active community relays.

## Implementation Phases

### Phase 1: Draft Model And Helpers

- Add structured draft types and helpers near community form helpers.
- Generate stable identifiers.
- Convert active forms into editable drafts.
- Convert drafts into `CommunityFormFieldInput[]`.
- Validate drafts.
- Add focused tests.

### Phase 2: Moderation Page Layout

- Add queue/setup mode state.
- Add setup status card above queue.
- Add missing-form warning summary.
- Keep review queue as the default view.
- Improve empty states based on setup health.

### Phase 3: Section Form Setup UI

- Add grantable section list with selected and missing states.
- Load latest active section form into a draft.
- Generate default drafts when missing.
- Publish drafts as moderator-authored forms.

### Phase 4: Question Builder And Preview

- Replace raw textarea field construction.
- Add structured question cards.
- Add type selector and option editors.
- Add build/preview toggle.
- Disable publish until validation passes.

### Phase 5: Verification

- Run focused community form tests.
- Run `npm run check`.
- Run `npm run test:main`.
- Run `npm run build`.

## Success Criteria

- A moderator can see immediately which grantable sections are not accepting applications.
- A moderator can create a valid application form without knowing NIP-101 syntax.
- A moderator can edit the latest active form for a section, even if another eligible moderator authored it.
- The selected section and missing-form states are obvious.
- A moderator can build multiple questions and preview the form before publishing.
- Published forms remain compatible with the existing applicant and review lifecycle.
