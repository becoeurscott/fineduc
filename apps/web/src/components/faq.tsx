/**
 * FAQ built on native <details>/<summary>.
 *
 * No JavaScript, no accordion library: expand/collapse, keyboard support
 * and screen-reader semantics all come free from the platform, the answers
 * are present in the HTML for search engines, and it works before any
 * script loads.
 */
export function Faq({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="mx-auto mt-12 max-w-[800px] space-y-3">
      {items.map((item) => (
        <details key={item.q} className="group rounded-[var(--radius-mkt-card)] bg-[#edf1f4] px-7">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-6 text-[17px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <span
              aria-hidden="true"
              className="shrink-0 text-2xl leading-none text-slate transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="pb-6 text-[15px] leading-[1.6] text-slate">{item.a}</p>
        </details>
      ))}
    </div>
  )
}
