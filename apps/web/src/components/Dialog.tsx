import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
  wide?: boolean;
  focusTitle?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function Dialog({ title, description, children, onCancel, busy = false, wide = false, focusTitle = false, returnFocusRef }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.showModal();
    const initial = dialog.querySelector<HTMLElement>('[data-autofocus]');
    initial?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      const returnTarget = previous?.isConnected ? previous : document.querySelector<HTMLElement>('main h1');
      returnTarget?.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <dialog
    ref={dialogRef}
    className={`modal${wide ? ' modal-wide' : ''}`}
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    aria-modal="true"
    tabIndex={-1}
    onKeyDown={trapFocus}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
  >
    <div className="modal-heading">
      <div><h2 id={titleId} tabIndex={focusTitle ? -1 : undefined} data-autofocus={focusTitle ? true : undefined}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="icon-button" onClick={onCancel} disabled={busy} aria-label={`Close ${title}`}><X size={20} aria-hidden="true" /></button>
    </div>
    {children}
  </dialog>;
}
