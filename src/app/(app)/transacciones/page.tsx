import { Plus } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { accountLabel, money, resolveRange, EMPTY_FILTER, TX_TYPES } from "@/lib/format";
import { statementLabel } from "@/lib/tarjetas";
import PageHeader from "@/components/PageHeader";
import RangePicker from "@/components/RangePicker";
import Modal from "@/components/Modal";
import TransactionForm from "@/components/TransactionForm";
import TransactionsTable from "@/components/TransactionsTable";
import SavedFilters from "@/components/SavedFilters";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import TextOrEmptyFilter from "@/components/TextOrEmptyFilter";
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
  const categoriaRaw = asList(sp.categoria);
  const categoriaIds = categoriaRaw.map(Number).filter((n) => !Number.isNaN(n));
  const categoriaVacia = categoriaRaw.includes(EMPTY_FILTER);
  const etiquetaRaw = asList(sp.etiqueta);
  const etiquetaIds = etiquetaRaw.map(Number).filter((n) => !Number.isNaN(n));
  const etiquetaVacia = etiquetaRaw.includes(EMPTY_FILTER);
  const personaRaw = asOne(sp.persona) ?? "";
  const personaVacia = personaRaw === EMPTY_FILTER;
  const persona = personaVacia ? "" : personaRaw;
  const qRaw = asOne(sp.q) ?? "";
  const descripcionVacia = qRaw === EMPTY_FILTER;
  const resumen = asOne(sp.resumen);

  // Cada condición que necesita un OR interno (ej. "categoría X o sin categoría") se junta acá en
  // vez de pisar `where.OR` directo, porque puede haber más de una a la vez (categoría, etiqueta y
  // la búsqueda de texto son independientes entre sí).
  const and: Prisma.TransactionWhereInput[] = [];
  const where: Prisma.TransactionWhereInput = { userId, date: { gte: range.start, lt: range.end } };
  if (sp.tipo) where.type = asOne(sp.tipo);
  if (cuentaIds.length === 1) where.accountId = cuentaIds[0];
  else if (cuentaIds.length > 1) where.accountId = { in: cuentaIds };

  if (categoriaVacia && categoriaIds.length) and.push({ OR: [{ categoryId: { in: categoriaIds } }, { categoryId: null }] });
  else if (categoriaVacia) where.categoryId = null;
  else if (categoriaIds.length === 1) where.categoryId = categoriaIds[0];
  else if (categoriaIds.length > 1) where.categoryId = { in: categoriaIds };

  if (etiquetaVacia && etiquetaIds.length) and.push({ OR: [{ tags: { some: { id: { in: etiquetaIds } } } }, { tags: { none: {} } }] });
  else if (etiquetaVacia) where.tags = { none: {} };
  else if (etiquetaIds.length === 1) where.tags = { some: { id: etiquetaIds[0] } };
  else if (etiquetaIds.length > 1) where.tags = { some: { id: { in: etiquetaIds } } };

  if (personaVacia) where.counterparty = "";
  else if (persona) where.counterparty = { contains: persona, mode: "insensitive" };
  if (resumen) where.statementMonth = resumen;
  if (descripcionVacia) where.description = "";
  else if (qRaw) and.push({ OR: [{ description: { contains: qRaw, mode: "insensitive" } }, { note: { contains: qRaw, mode: "insensitive" } }] });
  if (and.length) where.AND = and;

  const [rows, accounts, categories, tags, filtros, previos, budgets] = await Promise.all([
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
    prisma.budget.findMany({ where: { userId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
        <Modal title="Nuevo registro" triggerClassName="btn-primary hidden md:inline-flex" trigger={<><Plus size={16} /> Nuevo registro</>}>
          <TransactionForm accounts={accounts} categories={categories} tags={tags} counterparties={counterparties} budgets={budgets} quotes={quotes} />
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
        <TextOrEmptyFilter name="q" label="Buscar" initial={qRaw} placeholder="Descripción o nota" />
        <TextOrEmptyFilter name="persona" label="Persona" initial={personaRaw} placeholder="Nombre o apellido" list="personas-conocidas" />
        <datalist id="personas-conocidas">
          {counterparties.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
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
          initial={categoriaRaw}
          options={[
            { id: EMPTY_FILTER, label: "(Sin categoría)" },
            ...categories
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, "es"))
              .map((c) => ({ id: c.id, label: c.name, parentId: c.parentId })),
          ]}
        />
        <MultiSelectFilter
          name="etiqueta"
          label="Etiqueta"
          initial={etiquetaRaw}
          options={[{ id: EMPTY_FILTER, label: "(Sin etiqueta)" }, ...tags.map((t) => ({ id: t.id, label: `#${t.name}` }))]}
        />
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

      <TransactionsTable rows={rows} accounts={accounts} categories={categories} tags={tags} budgets={budgets} quotes={quotes} />
      {rows.length === 300 && <p className="mt-3 text-center text-xs text-muted">Se muestran los 300 registros más recientes del período. Acotá el rango para ver el resto.</p>}
    </>
  );
}
