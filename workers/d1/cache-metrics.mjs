// Fixed numeric categories only: never record URLs, queries, identities or errors.
const names = new Set(['html_hit','html_miss','html_bypass','html_read_error','html_write_error','data_hot_hit','data_hit','data_miss','data_bypass','data_read_error','data_write_error','search_admission_bypass']);
const counters = new Map();
export function recordCacheMetric(name) {
 if (!names.has(name)) return;
 const value = Math.min(Number.MAX_SAFE_INTEGER, (counters.get(name) || 0) + 1);
 counters.set(name, value);
 // Error samples are bounded; their only payload is a fixed category and count.
 if (name.endsWith('_error') && (value === 1 || value % 100 === 0)) console.warn(JSON.stringify({event:'catalog_cache',category:name,count:value}));
}
export function cacheMetricsSnapshot() {return Object.freeze(Object.fromEntries([...names].map(name=>[name,counters.get(name)||0])));}
