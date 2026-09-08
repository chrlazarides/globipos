---
name: Cashier-safe web register
description: Authorization and transaction-integrity boundaries for the browser Quick Sale register.
---

A staff-visible web register must use narrow cashier endpoints rather than broad admin management APIs. Layouts come from the selected terminal assignment, while sale prices, VAT, totals, cashier identity, and card charge amount remain server-authoritative.

**Why:** Making admin order routes staff-accessible permits forged totals and unrestricted voids. Trusting a displayed browser total during card charging can complete a full order after charging a different amount.

**How to apply:** Return only register-safe location, terminal, layout, and bounded stock data. Create sales from item/variant IDs and quantities, reject changed checkout prices, charge the stored held-order total, and condition cancellation on ownership and no active charge claim.