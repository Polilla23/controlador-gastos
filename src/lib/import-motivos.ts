/** Parte pura (sin base de datos) del estado de los renglones de una importación: la usan el servidor y la pantalla. */

/** Motivo de los renglones que el usuario dejó afuera a propósito (no cuentan como abiertos). */
export const MOTIVO_OMITIDO = "Omitido a mano";

/** Un renglón "abierto" todavía se puede importar: listo, posible duplicado u omitido por moneda (no a propósito). */
export const esAbierto = (i: { status: string; skipReason: string | null }) => i.status === "PENDING" || i.status === "POSSIBLE_DUP" || (i.status === "SKIPPED" && i.skipReason !== MOTIVO_OMITIDO);
