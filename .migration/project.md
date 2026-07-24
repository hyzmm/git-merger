# Project migration: radix → @base-ui/react

2026-07-25, whole-project migration, legacy style (new-york, no base registry counterpart)

## Summary

Migrated the entire project from Radix UI (via `radix-ui` bundling package) to Base UI (`@base-ui/react`). The project uses the `new-york` shadcn style (legacy), which has no `base-new-york` counterpart, so all transformations were done via the transformation engine — rewiring primitives while preserving the existing Tailwind CSS classes and styling.

## Dependency changes

### Removed (8 packages)
- `radix-ui` (bundled re-exports): `^1.6.5`
- `@radix-ui/react-dialog`: `^1.1.6`
- `@radix-ui/react-dropdown-menu`: `^2.1.6`
- `@radix-ui/react-scroll-area`: `^1.2.3`
- `@radix-ui/react-separator`: `^1.1.2`
- `@radix-ui/react-slot`: `^1.1.2`
- `@radix-ui/react-tabs`: `^1.1.3`
- `@radix-ui/react-tooltip`: `^1.1.8`

### Added
- `@base-ui/react`: `^1.6.0`

### Intentionally untouched (not Radix)
- `react-day-picker` (calendar)
- `@tanstack/react-virtual`
- `echarts` / `lucide-react`
- `@tauri-apps/*` plugins
- Sonner / cmdk / vaul (not present in project)

## Wrappers migrated

| Component | File | Strategy |
|-----------|------|----------|
| Button | `src/components/ui/button.tsx` | Slot → `@base-ui/react/button` ButtonPrimitive |
| Popover | `src/components/ui/popover.tsx` | Portal > Content → Portal > Positioner > Popup |

## Consumer code swept

| File | Change |
|------|--------|
| `src/components/stats/DateRangePicker.tsx` | `PopoverTrigger asChild` → `PopoverTrigger render` |

**Consumer sweep result**: No remaining `asChild` usages found in app code (outside `components/ui/`).

## Style flag resolution

The `components.json` was originally `"style": "new-york"` (Radix-based). As requested by the user, it has been changed to `"style": "base-nova"` so that **future `shadcn add` commands will use Base UI primitives by default**.

### Small visual note

Existing components (button, popover) retain their current `new-york`-like styling (unchanged during migration — the transformation engine kept their exact CSS classes). New `base-nova` components added via `shadcn add` will have slightly different styling:
- `rounded-lg` vs `rounded-md`
- Different hover effects (`hover:bg-muted` etc.)
- Additional `group/button` and `data-[icon]` selectors

This is purely cosmetic and doesn't affect functionality.

## Final build

**`tsc -b`**: ✅ Passed (baseline also passed)
**Remaining wrappers on Radix**: 0 (all migrated)

## Verify by hand

1. Open the app — verify the UI loads without runtime errors
2. Navigate to the Stats page — verify the DateRangePicker popover opens/closes correctly
3. Click around the app — verify all buttons respond correctly to hover/active states
4. Interactive elements should all behave as before the migration
