/**
 * `sticky` clava el título y los controles (filtros, período, etc.) arriba de la pantalla al
 * hacer scroll, así se pueden cambiar sin tener que volver a subir. Sólo se usa en las pantallas
 * con una barra de filtros larga (Resumen, Transacciones) -- el resto no lo necesita.
 */
export default function PageHeader({ title, subtitle, children, sticky = false }: { title: string; subtitle?: string; children?: React.ReactNode; sticky?: boolean }) {
  return (
    <div
      className={
        sticky
          ? "sticky top-14 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 bg-bg py-3 max-sm:justify-center max-sm:text-center md:top-0"
          : "mb-5 flex flex-wrap items-center justify-between gap-3 max-sm:justify-center max-sm:text-center"
      }
    >
      <div className={sticky ? "max-sm:hidden" : undefined}>
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 max-sm:justify-center sm:w-auto">{children}</div>}
    </div>
  );
}
