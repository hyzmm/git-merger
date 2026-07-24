# popover

2026-07-25, transformation engine (legacy new-york style, no base registry counterpart), migrated

## Changed

- **`src/components/ui/popover.tsx`**
  - Replaced `import { Popover as PopoverPrimitive } from "radix-ui"` with `import { Popover as PopoverPrimitive } from "@base-ui/react/popover"`
  - Updated types: `React.ComponentProps<typeof PopoverPrimitive.Root>` → `PopoverPrimitive.Root.Props`, `React.ComponentProps<typeof PopoverPrimitive.Trigger>` → `PopoverPrimitive.Trigger.Props`
  - **`PopoverContent`** — restructured from Radix `Portal > Content` to Base UI `Portal > Positioner > Popup`:
    - `align` and `sideOffset` props moved from Content to Positioner (Positioner is responsible for positioning)
    - Positioner gets `className="z-50"` for z-index isolation
    - Popup (formerly Content) handles styling, animations, and `data-slot`
    - CSS variable `--radix-popover-content-transform-origin` → `--transform-origin`
    - Data attributes: `data-[state=open]:` → `data-open:`, `data-[state=closed]:` → `data-closed:`
    - Props type updated to combine `PopoverPrimitive.Popup` props with Positioner's `align`/`sideOffset` types
  - **`PopoverAnchor`** — Base UI has no Anchor primitive (Positioner uses `anchor` prop instead). Changed from `PopoverPrimitive.Anchor` to inert `<div>` passthrough; consumers that rely on `PopoverAnchor` for custom anchor positioning may need manual adjustment
- **`src/components/stats/DateRangePicker.tsx`** (consumer)
  - Changed `<PopoverTrigger asChild>` → `<PopoverTrigger render={<Button />}>` — line 111

**Leftover scan**: `grep -rn "radix-ui\|@radix-ui" src/` — clean (no hits)

## Left alone

- `PopoverHeader`, `PopoverTitle`, `PopoverDescription` — these are plain `<div>`/`<h2>`/`<p>` wrappers, not Radix primitives; unchanged
- `react-day-picker` (Calendar) — not Radix, intentionally untouched

## Behavior changes

1. **`asChild` → `render`**: `PopoverTrigger` no longer supports `asChild`. Consumers use `render={<Element />}` instead. `<PopoverTrigger render={<Button/>}>` is the new pattern.
2. **PopoverAnchor**: Now renders a plain `<div>` instead of Radix's anchor primitive. Base UI handles anchor positioning through the Positioner's `anchor` prop. If custom anchor behavior was used (e.g., anchoring to a different element), adjust manually via Positioner's `anchor` prop.
3. **Animation data attributes**: `data-[state=open]`/`data-[state=closed]` → `data-open`/`data-closed`. The animate-in/out Tailwind utilities continue to work since they target these presence attributes.
4. **CSS var rename**: `--radix-popover-content-transform-origin` → `--transform-origin` (Base UI naming). The `origin-(--transform-origin)` class works identically.

## Verify by hand

1. Open the custom date range picker popover — verify it positions correctly relative to the trigger button
2. Verify `align="start"` positions the popover aligned to the start edge
3. Verify the popover has correct z-index (appears above other content)
4. Verify popover closes on outside click and escape key
5. Check that the animation (fade-in + zoom-in on open, fade-out + zoom-out on close) feels smooth
