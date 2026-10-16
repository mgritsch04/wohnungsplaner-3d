import { useEffect, useRef, type ReactNode } from 'react';
import { nextMenuIndex } from './menuNav';

const FOCUSABLE = 'button:not(:disabled), select:not(:disabled), input:not(:disabled)';

/**
 * Drop-down menu of the toolbar (#100): a button that shows/hides a panel of entries
 * (disclosure pattern – the entries stay ordinary buttons). Opening moves the focus to the
 * first entry; ↑/↓/Pos1/Ende move between entries, Esc closes and returns to the button.
 * A click outside or moving the focus elsewhere closes the menu.
 */
export function ToolbarMenu({
  id,
  open,
  onOpenChange,
  label,
  ariaLabel,
  title,
  className,
  align = 'left',
  children,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible content of the button (text or icon). */
  label: ReactNode;
  /** Accessible name when the button only shows an icon. */
  ariaLabel?: string;
  title?: string;
  className?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onOpenChange);
  useEffect(() => {
    close.current = onOpenChange;
  });

  const entries = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];

  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close.current(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div
      className="menu-wrap"
      ref={wrap}
      onBlur={(e) => {
        // keyboard (Tab) or a click on another control: close; clicks on plain areas are handled by pointerdown
        const to = e.relatedTarget as Node | null;
        if (open && to && !wrap.current?.contains(to)) onOpenChange(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        title={title}
        data-tip={ariaLabel ? title : undefined}
        onClick={() => onOpenChange(!open)}
      >
        {label}
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          className={`menu ${align === 'right' ? 'menu-right' : ''}`.trim()}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation(); // not also "cancel tool / clear selection"
              onOpenChange(false);
              trigger.current?.focus();
              return;
            }
            // a focused drop-down list keeps its own arrow keys
            if ((e.target as HTMLElement).tagName === 'SELECT') return;
            const list = entries();
            const next = nextMenuIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.key);
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation(); // arrows must not nudge the selected furniture
            list[next].focus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
