export default function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 max-sm:justify-center max-sm:text-center">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 max-sm:justify-center sm:w-auto">{children}</div>}
    </div>
  );
}
