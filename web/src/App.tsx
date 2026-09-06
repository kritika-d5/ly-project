import { Link, Outlet } from 'react-router-dom';
import { KanoonCredit } from './components/Attribution';

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-stone-900">
              Bail<span className="text-stone-400">Research</span>
            </span>
            <span className="text-xs text-stone-500 hidden sm:inline">
              Supreme Court bail jurisprudence
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-xs">
            <Link to="/explore" className="text-stone-600 hover:text-stone-900">
              Citation explorer
            </Link>
            <span className="hidden text-stone-400 sm:inline">
              198 judgments &middot; 1912&ndash;2022
            </span>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* The IKanoon credit is required by the terms under which this corpus was
          collected — see CLAUDE.md rule 10 in the data repo. Do not remove it. */}
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-5 text-xs text-stone-500">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KanoonCredit />
            <span className="text-stone-400">
              &mdash; judgment text, the citation graph and citation treatment labels are
              sourced from Indian Kanoon.
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-stone-400">
            <span>
              Official judgment PDFs from the Supreme Court of India open data set
              (records of the Supreme Court Reports).
            </span>
          </div>
          <div className="mt-1.5 text-stone-400">
            Research aid only &mdash; not legal advice. Summaries and answers are
            machine-generated; verify against the judgment before relying on them.
          </div>
        </div>
      </footer>
    </div>
  );
}
