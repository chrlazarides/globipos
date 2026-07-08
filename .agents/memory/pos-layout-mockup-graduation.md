---
name: POS canvas mockup vs real Layouts system mismatch
description: pos_layout_sets/pos_layout_buttons is a button-grid config, not a journal+numpad UI — graduating a fancy POS mockup needs a translation step
---

The real "Layouts" feature (`pos_layout_sets` + `pos_layout_buttons`) only models a
grid of buttons (items, categories, actions) with columns/rows/colorTheme/shape.
It has no concept of a scrollable journal panel, numpad, or per-line tap-to-correct
UI — that richer UX lives in the POS Simulator/POS app screens themselves, not in
the layout config.

**Why:** A polished canvas mockup (e.g. a redesigned journal/cart panel) cannot be
1:1 "graduated" into a `pos_layout_sets` row — there's no schema field for it.

**How to apply:** When a user approves a mockup with journal/cart UX changes and
asks to "save it as a layout", split the work in two: (1) create/update the real
`pos_layout_sets` row with an appropriate button grid (items + relevant action
buttons like PRICE_OVERRIDE/QTY/DISCOUNT_PCT/VOID_LINE so corrections are actually
reachable), and (2) separately port the journal/cart visual+interaction changes
directly into the POS Simulator page component (e.g. `pos-simulate.tsx`), since
that's where the journal panel actually lives at runtime. Tell the user both were
done, since neither alone fully represents "the layout."
