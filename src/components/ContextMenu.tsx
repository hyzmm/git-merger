import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  /** Renders as a non-interactive section header. */
  heading?: boolean;
  /** Renders as a horizontal separator. */
  separator?: boolean;
  /** Style as destructive (red) action. */
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuPos {
  x: number;
  y: number;
}

interface Props {
  pos: ContextMenuPos | null;
  items: MenuItem[];
  onClose: () => void;
}

/** Tiny floating context menu. Closes on click-outside, Escape, or scroll. */
export function ContextMenu({ pos, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll, true);
    };
  }, [pos, onClose]);

  if (!pos) return null;
  // Clamp inside viewport so the menu doesn't overflow.
  const x = Math.min(pos.x, window.innerWidth - 220);
  const y = Math.min(pos.y, window.innerHeight - items.length * 28 - 8);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-50 rounded-md border border-border bg-popover py-1 text-xs shadow-lg"
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="my-1 h-px bg-border" aria-hidden="true" />;
        if (it.heading)
          return (
            <div
              key={i}
              className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {it.label}
            </div>
          );
        return (
          <Button
            key={i}
            variant="ghost"
            size="sm"
            type="button"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick?.();
            }}
            className={cn(
              'w-full text-left',
              it.disabled && 'cursor-not-allowed opacity-60',
              it.danger && !it.disabled && 'text-destructive',
            )}
          >
            {it.label}
          </Button>
        );
      })}
    </div>
  );
}
