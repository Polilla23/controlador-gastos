import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la cookie de sesión y protege las rutas privadas.
 *
 * Usa getClaims(), que verifica el JWT localmente con la clave pública del proyecto
 * (ES256). getUser() haría una llamada de red a Supabase en cada request —incluidas
 * las de navegación y las de cada acción—, y eso se notaba en cada click.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all) => {
        all.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;
  const { pathname } = request.nextUrl;
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/api/telegram") || pathname.startsWith("/api/cron");

  if (!signedIn && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  if (signedIn && pathname.startsWith("/login")) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
