---
inclusion: always
---

# 半亩 / Bothy — product steering

## What this is

半亩 (English name: **Bothy**) is a private knowledge portal. Capture a quote, a
link, a screenshot or a file; triage it; turn the keepers into drafts. It is not
a feed, a social profile or an audience-facing product.

**Josh** is the author/assistant persona. It is not the product name.

## Product rules

- **One private loop**: capture → inbox → triage → draft. Every new feature
  should make one of those steps better or leave it alone.
- **AI suggests, the user decides.** Never rewrite content behind the user's
  back. AI output is a proposal with an explicit apply/ignore path.
- **Source is part of the content.** A fragment that loses its URL/title/site
  is a product failure.
- **No fake engagement.** Do not add fake counts, fake activity, testimonials,
  online-user numbers or growth metrics. Real, verifiable data only.
- **Quiet interface.** The visual language is paper, forest, lime and ink.
  Prefer typographic hierarchy and motion over decoration.
- **The delete is part of the product.** Removing a fragment should feel
  deliberate: the card burns, the list gets lighter, the data is still soft-
  deleted where the schema says so.

## Language and naming

- UI copy is Chinese; the video and English-facing surfaces may be English.
- Use **半亩 / Bothy** for the product. Do not call the product "Josh" in UI
  copy; Josh is the person behind it.
- `docs.gaojiaxiang.cn` is the live portal. `media.gaojiaxiang.cn` serves media.

## Non-goals

- No public profiles, comments, followers, recommendations or activity feed.
- No third-party analytics or ad SDKs.
- No client-side framework rewrite just to add one interaction.
- No secret values in committed files.

## Definition of done

A change is done when the private loop still works end to end and the
verification gate in `steering/testing.md` passes. Screenshots or a manual
browser check are expected for visible UI changes.
