---
name: Drizzle post-merge prompts
description: Non-interactive schema application in the existing legacy database.
---

In this workspace, Drizzle schema push may encounter an interactive table-rename/conflict prompt in the existing development database. In a non-TTY post-merge process it prints an error but can exit with status zero. Do not trust the command's exit status alone as evidence that the schema was applied.

The same prompt can arise from harmless-looking drift: a populated legacy table omitted from the schema can be mistaken for a new table's rename, and a unique constraint named differently from the already-enforcing database constraint can make Drizzle ask whether it may truncate a populated table. Resolve such differences by describing the existing objects accurately in the schema, rather than agreeing to a destructive prompt or duplicating an existing uniqueness rule.

**Why:** A post-merge run appeared successful while new application queries failed against missing tables and columns. Another run offered to truncate tables even when their existing constraints already enforced the requested uniqueness. Forcing all schema diffs through without reviewing them could discard customer data.

**How to apply:** Check for tool errors in setup output, verify relevant schema changes independently, and compare actual table and constraint definitions with the schema before changing either. Preserve legacy tables and data; do not use a force flag just to make setup non-interactive. Future genuinely ambiguous diffs should still stop for review.