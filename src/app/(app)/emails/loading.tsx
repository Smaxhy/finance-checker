export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading emails">
      <div className="skeleton h-7 w-48" />
      <div className="skeleton h-4 w-96 max-w-full" />
      <div className="skeleton h-10 w-full" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-36" />
        ))}
      </div>
      <div className="skeleton h-96 w-full" />
    </div>
  );
}
