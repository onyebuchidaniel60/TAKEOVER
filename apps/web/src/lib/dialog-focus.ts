// Phase 11: shared dialog focus management. While a dialog is open, Tab
// cycles inside it, Escape closes it, and focus returns to the element that
// opened it when it closes. Used by every modal (report, resolve, disable)
// and the inline cancel confirmation.
import { useEffect, useRef, type MutableRefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/**
 * Trap + restore focus for a dialog. Call unconditionally with the dialog's
 * open state; attach the returned ref to the dialog panel (the element with
 * role="dialog"/"alertdialog").
 */
export function useDialogFocus<T extends HTMLElement>(
  active: boolean,
  onClose: () => void,
): MutableRefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the dialog on open (first control wins).
    const container = containerRef.current;
    const first = container ? focusables(container)[0] : undefined;
    if (first) {
      first.focus();
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) {
        return;
      }
      const items = focusables(containerRef.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0] as HTMLElement;
      const lastItem = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // Focus returns to the triggering element on close.
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return containerRef;
}
