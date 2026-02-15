import Link from "next/link";

export default function TradeStudioPage() {
  return (
    <main className="min-h-screen bg-black text-gray-100">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-4xl font-bold text-white">Trade Studio</h1>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Back to Home
          </Link>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Roster + Picks</h2>
              <span className="text-xs text-gray-400">Snapshot</span>
            </div>
            <div className="space-y-3 text-sm text-gray-300">
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Active roster overview</div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Depth chart / lineup slots</div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Draft picks summary</div>
            </div>
          </section>

          <section className="rounded-xl border border-indigo-800/60 bg-gradient-to-b from-gray-900 via-gray-900 to-black p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">AI Profile</h2>
              <span className="rounded-full bg-indigo-900 px-3 py-1 text-xs font-semibold text-indigo-200">Beta</span>
            </div>
            <div className="space-y-4 text-sm text-gray-200">
              <div className="rounded-lg border border-gray-800 bg-black/60 p-4">
                <p className="text-gray-400">Persona</p>
                <p className="text-base font-semibold text-white">Evaluator</p>
                <p className="mt-1 text-gray-400">Tracks roster health, trends, and leverage spots.</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-black/60 p-4">
                <p className="text-gray-400">Priority</p>
                <p className="text-base font-semibold text-white">Build trade suggestions</p>
                <p className="mt-1 text-gray-400">Waiting for targets, assets, and constraints.</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-black/60 p-4">
                <p className="text-gray-400">Next up</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-300">
                  <li>Import roster and pick context</li>
                  <li>Flag team needs and surplus</li>
                  <li>Draft trade packages</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Trade Block + Offers</h2>
              <span className="text-xs text-gray-400">Live board</span>
            </div>
            <div className="space-y-3 text-sm text-gray-300">
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Assets you&apos;re shopping</div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Incoming offers and counters</div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Notes &amp; constraints</div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
