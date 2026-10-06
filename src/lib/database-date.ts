/** mysql2 Date values are already UTC; SQL aggregate strings have no timezone. */
export function databaseDate(value: string | number | Date): Date {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
  )
    return new Date(value.replace(" ", "T") + "Z");
  return new Date(value);
}
