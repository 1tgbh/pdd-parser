export function SkeletonLine({ width, height = 14 }: { width?: string | number; height?: number }) {
  return <div className="skeleton-line" style={{ width: width || '100%', height }} />;
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-image" />
      <div style={{ padding: '12px 16px' }}>
        <SkeletonLine width="70%" height={16} />
        <div style={{ height: 8 }} />
        <SkeletonLine width="40%" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-grid">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
