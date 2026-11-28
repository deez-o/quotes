"use client";

import { useEffect, useRef } from "react";

/**
 * Saves the form it sits in as soon as something changes (a box is left or a choice is picked).
 * New rows wait until they have a name and a price, so half-typed lines aren't added.
 */
export function AutoSave({ isNew = false, required = ["name", "rate"], watch = [] }: { isNew?: boolean; required?: string[]; watch?: unknown[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.type === "file") return;
      if (isNew && required.some((f) => !(form.elements.namedItem(f) as HTMLInputElement | null)?.value.trim())) return;
      if (timer) clearTimeout(timer);
      // A moment's wait so tabbing through several boxes saves once.
      timer = setTimeout(() => form.requestSubmit(), 250);
    };
    form.addEventListener("change", onChange);
    return () => { form.removeEventListener("change", onChange); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- required is a fixed list per form
  }, [isNew]);

  // Changes made by buttons (a logo uploaded, a colour picked) don't fire "change": save when they move.
  const first = useRef(true);
  const key = JSON.stringify(watch);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const form = ref.current?.closest("form");
    const t = setTimeout(() => form?.requestSubmit(), 250);
    return () => clearTimeout(t);
  }, [key]);
  return <span ref={ref} hidden />;
}
