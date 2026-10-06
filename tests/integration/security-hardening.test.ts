import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { customers, loginTokens, users } from "@/db/schema";
import {
  authenticateCustomer,
  claimGuestOrder,
  registerCustomer,
  setCustomerActive,
} from "@/domain/customers";
import { validateCustomerSession } from "@/lib/customer-session";
import { consumeLoginToken, issueLoginToken } from "@/domain/login-tokens";
import {
  AdminUserError,
  createAdminUser,
  resetAdminUserPassword,
  setAdminUserActive,
  setAdminUserRole,
} from "@/domain/admin-users";
import { validateAdminSession } from "@/lib/session-validation";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder } from "../helpers/factories";
import { orders } from "@/db/schema";

describe.skipIf(!hasTestDb)("account ownership and revocation", () => {
  beforeEach(async () => {
    vi.stubEnv(
      "SESSION_SECRET",
      "disposable-integration-test-secret-0123456789"
    );
    await resetTables();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeTestDb();
  });
  it("first phone verification removes a squatters password and increments the session version", async () => {
    const c = await registerCustomer({
      phone: "0981123456",
      name: "Unverified registrant",
      password: "Attacker-password-2026",
    });
    const { code } = await issueLoginToken(c.id, "consola");
    expect(await consumeLoginToken(c.phone, code)).toMatchObject({
      customerId: c.id,
      passwordResetRequired: true,
    });
    expect(
      await authenticateCustomer(c.phone, "Attacker-password-2026")
    ).toBeNull();
    const [row] = await getTestDb()
      .select()
      .from(customers)
      .where(eq(customers.id, c.id));
    expect(row!.sessionVersion).toBe(c.sessionVersion + 1);
    expect(row!.passwordHash).toBeNull();
  });
  it("binds a challenge to its phone and invalidates it after five wrong guesses", async () => {
    const a = await registerCustomer({
      phone: "0981123456",
      name: "Customer A",
      password: "Customer-password-2026",
    });
    const b = await registerCustomer({
      phone: "0982123456",
      name: "Customer B",
      password: "Customer-password-2026",
    });
    const { code } = await issueLoginToken(a.id, "consola");
    expect(await consumeLoginToken(b.phone, code)).toBeNull();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let n = 0; n < 5; n++)
      expect(await consumeLoginToken(a.phone, wrong)).toBeNull();
    expect(await consumeLoginToken(a.phone, code)).toBeNull();
  });
  it("serializes concurrent challenge issuance", async () => {
    const c = await registerCustomer({
      phone: "0981123456",
      name: "Customer A",
      password: "Customer-password-2026",
    });
    await Promise.all(
      Array.from({ length: 20 }, () => issueLoginToken(c.id, "consola"))
    );
    const live = await getTestDb()
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.customerId, c.id),
          isNull(loginTokens.consumedAt),
          isNull(loginTokens.invalidatedAt)
        )
      );
    expect(live).toHaveLength(1);
  });
  it("requires the private order token even for a matching unverified phone", async () => {
    const c = await registerCustomer({
      phone: "0981123456",
      name: "Customer A",
      password: "Customer-password-2026",
    });
    const id = await createOrder({ customerPhone: c.phone });
    const [order] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, id));
    expect(await claimGuestOrder(c.id, order!.orderNumber, "")).toBe(false);
    expect(await claimGuestOrder(c.id, order!.orderNumber, "wrong")).toBe(
      false
    );
    expect(
      await claimGuestOrder(c.id, order!.orderNumber, order!.accessToken)
    ).toBe(true);
  });
  it("rejects stale admin cookies after a password reset", async () => {
    const c = await createAdminUser({
      email: "owner@example.test",
      password: "Owner-password-2026",
      role: "owner",
    });
    const cookie = {
      userId: c.id,
      email: c.email,
      role: c.role,
      sessionVersion: 1,
    };
    expect(await validateAdminSession(cookie)).toMatchObject({ userId: c.id });
    await resetAdminUserPassword({
      userId: c.id,
      password: "New-owner-password-2026",
    });
    await expect(validateAdminSession(cookie)).rejects.toThrow(
      "Necesitás iniciar sesión"
    );
  });
  it("customer and admin reactivation do not revive their old cookies", async () => {
    const c = await registerCustomer({
      phone: "0981123456",
      name: "Customer A",
      password: "Customer-password-2026",
    });
    const customerCookie = {
      customerId: c.id,
      phone: c.phone,
      name: c.name,
      sessionVersion: c.sessionVersion,
    };
    expect(await validateCustomerSession(customerCookie)).toMatchObject({
      customerId: c.id,
    });
    await setCustomerActive(c.id, false);
    await expect(validateCustomerSession(customerCookie)).rejects.toThrow(
      "Entrá a tu cuenta"
    );
    await setCustomerActive(c.id, true);
    await expect(validateCustomerSession(customerCookie)).rejects.toThrow(
      "Entrá a tu cuenta"
    );
    const owner = await createAdminUser({
      email: "first@example.test",
      password: "Owner-password-2026",
      role: "owner",
    });
    const staff = await createAdminUser({
      email: "staff@example.test",
      password: "Staff-password-2026",
      role: "staff",
    });
    const adminCookie = {
      userId: staff.id,
      email: staff.email,
      role: staff.role,
      sessionVersion: 1,
    };
    await setAdminUserActive({
      userId: staff.id,
      actingUserId: owner.id,
      isActive: false,
    });
    await setAdminUserActive({
      userId: staff.id,
      actingUserId: owner.id,
      isActive: true,
    });
    await expect(validateAdminSession(adminCookie)).rejects.toThrow(
      "Necesitás iniciar sesión"
    );
  });
});

describe.skipIf(!hasTestDb)("last active owner concurrency", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);
  for (const mode of ["active", "role", "mixed"] as const) {
    it(`preserves one owner during concurrent ${mode} changes`, async () => {
      const a = await createAdminUser({
        email: "a@example.test",
        password: "Owner-password-2026",
        role: "owner",
      });
      const b = await createAdminUser({
        email: "b@example.test",
        password: "Owner-password-2026",
        role: "owner",
      });
      for (let n = 0; n < 20; n++) {
        await getTestDb().update(users).set({ role: "owner", isActive: true });
        const left =
          mode === "role"
            ? setAdminUserRole({
                userId: b.id,
                actingUserId: a.id,
                role: "staff",
              })
            : setAdminUserActive({
                userId: b.id,
                actingUserId: a.id,
                isActive: false,
              });
        const right =
          mode === "active"
            ? setAdminUserActive({
                userId: a.id,
                actingUserId: b.id,
                isActive: false,
              })
            : setAdminUserRole({
                userId: a.id,
                actingUserId: b.id,
                role: "staff",
              });
        const results = await Promise.allSettled([left, right]);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
        for (const r of results)
          if (r.status === "rejected")
            expect(r.reason).toBeInstanceOf(AdminUserError);
        expect(
          await getTestDb()
            .select()
            .from(users)
            .where(and(eq(users.role, "owner"), eq(users.isActive, true)))
        ).toHaveLength(1);
      }
    });
  }
});
