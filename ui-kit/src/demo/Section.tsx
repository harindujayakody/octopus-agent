export default function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-surface border border-stroke-soft-200 bg-bg-white-0 p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-section-title text-text-strong-950">{title}</h2>
        {description && <p className="text-body text-text-sub-600">{description}</p>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-section-label text-text-soft-400">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
