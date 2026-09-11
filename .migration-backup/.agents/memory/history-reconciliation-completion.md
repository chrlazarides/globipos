---
name: History reconciliation completion
description: Preserving required Git ancestry when task completion automatically rebases onto a maintained base
---

For work whose deliverable is a reconciled Git graph, make sure the maintained
completion base already contains the reconciliation before marking the task
complete.

**Why:** Automatic task completion rebases can flatten a two-parent merge,
leaving identical source content but dropping the external branch ancestry that
the reconciliation was meant to preserve.

**How to apply:** Verify the completion base, checked branch, and external
maintained branch all resolve to the reconciled graph. If the completion base
uses an unavailable transport, point that task-scoped base at the accessible
maintained remote before the final completion rebase.