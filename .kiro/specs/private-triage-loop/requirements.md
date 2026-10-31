# Private triage loop — requirements

## Goal

Close the loop between a captured fragment and something the user can actually
use, without leaving the private portal or losing the source.

## Users

A single owner of a private portal. There is no public profile and no second
role in this feature.

## Requirements

### R1. Turn a fragment into a draft

- **R1.1** WHEN the owner chooses “turn into draft” for an inbox fragment, THE
  SYSTEM SHALL create a draft owned by that owner, carrying the fragment text,
  source metadata and tags.
- **R1.2** The draft slug SHALL be deterministic (`<base>-<fragment-id-prefix>`)
  so repeated requests do not create duplicate slugs.
- **R1.3** IF an active draft already exists for that fragment, THE SYSTEM SHALL
  return the existing draft instead of creating a second one.
- **R1.4** IF a soft-deleted draft owns the slug, THE SYSTEM SHALL revive that
  draft and update its content, rather than failing on the unique slug index.
- **R1.5** The draft SHALL contain a citation token `fragment-<id8>` that
  resolves back to the source fragment.
- **R1.6** After a successful draft creation, the source fragment SHALL be
  archived and disappear from the inbox list.

### R2. Merge a duplicate

- **R2.1** WHEN the owner merges duplicate B into target A, THE SYSTEM SHALL
  keep A, append B’s note and tags, and soft-delete B.
- **R2.2** The merge SHALL record the merged source IDs in
  `metadata.mergedFrom`, capped at the most recent 20.
- **R2.3** A merge SHALL be owner-scoped; a fragment from another owner SHALL
  be treated as not found.
- **R2.4** A merge SHALL be a single transaction: either both the target update
  and the duplicate soft-delete commit, or neither does.

### R3. Bulk archive

- **R3.1** WHEN the owner selects up to 100 inbox fragments and archives them,
  THE SYSTEM SHALL update only those fragments owned by the owner.
- **R3.2** The endpoint SHALL reject an empty selection, more than 100 IDs, or
  an invalid status.
- **R3.3** The update SHALL be transactional and SHALL report the number of
  fragments actually changed.
- **R3.4** The UI SHALL update the selected count, remove archived rows, and
  decrement the visible inbox total without a full page reload.

### R4. Feedback and safety

- **R4.1** Buttons SHALL be disabled while a request is in flight.
- **R4.2** A failed request SHALL leave the card in place and show a retryable
  message.
- **R4.3** The delete/burn animation SHALL NOT remove the card until the server
  has confirmed the delete.
- **R4.4** The feature SHALL respect `prefers-reduced-motion`; with reduced
  motion the card disappears with a short opacity change instead of the burn.

### R5. Verification

- **R5.1** Tests SHALL cover draft reuse, soft-deleted draft revival, merge
  behaviour and bulk status changes.
- **R5.2** `pnpm check` and `pnpm build` SHALL pass.
