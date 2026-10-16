export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <p className="mb-5 font-mono text-xs tracking-[0.2em] text-teal-300">VERTICAL SLICE 001</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">NextEra Piscine</h1>
      <p className="mt-8 flex items-center gap-3 text-lg text-lime-300">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-lime-300" />
        Foundation online
      </p>
      <p className="mt-4 max-w-lg text-base leading-7 text-slate-400">
        Learn. Solve. Submit. Build evidence of mastery.
      </p>
    </main>
  );
}
