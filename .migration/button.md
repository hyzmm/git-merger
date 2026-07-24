# button

2026-07-25, transformation engine (legacy new-york style, no base registry counterpart), migrated

## Changed

- **`src/components/ui/button.tsx`**
  - Replaced `import { Slot } from "radix-ui"` with `import { Button as ButtonPrimitive } from "@base-ui/react/button"`
  - Removed `asChild` prop from the function signature; `ButtonPrimitive` natively supports `render` prop
  - Removed manual `asChild ? Slot.Root : "button"` logic; component now renders `<ButtonPrimitive>` directly
  - Changed type from `React.ComponentProps<"button"> & VariantProps<...> & { asChild?: boolean }` to `ButtonPrimitive.Props & VariantProps<...>`
  - Removed unused `import * as React from "react"` (JSX automatic runtime, no React references remain)
- **`src/components/stats/DateRangePicker.tsx`** (consumer)
  - Changed `<PopoverTrigger asChild>` with child `<Button>` to `<PopoverTrigger render={<Button />}>` — line 111
- **`package.json`**: Removed `@radix-ui/react-slot` and `radix-ui` dependencies (no longer needed)

**Leftover scan**: `grep -rn "radix-ui\|@radix-ui" src/` — clean (no hits)

## Left alone

- `@tanstack/react-virtual`, `@tauri-apps/*`, `lucide-react`, `echarts` — non-Radix, untouched
- `react-day-picker` (calendar) — never uses Radix, intentionally untouched

## Behavior changes

- `asChild` prop is removed from Button API. Consumers must use `render` prop instead. This aligns with Base UI's pattern where all primitive parts accept `render` instead of `asChild`.
- No runtime behavior changes for the wrapper itself.

## Verify by hand

1. Check that `<Button>Click me</Button>` renders a styled button element
2. Check that `<PopoverTrigger render={<Button>Open</Button>} />` works correctly (the button is used as trigger)
3. Verify button variants (default, destructive, outline, secondary, ghost, link) render with correct styles
4. Verify button sizes render correctly
