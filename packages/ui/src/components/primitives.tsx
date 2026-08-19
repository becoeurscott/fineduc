import clsx from 'clsx'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/* ------------------------------------------------------------------ Card */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...props} />
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('p-4 sm:p-5', className)} {...props} />
}

/* ---------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-muted disabled:bg-slate-muted',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas',
  ghost: 'text-slate hover:bg-canvas hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-95',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  /** Renders a spinner and blocks interaction. Money actions use this instead of optimistic UI. */
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      // 44px min height at md: a cashier taps this on a phone, fast, repeatedly.
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-sm',
        BUTTON_VARIANT[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  )
}

/* ----------------------------------------------------------------- Badge */

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'bg-canvas text-slate border-line',
  accent: 'bg-accent-soft text-accent-deep border-accent-soft',
  positive: 'bg-positive-soft text-positive border-positive-soft',
  warning: 'bg-warning-soft/30 text-warning border-warning-soft',
  danger: 'bg-danger-soft/20 text-danger border-danger-soft',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_TONE[tone],
      )}
    >
      {children}
    </span>
  )
}

/* ----------------------------------------------------------------- Input */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink',
        'placeholder:text-slate-muted focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink',
        'focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-muted">{hint}</span>
      ) : null}
    </label>
  )
}

/* ------------------------------------------------------------- Feedback */

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-line/70', className)} aria-hidden="true" />
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-danger">{title}</p>
      {detail ? <p className="mt-1 max-w-sm text-sm text-slate">{detail}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Réessayer
        </Button>
      ) : null}
    </div>
  )
}
