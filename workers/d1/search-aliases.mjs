// Whole-query aliases for the native storefront. Keep expansions small and
// directional when the terms are not interchangeable (for example typos).
export const catalogSearchAliases = new Map([
  ["air fryer", ["freidora aire"]],
  ["freidora", ["air fryer"]],
  ["fridora", ["freidora"]],
]);
