import { fetchJson, useApi } from "../hooks/use-api";
import { useEffect, useState } from "react";
import { LockKeyhole, Unlock } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface LogEntry {
  readonly level?: string;
  readonly tag?: string;
  readonly message: string;
  readonly timestamp?: string;
}

interface Nav {
  toDashboard: () => void;
}

interface BookLock {
  readonly bookId: string;
  readonly title: string;
  readonly locked: boolean;
  readonly stale: boolean;
  readonly activeInProcess: boolean;
  readonly metadata?: { readonly pid?: number };
}

const LEVEL_COLORS: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-primary/70",
  debug: "text-muted-foreground/50",
};

export function LogViewer({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ entries: ReadonlyArray<LogEntry> }>("/logs");
  const [locks, setLocks] = useState<ReadonlyArray<BookLock>>([]);
  const [lockError, setLockError] = useState<string | null>(null);

  const refreshLocks = async () => {
    try {
      const { books } = await fetchJson<{ books: ReadonlyArray<{ id: string; title: string }> }>("/books");
      const result = await Promise.all(books.map(async (book) => {
        const status = await fetchJson<Omit<BookLock, "bookId" | "title">>(`/books/${encodeURIComponent(book.id)}/lock`);
        return { ...status, bookId: book.id, title: book.title };
      }));
      setLocks(result);
      setLockError(null);
    } catch (error) {
      setLockError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refreshLocks();
    const timer = window.setInterval(() => void refreshLocks(), 3_000);
    return () => window.clearInterval(timer);
  }, []);

  const forceUnlock = async (lock: BookLock) => {
    const force = !lock.stale || lock.activeInProcess;
    const message = lock.activeInProcess
      ? "确认强制解锁当前 Studio 的写入任务？原任务不会被中断，继续写入可能与新任务冲突。"
      : force
        ? "确认强制解锁？原任务不会被中断；如果它仍在写入，可能与新任务冲突。"
        : "确认清理失效的写入锁？";
    if (!window.confirm(message)) return;
    try {
      await fetchJson(`/books/${encodeURIComponent(lock.bookId)}/force-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force }),
      });
      void refreshLocks();
    } catch (error) {
      setLockError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("logs.title")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("logs.title")}</h1>
        <button
          onClick={() => { refetch(); void refreshLocks(); }}
          className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}
        >
          {t("common.refresh")}
        </button>
      </div>

      <section className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 font-medium"><LockKeyhole size={16} /> 写入锁状态</div>
          <span className="text-xs text-muted-foreground">每 3 秒刷新</span>
        </div>
        <div className="divide-y divide-border/60">
          {lockError && <p className="px-4 py-3 text-sm text-destructive">{lockError}</p>}
          {!lockError && locks.length === 0 && <p className="px-4 py-5 text-sm text-muted-foreground">正在读取锁状态…</p>}
          {locks.map((lock) => (
            <div key={lock.bookId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{lock.title}</p><p className={lock.locked ? "mt-0.5 text-xs text-amber-600" : "mt-0.5 text-xs text-emerald-600"}>{lock.locked ? (lock.stale ? "失效锁" : `已锁定${lock.metadata?.pid ? ` · PID ${lock.metadata.pid}` : ""}`) : "未锁定"}</p></div>
              {lock.locked && <button type="button" onClick={() => void forceUnlock(lock)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"><Unlock size={13} />{lock.stale ? "清理锁" : "强制解锁"}</button>}
            </div>
          ))}
        </div>
      </section>

      <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <div className="p-4 max-h-[600px] overflow-y-auto">
          {data?.entries && data.entries.length > 0 ? (
            <div className="space-y-1 font-mono text-sm leading-relaxed">
              {data.entries.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  {entry.timestamp && (
                    <span className="text-muted-foreground shrink-0 w-20 tabular-nums">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                  {entry.level && (
                    <span className={`shrink-0 w-12 uppercase ${LEVEL_COLORS[entry.level] ?? "text-muted-foreground"}`}>
                      {entry.level}
                    </span>
                  )}
                  {entry.tag && (
                    <span className="text-primary/70 shrink-0">[{entry.tag}]</span>
                  )}
                  <span className="text-foreground/80">{entry.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic py-12 text-center">
              {t("logs.empty")}
            </div>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("logs.showingRecent")}
      </p>
    </div>
  );
}
