"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { Quote } from "@/lib/calculator/engine";
import { QuoteOp } from "@/lib/calculator/operations";
import { IconButton } from "./bits";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  /** Tool actions the agent performed before this reply (shown as a muted line). */
  actions?: string[];
};

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text:
    "Paste a measurements message — “living room 16x22, master 15x25 with trim, 2 doors” — and I'll fill the calculator.\n\nI can also change things: “raise all prices 5%”, “add 120 lf of soffits”, “give the master a 3rd coat”, “$150 off”, “mark it sent”.",
};

const SLASH_COMMANDS = [
  { cmd: "/rooms", hint: "living room 16x22, bed 12x11 — add rooms from one line" },
  { cmd: "/prices", hint: "+5% — raise or lower every rate" },
  { cmd: "/clear", hint: "empty this quote" },
];

/** Rewrites slash shorthand into plain requests the agent understands. */
function expandSlash(text: string): string {
  if (text.startsWith("/rooms ")) return `Add these rooms: ${text.slice(7)}`;
  if (text.startsWith("/prices ")) return `Change all prices by ${text.slice(8)}`;
  if (text.trim() === "/clear") return "Clear this quote.";
  return text;
}

export function ChatPanel({
  quote,
  onOps,
  mobileOpen,
  onMobileClose,
}: {
  quote: Quote;
  onOps: (ops: QuoteOp[]) => void;
  /** Below xl the panel is an off-canvas drawer; this controls it. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quoteRef = useRef(quote);
  quoteRef.current = quote;

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onMobileClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onMobileClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, activity]);

  async function send() {
    const raw = input.trim();
    if (!raw || thinking) return;
    const text = expandSlash(raw);
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text: raw };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setThinking(true);

    const reply = (replyText: string, actions?: string[]) =>
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: replyText, actions }]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages
            .filter((m) => m.id !== "welcome")
            .map((m) => ({ role: m.role, content: m.id === userMessage.id ? text : m.text })),
          quote: quoteRef.current,
        }),
      });

      if (response.headers.get("content-type")?.includes("ndjson") && response.body) {
        // Streaming: tool-activity lines while the agent works, then the reply.
        const labels: string[] = [];
        let finalized = false;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handleLine = (line: string) => {
          if (!line.trim()) return;
          let event: { kind: string; label?: string; text?: string; ops?: QuoteOp[]; error?: string };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.kind === "tool" && event.label) {
            labels.push(event.label);
            setActivity([...labels]);
          } else if (event.kind === "final") {
            finalized = true;
            setConnected(true);
            if (event.ops && event.ops.length > 0) onOps(event.ops);
            reply(event.text || "Done.", labels.length ? [...labels] : undefined);
          } else if (event.kind === "error") {
            finalized = true;
            reply(`That didn't work: ${event.error ?? "unknown error"}.`);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handleLine);
        }
        handleLine(buffer);
        if (!finalized) reply("The connection dropped before I finished — check the calculator and try again.");
      } else {
        const data = (await response.json()) as {
          ok: boolean;
          text?: string;
          ops?: QuoteOp[];
          configured?: boolean;
          error?: string;
        };
        if (data.ok) {
          setConnected(true);
          if (data.ops && data.ops.length > 0) onOps(data.ops);
          reply(data.text || "Done.");
        } else if (data.configured === false) {
          setConnected(false);
          reply(
            "I'm not connected yet — add OPENAI_API_KEY to .env.local and restart the dev server, then I can make these changes for real.",
          );
        } else {
          reply(`That didn't work: ${data.error ?? "unknown error"}.`);
        }
      }
    } catch {
      reply("I couldn't reach the server — check that the app is running and try again.");
    } finally {
      setThinking(false);
      setActivity([]);
    }
  }

  function clearConversation() {
    if (thinking) return;
    setMessages([WELCOME]);
  }

  const showSlashHints = input.startsWith("/");

  return (
    <aside
      aria-label="Assistant"
      className={cn(
        "flex shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]",
        // Below xl: off-canvas drawer sliding in from the right.
        "fixed bottom-0 right-0 top-0 z-50 w-[340px] max-w-[92vw] shadow-2xl transition-transform duration-300",
        mobileOpen ? "translate-x-0" : "translate-x-full",
        // xl+: always-open inline column, no transform.
        "xl:sticky xl:bottom-auto xl:z-auto xl:h-screen xl:w-[300px] xl:max-w-none xl:translate-x-0 xl:shadow-none xl:transition-none 2xl:w-[340px]",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">Assistant</h2>
        <span className="flex items-center gap-2">
          {connected !== null ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-muted)]">
              <span
                aria-hidden
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  connected ? "bg-[var(--color-good)]" : "bg-[var(--color-warn)]",
                )}
              />
              {connected ? "Live" : "Not connected"}
            </span>
          ) : null}
          {messages.length > 1 ? (
            <IconButton label="Clear conversation" onClick={clearConversation}>
              ⟲
            </IconButton>
          ) : null}
          <span className="xl:hidden">
            <IconButton label="Close assistant" onClick={onMobileClose}>
              ✕
            </IconButton>
          </span>
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 select-text space-y-4 overflow-y-auto px-5 py-4">
        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="ml-6 w-fit max-w-full whitespace-pre-wrap rounded-xl bg-[var(--color-brand-soft)] px-3 py-2 text-sm leading-5 text-[var(--color-brand-strong)]"
              style={{ marginLeft: "auto" }}
            >
              {message.text}
            </div>
          ) : (
            <div key={message.id}>
              {message.actions && message.actions.length > 0 ? (
                <div className="mb-1.5 space-y-0.5">
                  {message.actions.map((action, i) => (
                    <div key={i} className="text-[11px] leading-4 text-[var(--color-muted)]">
                      ⚙ {action}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text)]">{message.text}</div>
            </div>
          ),
        )}
        {thinking ? (
          <div className="space-y-0.5">
            {activity.map((label, i) => (
              <div key={i} className="text-[11px] leading-4 text-[var(--color-muted)]">
                ⚙ {label}
                {i === activity.length - 1 ? <span className="animate-pulse">…</span> : " ✓"}
              </div>
            ))}
            <div className="animate-pulse text-sm text-[var(--color-muted)]">
              {activity.length === 0 ? "Thinking…" : "Working…"}
            </div>
          </div>
        ) : null}
      </div>

      {showSlashHints ? (
        <div className="mx-4 mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
          {SLASH_COMMANDS.map((command) => (
            <div key={command.cmd} className="flex items-baseline gap-2 py-0.5 text-xs">
              <code className="shrink-0 font-semibold text-[var(--color-brand-strong)]">{command.cmd}</code>
              <span className="text-[var(--color-muted)]">{command.hint}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="border-t border-[var(--color-border)] p-4">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 focus-within:border-[var(--color-brand)]">
          <textarea
            ref={textareaRef}
            name="assistant-message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(6, Math.max(3, input.split("\n").length))}
            placeholder="Measurements or /command…"
            className="max-h-40 min-h-[64px] min-w-0 flex-1 resize-none bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
          />
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={!input.trim() || thinking}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand)] text-sm leading-none text-[var(--color-brand-ink)] transition-opacity disabled:opacity-30"
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  );
}
