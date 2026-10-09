import { customType } from "drizzle-orm/sqlite-core";

/** UTC text preserves the existing timestamp ordering and Date-facing domain API. */
export const utcDate = customType<{ data: Date; driverData: string }>({
  dataType() { return "text"; },
  toDriver(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("Invalid UTC timestamp");
    return value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  },
  fromDriver(value) {
    const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z");
    if (Number.isNaN(parsed.getTime())) throw new Error("Invalid stored UTC timestamp");
    return parsed;
  },
});
