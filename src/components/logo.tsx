export function Logo({ size = 30, withText = true, textClass = '' }: { size?: number; withText?: boolean; textClass?: string }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="5" fill="#D97706" />
        <path d="M9 10L16 23L23 10" stroke="#141110" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter" fill="none" />
        <rect x="9" y="8.6" width="3.2" height="3.2" fill="#141110" />
        <rect x="19.8" y="8.6" width="3.2" height="3.2" fill="#141110" />
      </svg>
      {withText && (
        <div className={`leading-tight ${textClass}`}>
          <div className="font-semibold tracking-tight text-[14px]">ValencyStudio</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">File Manager</div>
        </div>
      )}
    </div>
  )
}
