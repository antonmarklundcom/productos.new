import {readBatch, catalogRead} from "./public-catalog-sql.mjs";
import {displayedPriceSql} from "./display-price-sql.mjs";
import {normalizedSearchSqlExpression, foldSearchTerm, normalizeSearchTerm} from "./search-normalization.mjs";
export {foldSearchTerm, normalizeSearchTerm};
const literalLike = value => value.replace(/[!%_]/g, value => "!" + value);
export function searchPlan(term, options = {}, precomputed = true) {
 const page = Number.isSafeInteger(options.page) && options.page > 1 ? options.page : 1;
 const perPage = Number.isSafeInteger(options.perPage) ? Math.min(60,Math.max(1,options.perPage)) : 40;
 const cleaned = normalizeSearchTerm(term), tokens = [...new Set(cleaned.split(" ").filter(Boolean))];
 const empty = {products:[],total:0,page,perPage,totalPages:1};
 if (cleaned.length < 2 || cleaned.length > 160 || tokens.length > 12) return {empty};
 const fields = precomputed ? ["p.search_name","p.search_brand","p.search_description"] : ["p.name","p.brand","p.description"].map(normalizedSearchSqlExpression);
 const where = ["p.is_active = 1 AND p.published_at IS NOT NULL AND c.is_active = 1",
   ...tokens.map(() => "(" + fields.map(field => field + " LIKE ? ESCAPE '!'").join(" OR ") + ")")];
 const args = tokens.flatMap(token => fields.map(() => "%" + literalLike(token) + "%"));
 const baseFrom = "FROM products p JOIN categories c ON c.id = p.category_id WHERE " + where.join(" AND ");
 const baseArgs = [...args];
 if (options.categorySlug) {where.push("c.slug = ?"); args.push(options.categorySlug);}
 if (options.brand) {where.push("p.brand = ?"); args.push(options.brand);}
 const price = displayedPriceSql();
 for (const [key, op] of [["minPricePyg", ">="],["maxPricePyg", "<="]]) {
  if (options[key] !== undefined) {
   if (!Number.isSafeInteger(options[key]) || options[key] < 0 || options[key] > 2147483647) return {empty};
   where.push(`${price} ${op} ?`); args.push(options[key]);
  }
 }
 const name = fields[0], brand = fields[1];
 const ranking = `CASE WHEN ${name} = ? THEN 0 WHEN ${name} LIKE ? ESCAPE '!' THEN 1 WHEN ${brand} = ? THEN 2 WHEN ${tokens.map(() => name+" LIKE ? ESCAPE '!'").join(" AND ")} THEN 3 ELSE 4 END`;
 const rankArgs = [cleaned,literalLike(cleaned)+"%",cleaned,...tokens.map(token => "%"+literalLike(token)+"%")];
 const from = "FROM products p JOIN categories c ON c.id = p.category_id WHERE " + where.join(" AND ");
 const order = options.sort === "precio-asc" ? `${price} IS NULL, ${price} ASC, ${name}, p.id` :
   options.sort === "precio-desc" ? `${price} IS NULL, ${price} DESC, ${name}, p.id` :
   options.sort === "nuevos" ? "p.published_at DESC, p.id DESC" : `${ranking}, ${name}, p.id`;
 return {empty, statements:[
  {sql:`SELECT p.id, p.slug, p.name, p.brand ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,args:[...args,...(!options.sort || options.sort === "relevancia" ? rankArgs : []),perPage,(page-1)*perPage]},
  {sql:"SELECT COUNT(*) AS total "+from,args}
 ], facets:[
  {sql:`SELECT p.brand, COUNT(*) AS total ${baseFrom} AND p.brand IS NOT NULL AND p.brand != '' GROUP BY p.brand ORDER BY p.brand`,args:baseArgs},
  {sql:`SELECT c.slug, c.name, COUNT(*) AS total ${baseFrom} GROUP BY c.id ORDER BY c.position, c.id`,args:baseArgs}
 ]};
}
export async function searchRead(db, term, options = {}) {
 const plan = searchPlan(term,options);
 if (!plan.statements) return plan.empty;
 const [selected,counted] = await readBatch(db,plan.statements);
 const total = Number(counted[0]?.total ?? 0), ids = selected.map(row => row.id);
 const products = ids.length ? await catalogRead(db,{productIds:ids,limit:ids.length}) : [];
 const byId = new Map(products.map(product => [product.id,product]));
 return {...plan.empty,products:ids.flatMap(id => byId.has(id) ? [byId.get(id)] : []),total,totalPages:Math.max(1,Math.ceil(total/plan.empty.perPage))};
}
export async function searchFacetsRead(db, term) {
 const plan = searchPlan(term);
 if (!plan.facets) return {brands:[], categories:[]};
 const [brands, categories] = await readBatch(db,plan.facets);
 return {brands,categories};
}
export async function suggestionsRead(db, term, limit = 6) {
 const plan = searchPlan(term,{perPage:Math.min(6,Math.max(1,limit))});
 if (!plan.statements) return [];
 const [rows] = await readBatch(db,[plan.statements[0]]);
 return rows.map(({slug,name,brand}) => ({slug,name,brand}));
}
