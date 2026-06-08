export function RichiestaSkeleton() {
  return (
    <div className="bg-gray-800 rounded-2xl p-4 animate-pulse" aria-hidden="true">
      <div className="flex items-center justify-between mb-3">
        <div className="h-5 w-24 bg-gray-700 rounded-lg" />
        <div className="h-6 w-20 bg-gray-700 rounded-full" />
      </div>
      <div className="h-4 w-36 bg-gray-700 rounded-lg mb-2" />
      <div className="h-4 w-28 bg-gray-700 rounded-lg" />
      <div className="flex gap-2 mt-3">
        <div className="h-8 w-16 bg-gray-700 rounded-lg" />
        <div className="h-8 w-16 bg-gray-700 rounded-lg" />
        <div className="h-8 w-16 bg-gray-700 rounded-lg" />
      </div>
    </div>
  );
}

export function ListaSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <RichiestaSkeleton key={i} />
      ))}
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-gray-800 rounded-2xl p-4 animate-pulse">
          <div className="h-3 w-16 bg-gray-700 rounded mb-2" />
          <div className="h-7 w-10 bg-gray-700 rounded" />
        </div>
      ))}
    </div>
  );
}
