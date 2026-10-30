"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { addressDetails, suggestAddresses, type AddressSuggestion } from "@/lib/actions/places";
import { Input, Spinner, cn } from "./ui";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};

/** An address field that suggests addresses from Google as you type. Picking
 * one fills in the full address; anything typed is still kept as is. */
export function AddressInput({ value, defaultValue, onChange, className, ...props }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [own, setOwn] = useState(defaultValue ?? "");
  const text = value ?? own;
  const current = useRef(text);
  current.current = text;
  // Typed text to look up; filling in a picked address isn't a new search.
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<DOMRect | null>(null);
  // Google bills the searches before a pick, and the pick, as one session.
  const session = useRef<string | null>(null);

  function change(next: string) {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  }

  useEffect(() => {
    let cancelled = false;
    setActive(-1);
    if (query.trim().length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      session.current ??= crypto.randomUUID();
      const found = await suggestAddresses(query, session.current).catch(() => []);
      if (cancelled) return;
      setSuggestions(found);
      setLoading(false);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const expanded = open && suggestions.length > 0;

  // The list floats over the page, so a dialog's scrolling can't clip it.
  useEffect(() => {
    if (!expanded) return;
    const place = () => setBox(input.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [expanded]);

  async function pick(suggestion: AddressSuggestion) {
    const picked = [suggestion.main, suggestion.secondary].filter(Boolean).join(", ");
    const token = session.current;
    session.current = null;
    setOpen(false);
    setQuery("");
    change(picked);
    const full = token ? await addressDetails(suggestion.id, token).catch(() => null) : null;
    if (full && current.current === picked) change(full);
  }

  return (
    <span className="relative block">
      <Input
        {...props}
        ref={input}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined}
        value={text}
        onChange={(event) => {
          change(event.target.value);
          setQuery(event.target.value);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((index) => Math.max(-1, Math.min(suggestions.length - 1, index + step)));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            void pick(suggestions[active]);
          }
        }}
        className={cn(loading && "pr-8", className)}
      />
      {loading ? (
        <Spinner className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-faint)]" />
      ) : null}
      {expanded && box ? (
        <span
          className="fixed z-[60] block overflow-hidden rounded-[var(--radius)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)]"
          style={{ top: box.bottom + 4, left: box.left, width: Math.max(box.width, 256) }}
        >
          <span id={id} role="listbox" aria-label="Address suggestions" className="block">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={active === index}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(suggestion)}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-hover)]",
                  active === index && "bg-[var(--color-hover)]",
                )}
              >
                <span className="block truncate text-[13px] font-medium text-[var(--color-heading)]">{suggestion.main}</span>
                {suggestion.secondary ? (
                  <span className="block truncate text-xs text-[var(--color-muted)]">{suggestion.secondary}</span>
                ) : null}
              </button>
            ))}
          </span>
          <span className="block px-2 pb-0.5 pt-1 text-right text-[10px] text-[var(--color-faint)]">Google Maps</span>
        </span>
      ) : null}
    </span>
  );
}
