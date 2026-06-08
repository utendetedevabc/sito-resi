interface SafeAreaProps {
  children: React.ReactNode;
  className?: string;
}

export default function SafeArea({ children, className = '' }: SafeAreaProps) {
  return (
    <div
      className={`pt-safe pb-safe px-safe ${className}`}
    >
      {children}
    </div>
  );
}
