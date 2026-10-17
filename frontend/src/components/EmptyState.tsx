interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}

export default function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon || (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="empty-state-icon">
          <rect x="6" y="10" width="36" height="28" rx="4" stroke="var(--brand-gray-4)" strokeWidth="2"/>
          <path d="M6 18h36" stroke="var(--brand-gray-4)" strokeWidth="2"/>
          <circle cx="14" cy="14" r="2" fill="var(--brand-gray-4)"/>
          <circle cx="20" cy="14" r="2" fill="var(--brand-gray-4)"/>
          <path d="M16 28l6-6 4 4 6-6" stroke="var(--brand-gray-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
    </div>
  );
}
