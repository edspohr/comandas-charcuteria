// Compact inline banner for query / listener failures. Reused across
// routes that render lists driven by onSnapshot hooks.
export default function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="eyebrow text-red-700 mb-1">Error</p>
      <p>{message}</p>
    </div>
  );
}
