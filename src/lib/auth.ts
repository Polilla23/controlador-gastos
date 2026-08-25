import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { supabaseServer } from "./supabase";
import { DEFAULT_CATEGORIES } from "./defaults";

/**
 * Current user's id, or null.
 *
 * Uses getClaims() so the JWT is verified locally when the project uses asymmetric
 * signing keys — no round-trip to Supabase on every request, which is what made
 * navigation feel sluggish. cache() dedupes it across a single render pass.
 */
export const currentUserId = cache(async (): Promise<string | null> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return claims.sub;
});

/** Local user row, created on first login together with default categories and an account. */
export const currentUser = cache(async () => {
  const id = await currentUserId();
  if (!id) return null;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (existing) return existing;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const parents = DEFAULT_CATEGORIES.filter((c) => !c.parent);
  const created = await prisma.user.create({
    data: {
      id: user.id,
      email: user.email ?? "",
      name: (user.user_metadata?.name as string | undefined) ?? "",
      accounts: { create: [{ name: "Efectivo", type: "CASH", currency: "ARS", color: "#1A9D76" }] },
      categories: { create: parents.map((c, i) => ({ ...c, parent: undefined, sortOrder: i })) },
    },
    include: { categories: true },
  });

  // Second pass: subcategories need their parent's generated id.
  const byName = new Map(created.categories.map((c) => [c.name, c.id]));
  const kids = DEFAULT_CATEGORIES.filter((c) => c.parent);
  if (kids.length) {
    await prisma.category.createMany({
      data: kids.map(({ parent, ...c }, i) => ({ ...c, userId: created.id, sortOrder: i, parentId: byName.get(parent!) ?? null })),
    });
  }
  return prisma.user.findUnique({ where: { id: created.id } });
});

/** For pages and actions: redirects to /login when signed out. */
export async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user.id;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
