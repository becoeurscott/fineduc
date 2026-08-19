import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * Wide tables scroll INSIDE their own container — the page body never
 * scrolls horizontally. On a 360px phone this is the difference between a
 * usable arrears list and a broken one.
 */
export function TableScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('w-full overflow-x-auto', className)}>{children}</div>
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={clsx('w-full min-w-[36rem] border-collapse text-sm', className)}>{children}</table>
}

export function Th({
  children,
  align = 'left',
  className,
  scope = 'col',
}: {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
  scope?: 'col' | 'row'
}) {
  return (
    <th
      scope={scope}
      className={clsx(
        'border-b border-line px-3 py-2.5 text-xs font-medium whitespace-nowrap text-slate',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return (
    <td
      className={clsx(
        'border-b border-line px-3 py-3 text-ink',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  )
}

export function Tr({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  if (!onClick) return <tr className={className}>{children}</tr>
  return (
    <tr
      className={clsx('cursor-pointer transition-colors hover:bg-canvas', className)}
      onClick={onClick}
      // A clickable row must be reachable and activatable by keyboard.
      tabIndex={0}
      role="link"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      {children}
    </tr>
  )
}
