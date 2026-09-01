"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Coins, LineChart, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import { deleteHolding, deleteInvestMove, saveHolding, saveInvestMove, setHoldingPrice } from "@/lib/actions-inversiones";
import { CURRENCIES, fmtDate, money, toInputDate } from "@/lib/format";

const INSTRUMENTOS: Record<string, string> = {
  ACCION: "Acciones",
  CEDEAR: "CEDEARs",
  BONO: "Bonos",
  LETRA: "Letras",
  ON: "Obligaciones negociables",
  FCI: "Fondos comunes (FCI)",
  PLAZO_FIJO: "Plazo fijo",
  CAUCION: "Caución",
  CRIPTO: "Cripto",
  OTRO: "Otro",
};

const MOVIMIENTOS: Record<string, string> = {
  BUY: "Compra",
  SELL: "Venta",
  DEPOSIT: "Aporte de dinero",
  WITHDRAW: "Retiro de dinero",
  INCOME: "Renta / dividendo",
  FEE: "Comisión",
};

type Tenencia = {
  id: number;
  accountId: number;
  kind: string;
  ticker: string;
  name: string;
  currency: string;
  rate: number | null;
  maturity: Date | null;
  lastPrice: number | null;
  priceAt: Date | null;
  note: string;
  cantidad: number;
  invertido: number;
  rentas: number;
  costoPromedio: number | null;
  costoDeLoQueQueda: number | null;
  valorActual: number | null;
  ganancia: number | null;
  gananciaPct: number | null;
};

type Movimiento = { id: number; type: string; quantity: number | null; price: number | null; amount: number; currency: string; date: Date; note: string; holdingId: number | null };

export type CuentaInversion = {
  id: number;
  name: string;
  currency: string;
  color: string;
  efectivo: number;
  valorCartera: number;
  total: number;
  conPrecio: boolean;
  tenencias: Tenencia[];
  abiertas: Tenencia[];
  movimientos: Movimiento[];
};

export type Cartera = {
  cuentas: CuentaInversion[];
  total: number;
  efectivoTotal: number;
  carteraTotal: number;
  porInstrumento: { kind: string; nombre: string; valor: number }[];
};

function InstrumentoForm({ cuenta, h }: { cuenta: CuentaInversion; h?: Tenencia }) {
  const [kind, setKind] = useState(h?.kind ?? "CEDEAR");
  const rentaFija = ["PLAZO_FIJO", "CAUCION", "LETRA", "BONO", "ON"].includes(kind);
  return (
    <ActionForm action={saveHolding} submitLabel={h ? "Guardar" : "Agregar instrumento"}>
      {h && <input type="hidden" name="id" value={h.id} />}
      <input type="hidden" name="accountId" value={cuenta.id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Tipo de instrumento</label>
          <select name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(INSTRUMENTOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Ticker / símbolo</label>
          <input name="ticker" className="input" defaultValue={h?.ticker} placeholder="Ej: AAPL" />
        </div>
      </div>
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={h?.name} placeholder="Ej: CEDEAR Apple Inc." />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={h?.currency ?? cuenta.currency}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {rentaFija && (
          <div>
            <label className="label">Tasa anual (%)</label>
            <input name="rate" type="number" step="0.01" className="input" defaultValue={h?.rate ?? ""} placeholder="Ej: 35" />
          </div>
        )}
      </div>
      {rentaFija && (
        <div>
          <label className="label">Vencimiento</label>
          <input name="maturity" type="date" className="input" defaultValue={h?.maturity ? toInputDate(new Date(h.maturity)) : ""} />
        </div>
      )}
      <div>
        <label className="label">Nota</label>
        <input name="note" className="input" defaultValue={h?.note} />
      </div>
    </ActionForm>
  );
}

function MovimientoForm({ cuenta, m }: { cuenta: CuentaInversion; m?: Movimiento }) {
  const [type, setType] = useState(m?.type ?? "BUY");
  const [cantidad, setCantidad] = useState(m?.quantity?.toString() ?? "");
  const [precio, setPrecio] = useState(m?.price?.toString() ?? "");
  const conInstrumento = type === "BUY" || type === "SELL";
  const calculado = Number(cantidad) > 0 && Number(precio) > 0 ? Math.round(Number(cantidad) * Number(precio) * 100) / 100 : null;

  return (
    <ActionForm action={saveInvestMove} submitLabel={m ? "Guardar" : "Agregar movimiento"}>
      {m && <input type="hidden" name="id" value={m.id} />}
      <input type="hidden" name="accountId" value={cuenta.id} />

      <div>
        <label className="label">Tipo de movimiento</label>
        <select name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(MOVIMIENTOS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {conInstrumento && (
        <>
          <div>
            <label className="label">Instrumento</label>
            <select name="holdingId" className="input" defaultValue={m?.holdingId ?? ""} required>
              <option value="">Elegí uno</option>
              {cuenta.tenencias.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.ticker ? `${h.ticker} · ` : ""}
                  {h.name}
                </option>
              ))}
            </select>
            {cuenta.tenencias.length === 0 && <p className="mt-1 text-xs text-amber-600">Primero agregá un instrumento a esta cuenta.</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Cantidad</label>
              <input name="quantity" type="number" step="0.0001" min="0" className="input" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            </div>
            <div>
              <label className="label">Precio unitario</label>
              <input name="price" type="number" step="0.0001" min="0" className="input" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Monto total</label>
          <MoneyInput key={`m-${calculado ?? "x"}`} name="amount" required defaultValue={calculado ?? m?.amount} />
          {calculado != null && <p className="mt-1 text-xs text-muted">Cantidad × precio = {money(calculado, cuenta.currency)}</p>}
        </div>
        <div>
          <label className="label">Fecha</label>
          <input name="date" type="date" required className="input" defaultValue={toInputDate(m?.date ? new Date(m.date) : new Date())} />
        </div>
      </div>

      <input type="hidden" name="currency" value={cuenta.currency} />
      <div>
        <label className="label">Nota</label>
        <input name="note" className="input" defaultValue={m?.note} />
      </div>
    </ActionForm>
  );
}

export default function InvestmentsBoard({ cartera }: { cartera: Cartera }) {
  if (cartera.cuentas.length === 0) {
    return (
      <div className="card py-10 text-center text-sm text-muted">
        Todavía no tenés cuentas de inversión. Creá una en{" "}
        <Link href="/cuentas" className="font-medium text-brand-500 hover:underline">
          Cuentas
        </Link>{" "}
        eligiendo el tipo <b>Cuenta de inversión</b> (por ejemplo, tu cuenta de Balanz) y después cargás acá los instrumentos y los movimientos.
      </div>
    );
  }

  const maxInstr = Math.max(...cartera.porInstrumento.map((i) => i.valor), 1);

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="kpi-label">Total invertido</div>
          <div className="kpi-value">{money(cartera.total, cartera.cuentas[0].currency)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Efectivo disponible</div>
          <div className="kpi-value">{money(cartera.efectivoTotal, cartera.cuentas[0].currency)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Valor del portafolio</div>
          <div className="kpi-value text-brand-500">{money(cartera.carteraTotal, cartera.cuentas[0].currency)}</div>
        </div>
      </div>

      {cartera.porInstrumento.length > 0 && (
        <div className="card mb-5">
          <h2 className="mb-3 font-bold">Composición del portafolio</h2>
          <ul className="space-y-3">
            {cartera.porInstrumento.map((i) => (
              <li key={i.kind}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{i.nombre}</span>
                  <b>{money(i.valor, cartera.cuentas[0].currency)}</b>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(i.valor / maxInstr) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-5">
        {cartera.cuentas.map((c) => (
          <section key={c.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: c.color }}>
                  <LineChart size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{c.name}</h2>
                  <p className="text-xs text-muted">
                    Efectivo {money(c.efectivo, c.currency)} · portafolio {money(c.valorCartera, c.currency)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{money(c.total, c.currency)}</span>
                <Modal title={`Nuevo instrumento en ${c.name}`} triggerClassName="btn-ghost" trigger={<><Tag size={15} /> Instrumento</>}>
                  <InstrumentoForm cuenta={c} />
                </Modal>
                <Modal title={`Nuevo movimiento en ${c.name}`} trigger={<><Plus size={15} /> Movimiento</>}>
                  <MovimientoForm cuenta={c} />
                </Modal>
              </div>
            </div>

            {!c.conPrecio && c.abiertas.length > 0 && (
              <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
                Para ver el rendimiento, cargá el precio actual de cada tenencia con el botón <b>Precio</b>. Mientras tanto se muestra lo que invertiste.
              </p>
            )}

            {c.abiertas.length > 0 && (
              <div className="mt-4">
                <h3 className="label">Tenencias</h3>
                <ul className="space-y-2">
                  {c.abiertas.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {h.ticker && <span className="mr-1 font-mono text-xs text-muted">{h.ticker}</span>}
                          {h.name}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {INSTRUMENTOS[h.kind]} · {h.cantidad} unidades
                          {h.costoPromedio != null ? ` · costo ${money(h.costoPromedio, h.currency)}` : ""}
                          {h.rate ? ` · ${h.rate}% anual` : ""}
                          {h.maturity ? ` · vence ${fmtDate(h.maturity)}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right">
                          <div className="text-sm font-bold">{money(h.valorActual ?? h.costoDeLoQueQueda ?? 0, h.currency)}</div>
                          {h.ganancia != null && (
                            <div className={`text-xs font-semibold ${h.ganancia >= 0 ? "text-brand-500" : "text-red-500"}`}>
                              {h.ganancia >= 0 ? "+" : ""}
                              {money(h.ganancia, h.currency)} ({h.gananciaPct}%)
                            </div>
                          )}
                        </div>
                        <Modal title={`Precio de ${h.name}`} triggerClassName="btn-ghost" trigger={<Coins size={15} />}>
                          <ActionForm action={setHoldingPrice} submitLabel="Guardar precio">
                            <input type="hidden" name="id" value={h.id} />
                            <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
                              Cargá el precio actual de una unidad. Con eso calculamos cuánto vale hoy tu tenencia y cuánto ganaste o perdiste.
                              {h.priceAt && <span className="mt-1 block text-xs">Último cargado el {fmtDate(h.priceAt)}.</span>}
                            </p>
                            <div>
                              <label className="label">Precio por unidad ({h.currency})</label>
                              <MoneyInput name="lastPrice" required defaultValue={h.lastPrice ?? undefined} />
                            </div>
                          </ActionForm>
                        </Modal>
                        <Modal title={`Editar ${h.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                          <InstrumentoForm cuenta={c} h={h} />
                        </Modal>
                        <ConfirmButton action={async () => deleteHolding(h.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar ${h.name} y sus movimientos?`}>
                          <Trash2 size={15} />
                        </ConfirmButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {c.movimientos.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-500">Ver los {c.movimientos.length} movimientos</summary>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {c.movimientos.map((m) => {
                    const entra = m.type === "DEPOSIT" || m.type === "SELL" || m.type === "INCOME";
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {entra ? <ArrowDownLeft size={14} className="shrink-0 text-brand-500" /> : <ArrowUpRight size={14} className="shrink-0 text-red-500" />}
                          <span className="min-w-0">
                            <span className="block truncate">
                              {MOVIMIENTOS[m.type]}
                              {m.quantity ? ` · ${m.quantity} × ${money(m.price ?? 0, m.currency)}` : ""}
                            </span>
                            <span className="block text-xs text-muted">
                              {fmtDate(m.date)}
                              {m.note ? ` · ${m.note}` : ""}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <b className={entra ? "text-brand-500" : "text-red-500"}>
                            {entra ? "+" : "-"}
                            {money(m.amount, m.currency)}
                          </b>
                          <Modal title="Editar movimiento" triggerClassName="btn-icon" trigger={<Pencil size={14} />}>
                            <MovimientoForm cuenta={c} m={m} />
                          </Modal>
                          <ConfirmButton action={async () => deleteInvestMove(m.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este movimiento?">
                            <Trash2 size={14} />
                          </ConfirmButton>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
