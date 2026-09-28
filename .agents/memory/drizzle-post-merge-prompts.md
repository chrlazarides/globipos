---
name: Drizzle post-merge prompts
description: Non-interactive schema application in the existing legacy database.
---

In this workspace, Drizzle schema push may encounter an interactive table-rename/conflict prompt in the existing development database. In a non-TTY post-merge process it prints an error but can exit with status zero. Do not trust the command's exit status alone as evidence that the schema was applied.

**Why:** A post-merge run appeared successful while new application queries failed against missing tables and columns. Forcing all schema diffs through without reviewing them could discard existing customer data.

**How to apply:** Check for tool errors in setup output, verify relevant schema changes independently, and resolve ambiguous schema diffs before automating further migrations. Do not use a force flag just to make setup non-interactive.