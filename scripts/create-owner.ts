import "@/lib/load-env";

import { safeError } from "../src/lib/safe-error";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { eq, sql } from "drizzle-orm";

import { closePool, getDb } from "@/db";
import { users } from "@/db/schema";
import { createUser, normalizeEmail } from "@/lib/auth";
import { hashPassword, validatePasswordStrength } from "@/lib/password";

/**
 * Crea (o actualiza la contraseña de) la cuenta del dueño.
 *
 * Esta es la única forma de que exista un usuario: **no hay ruta pública de
 * registro** (ARCH.md §1). Se puede pasar por env para automatizarlo:
 *   OWNER_EMAIL=... OWNER_PASSWORD=... pnpm create-owner
 */
async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  const email = normalizeEmail(
    process.env.OWNER_EMAIL ?? (await rl.question("Email del dueño: "))
  );
  const password =
    process.env.OWNER_PASSWORD ?? (await rl.question("Contraseña: "));
  const name = process.env.OWNER_NAME ?? null;
  rl.close();

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    throw new Error(strength.reason);
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]) {
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        role: "owner",
        isActive: true,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, existing[0].id));
    console.log(`✓ Contraseña actualizada para ${email} (role: owner)`);
  } else {
    const created = await createUser(
      { email, password, name, role: "owner" },
      db
    );
    console.log(`✓ Dueño creado: ${created.email} (id ${created.id})`);
  }

  await closePool();
}

main().catch(async (error) => {
  console.error(`✗ ${safeError(error).message}`);
  await closePool();
  process.exit(1);
});
