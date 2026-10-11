import ts from 'typescript';

/** Only explicitly public values can be inlined into browser/server bundles. */
export function publicBuildDefines(rawConfig, overrides = {}) {
  const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', rawConfig);
  if (parsed.error) throw new Error('Workers configuration is not valid JSONC');
  const defines = {};
  for (const key of ['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_IMAGENES_URL']) {
    const value = Object.hasOwn(overrides,key) ? overrides[key] : parsed.config.vars?.[key];
    let url;
    try {url = new URL(value);} catch {throw new Error(key + ' requires a public HTTPS URL at build time');}
    if(typeof value !== 'string' || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /\s/.test(value))
      throw new Error(key + ' requires a public HTTPS URL at build time');
    defines['process.env.'+key] = JSON.stringify(value.replace(/\/+$/, ''));
  }
  return defines;
}