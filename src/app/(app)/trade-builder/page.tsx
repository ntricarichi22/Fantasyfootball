export default function TradeBuilderPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0c10] px-4 py-10 text-white">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900 via-gray-950 to-black p-8 shadow-2xl shadow-red-500/10">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.25em] text-gray-400">Trade Tools</p>
          <span className="rounded-full bg-red-600/20 px-3 py-1 text-[11px] font-semibold text-red-200">
            Experimental
          </span>
        </div>
        <h1 className="text-3xl font-bold text-white">Manual Trade Builder (Coming Soon)</h1>
        <p className="mt-3 text-lg text-gray-300">
          A dedicated workspace to craft custom trades, compare scenarios, and sync with league
          partners. Hang tight while we finish the build.
        </p>
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
          <p className="font-semibold text-white">What to expect</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>Side-by-side give/get builders with live value tracking.</li>
            <li>Save drafts, share proposals, and push to league when ready.</li>
            <li>AI nudges to balance offers and spot win-win opportunities.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
