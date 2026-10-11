import { getCatalog } from "../../src/db/queries";
import { getNativeDb } from "./database";
import { latestCategoryProductIds } from "./latest-category-products.mjs";

export async function getLatestCategoryProducts(slugs: string[]) {
  const ids: number[] = await latestCategoryProductIds(getNativeDb().$client, slugs);
  const products = await getCatalog({productIds: ids, limit: ids.length});
  const byId = new Map(products.map(product => [product.id, product]));
  return ids.flatMap(id => { const product = byId.get(id); return product ? [{products: [product]}] : []; });
}
