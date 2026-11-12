import { cn } from '@/lib/utils'

function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/80 bg-muted/60 px-1.5 font-mono text-[10px] font-semibold text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
