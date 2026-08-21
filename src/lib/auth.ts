import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { supabaseServer } from "./supabase";
import { DEFAULT_CATEGORIES } from "./defaults";

/** Current user's id, or null. Creates the local User row (and default categories) on first login. */
export const currentUserId = cache(async (): Promise<string | null> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
  if (!existing) {
    await prisma.user.create({
      data: {
        id: user.id,
        email: user.email ?? "",
        name: (user.user_metadata?.name as string | undefined) ?? "",
        categories: { create: DEFAULT_CATEGORIES },
        accounts: { create: [{ name: "Efectivo", type: "CASH", currency: "ARS", color: "#1A9D76" }] },
      },
    });
  }
  return user.id;
});

/** For pages and actions: redirects to /login when signed out. */
export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) redirect("/login");
  return id;
}
