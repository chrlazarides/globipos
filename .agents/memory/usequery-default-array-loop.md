---
name: useQuery default array/object literal render loop
description: A `useQuery` destructuring default like `= []` or `= {}` can trigger a "Maximum update depth exceeded" render loop when consumed by a useEffect dependency array.
---

## The problem

```ts
const { data: savedButtons = [] } = useQuery<Item[]>({ ... });

useEffect(() => {
  if (!otherLoadedThing) return;
  // ...
}, [savedButtons, otherLoadedThing]);
```

While `data` is `undefined` (query still loading/refetching), the `= []` default creates a **brand new array reference on every render**. If some other piece of state in the same component updates before this query resolves (or if the component re-renders for any other reason), the effect sees a "changed" dependency each time, re-fires, calls setState, triggers another render, sees another new `[]`, and loops — tripping React's "Maximum update depth exceeded" warning.

**Why it matters:** React doesn't necessarily crash outright; it can bail out mid-loop and leave the component in a state where child UI (e.g. a dialog's tab content, a picker list) never finishes rendering. A user-reported symptom like "some components/buttons just don't show up" can actually be this render loop, not a missing/broken component.

## How to apply

- Never use a fresh literal (`[]`, `{}`) as a `useQuery`/`useState` destructuring default if that value flows into a `useEffect` (or `useMemo`/`useCallback`) dependency array.
- Fix: hoist a single stable constant outside the component (e.g. `const EMPTY: Item[] = [];`) and use that as the default instead. Reference equality then only changes when the query actually resolves to new data.
- When debugging "UI just doesn't render / freezes" reports, check the browser/workflow console for a "Maximum update depth exceeded" warning before assuming a logic/conditional-rendering bug — grep useEffect dependency arrays for any query-destructured field that has a literal default.
