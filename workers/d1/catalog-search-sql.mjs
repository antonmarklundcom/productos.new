import {readBatch, catalogRead} from "./public-catalog-sql.mjs";

// Spanish vowel accents are equivalent; ñ remains a distinct letter.
// SQL identifiers/expressions here are constants. Search text is always bound.
const accents = [["Á","a"],["É","e"],["Í","i"],["Ó","o"],["Ú","u"],["Ü","u"],["Ñ","ñ"],["á","a"],["é","e"],["í","i"],["ó","o"],["ú","u"],["ü","u"]];
const foldSql = (column) => "lower(" + accents.reduce((sql,[from,to]) => `replace(${sql}, '${from}', '${to}')`, `coalesce(${column}, '')`) + ")";
export const foldSearchTerm = (term) => term.normalize("NFC").toLocaleLowerCase("es").replace(/[áéíóúü]/g, letter => ({á:"a",é:"e",í:"i",ó:"o",ú:"u",ü:"u"})[letter]);
const literalLike = (value) => value.replace(/[!%_]/g, value => "!" + value);
export function searchPlan(term, options = {}, materialize = true) {
 const page = Number.isSafeInteger(options.page) && options.page > 1 ? options.page : 1;
 const perPage = Number.isSafeInteger(options.perPage) ? Math.min(60,Math.max(1,options.perPage)) : 40;
 const cleaned = foldSearchTerm(String(term).trim().replace(/\s+/g," "));
 const tokens = [...new Set(cleaned.split(" ").filter(Boolean))];
 const empty = {products:[],total:0,page,perPage,totalPages:1};
 // Bound work without silently ignoring query terms.
 if (cleaned.length < 2 || cleaned.length > 160 || tokens.length > 12) return {empty};
 const folded = ["p.name","p.brand","p.description"].map(foldSql);
 const fields = materialize ? ["p.search_name","p.search_brand","p.search_description"] : folded;
 const visibility = "p.is_active = 1 AND p.published_at IS NOT NULL AND c.is_active = 1";
 const prefix = materialize ? `WITH candidates AS MATERIALIZED (SELECT p.id,p.slug,p.name,p.brand,${folded[0]} AS search_name,${folded[1]} AS search_brand,${folded[2]} AS search_description FROM products p JOIN categories c ON c.id=p.category_id WHERE ${visibility}) ` : "";
 const where = (materialize ? "" : visibility + " AND ") +
   tokens.map(() => "(" + fields.map(field => field + " LIKE ? ESCAPE '!'").join(" OR ") + ")").join(" AND ");
 const args = tokens.flatMap(token => fields.map(() => "%" + literalLike(token) + "%"));
 const name = fields[0], brand = fields[1];
 const ranking = `CASE WHEN ${name} = ? THEN 0 WHEN ${name} LIKE ? ESCAPE '!' THEN 1 WHEN ${brand} = ? THEN 2 WHEN ${tokens.map(() => name+" LIKE ? ESCAPE '!'").join(" AND ")} THEN 3 ELSE 4 END`;
 const rankArgs = [cleaned,literalLike(cleaned)+"%",cleaned,...tokens.map(token => "%"+literalLike(token)+"%")];
 const from = (materialize ? "FROM candidates p WHERE " : "FROM products p JOIN categories c ON c.id = p.category_id WHERE ") + where;
 return {empty, statements:[
  {sql:prefix+`SELECT p.id, p.slug, p.name, p.brand ${from} ORDER BY ${ranking}, ${name}, p.id LIMIT ? OFFSET ?`,args:[...args,...rankArgs,perPage,(page-1)*perPage]},
  {sql:prefix+"SELECT COUNT(*) AS total "+from,args}
 ]};
}
export async function searchRead(db, term, options = {}) {
 const plan = searchPlan(term,options);
 if (!plan.statements) return plan.empty;
 const [selected,counted] = await readBatch(db,plan.statements);
 const total = Number(counted[0]?.total ?? 0);
 const ids = selected.map(row => row.id);
 const products = ids.length ? await catalogRead(db,{productIds:ids,limit:ids.length}) : [];
 const byId = new Map(products.map(product => [product.id,product]));
 return {...plan.empty,products:ids.flatMap(id => byId.has(id) ? [byId.get(id)] : []),total,totalPages:Math.max(1,Math.ceil(total/plan.empty.perPage))};
}

