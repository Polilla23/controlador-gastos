"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUser } from "./auth";
import { supabaseServer } from "./supabase";
import { removeStored, storeAvatar } from "./storage";

const refresh = () => revalidatePath("/", "layout");

/** Nombre visible y, si se adjuntó una, foto de perfil nueva (reemplaza y borra la anterior). */
export async function updateProfile(fd: FormData) {
  const user = await requireUser();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) throw new Error("Poné un nombre");

  const file = fd.get("avatar") as File | null;
  let avatarPath = user.avatarPath;
  if (file && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) throw new Error("La foto supera los 5 MB");
    const nuevo = await storeAvatar(user.id, await file.arrayBuffer(), file.type);
    if (user.avatarPath) await removeStored(user.avatarPath).catch(() => {});
    avatarPath = nuevo;
  }

  await prisma.user.update({ where: { id: user.id }, data: { name, avatarPath } });
  refresh();
}

export async function removeAvatar() {
  const user = await requireUser();
  if (user.avatarPath) await removeStored(user.avatarPath).catch(() => {});
  await prisma.user.update({ where: { id: user.id }, data: { avatarPath: null } });
  refresh();
}

/** Cambia la contraseña de la cuenta (requiere sesión activa; no hace falta la contraseña actual). */
export async function changePassword(fd: FormData) {
  await requireUser();
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password.length < 8) throw new Error("La contraseña tiene que tener al menos 8 caracteres");
  if (password !== confirm) throw new Error("Las contraseñas no coinciden");

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message || "No se pudo cambiar la contraseña");
}
