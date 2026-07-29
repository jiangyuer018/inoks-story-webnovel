import { useEffect } from "react";
import {
  Activity,
  BookOpen,
  Bot,
  ChevronRight,
  CircleGauge,
  FileInput,
  Gauge,
  LibraryBig,
  MessageSquareText,
  Plus,
  Radar,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  WandSparkles,
} from "lucide-react";
import { useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";

interface StudioRailNav {
  readonly toDashboard: () => void;
  readonly toChat: () => void;
  readonly toBook: (id: string) => void;
  readonly toStoryWorkbench: (id: string) => void;
  readonly toBookCreate: () => void;
  readonly toServices: () => void;
  readonly toProjectSettings: () => void;
  readonly toDaemon: () => void;
  readonly toLogs: () => void;
  readonly toGenres: () => void;
  readonly toStyle: () => void;
  readonly toImport: (tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation") => void;
  readonly toRadar: () => void;
  readonly toDoctor: () => void;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

export function StudioRail({
  nav,
  activePage,
  sse,
}: {
  readonly nav: StudioRailNav;
  readonly activePage: string;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage> };
}) {
  const { data, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");
  const books = data?.books ?? [];
  const activeBookId = activePage.split(":")[1];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) void refetchBooks();
    if (shouldRefetchDaemonStatus(recent)) void refetchDaemon();
  }, [refetchBooks, refetchDaemon, sse.messages]);

  return (
    <>
      <aside className="studio-rail hidden h-full w-[288px] shrink-0 flex-col overflow-hidden lg:flex">
        <button
          type="button"
          onClick={nav.toDashboard}
          className="group flex items-center gap-3 border-b border-white/10 px-5 py-5 text-left"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 font-mono text-sm font-bold text-slate-950 shadow-[0_8px_28px_rgba(34,211,238,0.18)]">
            iO
          </span>
          <span className="min-w-0">
            <span className="block text-[18px] font-semibold tracking-tight text-white">inkOS Studio</span>
            <span className="block text-[11px] tracking-[0.16em] text-slate-400">LONG-FORM CONTROL</span>
          </span>
        </button>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <RailGroup label="生产">
            <RailItem icon={<Gauge size={17} />} label="项目总览" active={activePage === "dashboard"} onClick={nav.toDashboard} />
            <RailItem icon={<Plus size={17} />} label="创建长篇" active={activePage === "book-create"} onClick={nav.toBookCreate} />
            <RailItem icon={<MessageSquareText size={17} />} label="创作会话" active={activePage === "chat"} onClick={nav.toChat} />
          </RailGroup>

          <RailGroup
            label="连载作品"
            action={(
              <button type="button" onClick={nav.toBookCreate} aria-label="创建长篇" className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white">
                <Plus size={14} />
              </button>
            )}
          >
            {books.length === 0 && (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-xs leading-5 text-slate-500">
                还没有长篇项目。创建后，章节、正史和发布会汇入同一条控制链。
              </p>
            )}
            {books.map((book) => {
              const bookActive = activeBookId === book.id;
              const workbenchActive = activePage === `workbench:${book.id}`;
              return (
                <div key={book.id} className={`rounded-xl border ${bookActive ? "border-cyan-300/35 bg-cyan-300/5" : "border-white/8 bg-white/[0.025]"}`}>
                  <button
                    type="button"
                    onClick={() => nav.toBook(book.id)}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left"
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/8 text-slate-300">
                      <BookOpen size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-100">{book.title}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">{book.chaptersWritten} 章 · {book.genre}</span>
                    </span>
                    <ChevronRight size={14} className="mt-2 text-slate-600" />
                  </button>
                  <div className="grid grid-cols-2 gap-px border-t border-white/8 bg-white/8">
                    <button
                      type="button"
                      onClick={() => nav.toBook(book.id)}
                      className={`bg-slate-950/80 px-2 py-2 text-xs ${bookActive && !workbenchActive ? "text-cyan-300" : "text-slate-400 hover:text-white"}`}
                    >
                      写作
                    </button>
                    <button
                      type="button"
                      onClick={() => nav.toStoryWorkbench(book.id)}
                      className={`bg-slate-950/80 px-2 py-2 text-xs ${workbenchActive ? "text-cyan-300" : "text-slate-400 hover:text-white"}`}
                    >
                      故事控制
                    </button>
                  </div>
                </div>
              );
            })}
          </RailGroup>

          <RailGroup label="研究与资产">
            <RailItem icon={<Radar size={17} />} label="市场雷达" active={activePage === "radar"} onClick={nav.toRadar} />
            <RailItem icon={<FileInput size={17} />} label="文本与正史导入" active={activePage === "import"} onClick={() => nav.toImport()} />
            <RailItem icon={<WandSparkles size={17} />} label="文风资产" active={activePage === "style"} onClick={nav.toStyle} />
            <RailItem icon={<LibraryBig size={17} />} label="题材规则" active={activePage === "genres"} onClick={nav.toGenres} />
          </RailGroup>

          <RailGroup label="运行与治理">
            <RailItem
              icon={<Bot size={17} />}
              label="自动写作"
              active={activePage === "daemon"}
              onClick={nav.toDaemon}
              badge={daemon?.running ? "运行中" : undefined}
            />
            <RailItem icon={<Sparkles size={17} />} label="模型角色" active={activePage === "services"} onClick={nav.toServices} />
            <RailItem icon={<SlidersHorizontal size={17} />} label="项目策略" active={activePage === "project-settings"} onClick={nav.toProjectSettings} />
            <RailItem icon={<CircleGauge size={17} />} label="环境诊断" active={activePage === "doctor"} onClick={nav.toDoctor} />
            <RailItem icon={<TerminalSquare size={17} />} label="运行日志" active={activePage === "logs"} onClick={nav.toLogs} />
          </RailGroup>
        </div>

        <div className="border-t border-white/10 px-5 py-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Activity size={13} className={daemon?.running ? "text-emerald-400" : ""} />
            <span>{daemon?.running ? "守护进程在线，仍受质量门约束" : "本地控制面 · 未启动自动写作"}</span>
          </div>
        </div>
      </aside>

      <nav
        aria-label="移动端主导航"
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-slate-700/60 bg-slate-950/95 p-1.5 text-slate-400 shadow-2xl backdrop-blur lg:hidden"
      >
        <MobileRailItem icon={<Gauge size={18} />} label="总览" active={activePage === "dashboard"} onClick={nav.toDashboard} />
        <MobileRailItem icon={<Plus size={18} />} label="新建" active={activePage === "book-create"} onClick={nav.toBookCreate} />
        <MobileRailItem
          icon={<BookOpen size={18} />}
          label="作品"
          active={Boolean(activeBookId)}
          onClick={() => activeBookId ? nav.toBook(activeBookId) : nav.toDashboard()}
        />
        <MobileRailItem icon={<Settings2 size={18} />} label="策略" active={activePage === "project-settings"} onClick={nav.toProjectSettings} />
      </nav>
    </>
  );
}

function RailGroup({
  label,
  action,
  children,
}: {
  readonly label: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="font-sans text-[11px] font-semibold tracking-[0.14em] text-slate-500">{label}</h2>
        {action}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function RailItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
        active ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:bg-white/6 hover:text-white"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">{badge}</span>}
    </button>
  );
}

function MobileRailItem({
  icon,
  label,
  active,
  onClick,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] ${active ? "bg-cyan-300 text-slate-950" : "hover:bg-white/8 hover:text-white"}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
