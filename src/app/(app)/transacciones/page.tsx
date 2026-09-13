import { Plus, Search } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { accountLabel, money, resolveRange, TX_TYPES } from "@/lib/format";
import { statementLabel } from "@/lib/tarjetas";
import PageHeader from "@/components/PageHeader";
import RangePicker from "@/components/RangePicker";
import Modal from "@/components/Modal";
import TransactionForm from "@/components/TransactionForm";
import TransactionsTable from "@/components/TransactionsTable";
import SavedFilters from "@/components/SavedFilters";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import StickyFilters from "@/components/StickyFilters";
import { cotizaciones } from "@/lib/cotizaciones";

type SP = Record<string, string | string[] | undefined>;
const asList = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const asOne = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TransaccionesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const range = resolveRange(sp as Record<string, string | undefined>);

  const cuentaIds = asList(sp.cuenta).map(Number).filter((n) => !Number.isNaN(n));
  const categoriaIds = asList(sp.categoria).map(Number).filter((n) => !Number.isNaN(n));
  const etiquetaIds = asList(sp.etiqueta).map(Number).filter((n) => !Number.isNaN(n));
  const personas = asList(sp.persona);
  const resumen = asOne(sp.resumen);

  const where: Prisma.TransactionWhereInput = { userId, date: { gte: range.start, lt: range.end } };
  if (sp.tipo) where.type = asOne(sp.tipo);
  if (cuentaIds.length === 1) where.accountId = cuentaIds[0];
  else if (cuentaIds.length > 1) where.accountId = { in: cuentaIds };
  if (categoriaIds.length === 1) where.categoryId = categoriaIds[0];
  else if (categoriaIds.length > 1) where.categoryId = { in: categoriaIds };
  if (etiquetaIds.length === 1) where.tags = { some: { id: etiquetaIds[0] } };
  else if (etiquetaIds.length > 1) where.tags = { some: { id: { in: etiquetaIds } } };
  if (personas.length === 1) where.counterparty = personas[0];
  else if (personas.length > 1) where.counterparty = { in: personas };
  if (resumen) where.statementMonth = resumen;
  if (sp.q) {
    const q = asOne(sp.q)!;
    where.OR = [{ description: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } }];
  }

  const [rows, accounts, categories, tags, filtros, previos] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 300,
      include: { account: true, toAccount: true, category: true, tags: true, attachments: true },
    }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.savedFilter.findMany({ where: { userId, scope: "TX" }, orderBy: { name: "asc" } }),
    prisma.transaction.findMany({
      where: { userId, counterparty: { not: "" } },
      distinct: ["counterparty"],
      select: { counterparty: true },
      orderBy: { counterparty: "asc" },
      take: 200,
    }),
  ]);
  const counterparties = previos.map((p) => p.counterparty);

  // Si eligieron una sola tarjeta de crédito, ofrecemos filtrar por resumen ("paga octubre de 2026").
  const singleAccount = cuentaIds.length === 1 ? accounts.find((a) => a.id === cuentaIds[0]) : undefined;
  const statementMonths =
    singleAccount?.type === "CREDIT_CARD"
      ? (
          await prisma.transaction.findMany({
            where: { userId, accountId: singleAccount.id, statementMonth: { not: null } },
            distinct: ["statementMonth"],
            select: { statementMonth: true },
            orderBy: { statementMonth: "desc" },
          })
        )
          .map((r) => r.statementMonth!)
          .filter(Boolean)
      : [];

  // Cotizaciones cacheadas, para elegir con qué convertir en un cambio de moneda (no bloquea la página si falla).
  const { lista: quotes } = await cotizaciones();

  const totals = rows.reduce<Record<string, { income: number; expense: number }>>((acc, t) => {
    if (t.type === "TRANSFER") return acc;
    acc[t.currency] ??= { income: 0, expense: 0 };
    acc[t.currency][t.type === "INCOME" ? "income" : "expense"] += t.amount;
    return acc;
  }, {});

  return (
    <>
      <StickyFilters scope="TX" />
      <PageHeader title="Transacciones" subtitle={`${rows.length} registros · ${range.label}`} sticky>
        <RangePicker range={range} />
        <SavedFilters filtros={filtros.map((f) => ({ id: f.id, name: f.name, query: f.query as Record<string, string | string[]> }))} scope="TX" />
        <Modal title="Nuevo registro" trigger={<><Plus size={16} /> <span className="hidden sm:inline">Nuevo</span></>}>
          <TransactionForm accounts={accounts} categories={categories} tags={tags} counterparties={counterparties} quotes={quotes} />
        </Modal>
      </PageHeader>

      {Object.keys(totals).length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(totals).map(([cur, v]) => (
            <div key={cur} className="card">
              <div className="kpi-label">Balance {cur}</div>
              <div className={`kpi-value ${v.income - v.expense < 0 ? "text-red-500" : "text-brand-500"}`}>{money(v.income - v.expense, cur)}</div>
              <div className="mt-1 text-xs text-muted">
                +{money(v.income, cur)} · -{money(v.expense, cur)}
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="card mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-8 xl:items-end">
        <input type="hidden" name="preset" value={range.preset} />
        <input type="hidden" name="ancla" value={range.anchor} />
        {range.preset === "rango" && (
          <>
            <input type="hidden" name="desde" value={range.start.toISOString().slice(0, 10)} />
            <input type="hidden" name="hasta" value={new Date(range.end.getTime() - 86400000).toISOString().slice(0, 10)} />
          </>
        )}
        <div>
          <label className="label">Buscar</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" className="input pl-9" defaultValue={asOne(sp.q) ?? ""} placeholder="Descripción o nota" />
          </div>
        </div>
        <MultiSelectFilter name="persona" label="Persona" initial={personas} options={counterparties.map((c) => ({ id: c, label: c }))} />
        <div>
          <label className="label">Tipo</label>
          <select name="tipo" className="input" defaultValue={asOne(sp.tipo) ?? ""}>
            <option value="">Todos</option>
            {Object.entries(TX_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <MultiSelectFilter
          name="cuenta"
          label="Cuenta"
          initial={cuentaIds}
          options={accounts.map((a) => ({ id: a.id, label: accountLabel(a) }))}
        />
        <MultiSelectFilter
          name="categoria"
          label="Categoría"
          initial={categoriaIds}
          options={categories
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, "es"))
            .map((c) => ({ id: c.id, label: c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}` : c.name }))}
        />
        <MultiSelectFilter name="etiqueta" label="Etiqueta" initial={etiquetaIds} options={tags.map((t) => ({ id: t.id, label: `#${t.name}` }))} />
        {statementMonths.length > 0 && (
          <div>
            <label className="label">Resumen de tarjeta</label>
            <select name="resumen" className="input" defaultValue={resumen ?? ""}>
              <option value="">Todos</option>
              {statementMonths.map((m) => (
                <option key={m} value={m}>
                  {statementLabel(m)}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="btn-primary">
          Filtrar
        </button>
      </form>

      <TransactionsTable rows={rows} accounts={accounts} categories={categories} tags={tags} quotes={quotes} />
      {rows.length === 300 && <p className="mt-3 text-center text-xs text-muted">Se muestran los 300 registros más recientes del período. Acotá el rango para ver el resto.</p>}
    </>
  );
}
