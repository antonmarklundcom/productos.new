import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  UnauthorizedError,
  requireAdmin,
  type AdminActor,
  type AdminSession,
} from "./session";

/** Cookies prove identity; the database decides whether that identity still has access. */
export async function validateAdminSession(
  session: AdminSession
): Promise<AdminActor> {
  const actor = requireAdmin(session);
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  if (!user?.isActive || session.sessionVersion !== user.sessionVersion)
    throw new UnauthorizedError();
  return { userId: user.id, email: user.email, role: user.role };
}
