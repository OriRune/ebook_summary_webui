"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[var(--coral)] to-[var(--lavender)] shadow-soft" />
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="reading text-muted">
        An unexpected error occurred. Your loaded book and results are saved locally, so
        you can try again.
      </p>
      {error?.message && (
        <p className="callout reading max-w-md text-left text-muted">{error.message}</p>
      )}
      <button className="btn-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
