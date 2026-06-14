import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[var(--coral)] to-[var(--lavender)] shadow-soft" />
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="reading text-muted">
        That page doesn&apos;t exist. Head back to the summarizer to get started.
      </p>
      <Link href="/" className="btn-primary">
        Back to the app
      </Link>
    </main>
  );
}
