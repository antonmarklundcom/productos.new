export function verifyNativePublicBundle(serverJavaScript) {
  for (const marker of ["D1_PUBLIC_CATALOG_BATCH_FAILED", "product:v1:", "category:v1:", "related:v1:", "catalog-data-v2-", "x-catalog-expires-at", "catalog-navigation-progress"])
    if (!serverJavaScript.includes(marker)) throw new Error("Workers bundle omitted public latency adapters; review aliases before deploying.");
}
/** Catch alias regressions that typechecks and direct native-domain tests miss. */
export function verifyNativeSettingsBundle(serverJavaScript) {
  const nativeContracts=["json_set","expectedSnapshot","SELECT data FROM store_settings WHERE id=1","store_settings.data=","INSERT INTO store_settings (id, data, updated_at, updated_by_user_id)","ON CONFLICT(id) DO UPDATE SET data","updated_by_user_id = excluded.updated_by_user_id","RETURNING data","AdminInputError"];
  if (nativeContracts.some(marker=>!serverJavaScript.includes(marker)) || !/updated_by_user_id = excluded\.updated_by_user_id\s+WHERE/.test(serverJavaScript))
    throw new Error("Workers bundle omitted native D1 settings writes; review adapter aliases before deploying.");
}
export function verifyNativeCatalogBundle(serverJavaScript){
  for(const marker of ["D1_CATALOG_BATCH_FAILED","Falta una foto en R2","La foto preparada tiene un formato o tamaño inválido"])
    if(!serverJavaScript.includes(marker))throw new Error("Workers bundle omitted native catalog/R2 operations; review adapter aliases before deploying.");
}
