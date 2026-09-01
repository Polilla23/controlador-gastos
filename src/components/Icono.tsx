/** Dibuja un ícono ya resuelto en el servidor. Sin pedidos a internet. */
export default function Icono({ body, viewBox = "0 0 24 24", size = 18, className }: { body: string; viewBox?: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
