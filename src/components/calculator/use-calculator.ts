"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalculatorRates,
  COMPANY_DEFAULTS_VERSION,
  DEFAULT_RATES,
  ProjectCalculator,
  Quote,
  computeTotals,
  emptyProjectCalculator,
  makeQuote,
  mergeCompanyRates,
  reviveProjectCalculator,
} from "@/lib/calculator/engine";
import { QuoteOp, applyOp } from "@/lib/calculator/operations";
import {
  loadCalculator,
  saveCalculator,
  saveCompanyRates,
} from "@/lib/actions/calculator";

const docKey = (projectId: string) => `op-calculator:v2:${projectId}`;
const legacyKey = (projectId: string) => `op-calculator:v1:${projectId}`;
const DEFAULTS_KEY = "op-calculator-defaults:v1";

export type SyncStatus = "loading" | "synced" | "saving" | "offline" | "unsaved";

function readLocalDefaults(): CalculatorRates {
  if (typeof window === "undefined") return structuredClone(DEFAULT_RATES);
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return structuredClone(DEFAULT_RATES);
    return mergeCompanyRates(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_RATES);
  }
}

function readLocalDoc(projectId: string): ProjectCalculator | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(docKey(projectId)) ?? window.localStorage.getItem(legacyKey(projectId));
    if (!raw) return null;
    return reviveProjectCalculator(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useCalculator(
  projectId: string,
  { initialData }: { initialData?: import("@/lib/actions/calculator").LoadCalculatorResult } = {},
) {
  const [doc, setDoc] = useState<ProjectCalculator>(emptyProjectCalculator);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const companyRates = useRef<CalculatorRates>(structuredClone(DEFAULT_RATES));
  const saveTimer = useRef<number | null>(null);
  const serverAvailable = useRef(true);
  const loadedDoc = useRef<ProjectCalculator | null>(null);
  // Load: server first, fall back to (and migrate from) localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readLocalDoc(projectId);
      try {
        const result = initialData ?? await loadCalculator(projectId);
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error);
        companyRates.current = result.companyRates;
        writeLocal(DEFAULTS_KEY, result.companyRates);
        const initialDoc = result.doc ?? local ?? emptyProjectCalculator(result.companyRates);
        setDoc(initialDoc);

        loadedDoc.current = initialDoc;
        serverAvailable.current = true;
        setSyncStatus(result.doc ? "synced" : "unsaved");
      } catch {
        if (cancelled) return;
        serverAvailable.current = false;
        companyRates.current = readLocalDefaults();
        const fallback = local ?? emptyProjectCalculator(companyRates.current);
        loadedDoc.current = fallback;
        setDoc(fallback);
        setSyncStatus("offline");
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialData, projectId]);

  // Save: debounced; localStorage always (cache), Supabase when reachable.
  useEffect(() => {
    if (!hydrated || doc === loadedDoc.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      writeLocal(docKey(projectId), doc);
      if (!serverAvailable.current) return;
      setSyncStatus("saving");
      try {
        const saved = await saveCalculator(projectId, doc);
        setSyncStatus(saved.ok ? "synced" : "offline");
      } catch {
        setSyncStatus("offline");
      }
    }, 800);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [doc, hydrated, projectId]);

  const quote: Quote = useMemo(
    () => doc.quotes.find((q) => q.id === doc.activeQuoteId) ?? doc.quotes[0],
    [doc],
  );

  const totals = useMemo(() => computeTotals(quote), [quote]);

  /** Apply an operation to the active quote — the only mutation path. */
  const dispatch = useCallback((op: QuoteOp) => {
    setDoc((prev) => ({
      ...prev,
      quotes: prev.quotes.map((q) => (q.id === prev.activeQuoteId ? applyOp(q, op) : q)),
    }));
  }, []);

  const applyOps = useCallback((ops: QuoteOp[]) => {
    setDoc((prev) => ({
      ...prev,
      quotes: prev.quotes.map((q) =>
        q.id === prev.activeQuoteId ? ops.reduce((acc, op) => applyOp(acc, op), q) : q,
      ),
    }));
  }, []);

  // Convenience wrappers that need to hand back the created id (for autofocus).
  const addRoom = useCallback(
    (name: string): string => {
      const id = crypto.randomUUID();
      dispatch({ type: "addRoom", name, id });
      return id;
    },
    [dispatch],
  );

  const addExteriorLine = useCallback(
    (itemId: string): string => {
      const id = crypto.randomUUID();
      dispatch({ type: "addExteriorLine", itemId, id });
      return id;
    },
    [dispatch],
  );

  // ---- Quote management (document level) ----

  const switchQuote = useCallback((quoteId: string) => {
    setDoc((prev) => (prev.quotes.some((q) => q.id === quoteId) ? { ...prev, activeQuoteId: quoteId } : prev));
  }, []);

  const addQuote = useCallback(() => {
    setDoc((prev) => {
      const fresh = makeQuote(`Quote ${prev.quotes.length + 1}`, companyRates.current);
      return { ...prev, quotes: [...prev.quotes, fresh], activeQuoteId: fresh.id };
    });
  }, []);

  const duplicateQuote = useCallback(() => {
    setDoc((prev) => {
      const source = prev.quotes.find((q) => q.id === prev.activeQuoteId);
      if (!source) return prev;
      const now = new Date().toISOString();
      const copy: Quote = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        name: `${source.name} (copy)`,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      const index = prev.quotes.findIndex((q) => q.id === prev.activeQuoteId);
      const quotes = [...prev.quotes];
      quotes.splice(index + 1, 0, copy);
      return { ...prev, quotes, activeQuoteId: copy.id };
    });
  }, []);

  const deleteQuote = useCallback(() => {
    setDoc((prev) => {
      const quotes = prev.quotes.filter((q) => q.id !== prev.activeQuoteId);
      if (quotes.length === 0) {
        return emptyProjectCalculator(companyRates.current);
      }
      return { ...prev, quotes, activeQuoteId: quotes[0].id };
    });
  }, []);

  // ---- Company default rates ----

  const useCompanyDefaults = useCallback(() => {
    dispatch({ type: "setRates", rates: structuredClone(companyRates.current) });
  }, [dispatch]);

  const saveAsCompanyDefaults = useCallback(() => {
    // An explicit save means "use these visible rates"; stamp the current
    // version so the one-time future-job reduction is not applied again.
    const defaults = structuredClone(quote.rates);
    defaults.companyDefaultsVersion = COMPANY_DEFAULTS_VERSION;
    companyRates.current = structuredClone(defaults);
    writeLocal(DEFAULTS_KEY, defaults);
    if (serverAvailable.current) {
      saveCompanyRates(defaults).catch(() => {});
    }
  }, [quote.rates]);

  return {
    doc,
    quote,
    totals,
    hydrated,
    syncStatus,
    dispatch,
    applyOps,
    addRoom,
    addExteriorLine,
    switchQuote,
    addQuote,
    duplicateQuote,
    deleteQuote,
    useCompanyDefaults,
    saveAsCompanyDefaults,
  };
}
