// Same Spanish contract for migration triggers and query input; ñ stays distinct.
const accents = [["Á","a"],["É","e"],["Í","i"],["Ó","o"],["Ú","u"],["Ü","u"],["Ñ","ñ"],["á","a"],["é","e"],["í","i"],["ó","o"],["ú","u"],["ü","u"]];
export const normalizedSearchSqlExpression = column => "lower(" + accents.reduce((sql,[from,to]) => `replace(${sql}, '${from}', '${to}')`, `coalesce(${column}, '')`) + ")";
export const foldSearchTerm = term => term.normalize("NFC").toLocaleLowerCase("es").replace(/[áéíóúü]/g, letter => ({á:"a",é:"e",í:"i",ó:"o",ú:"u",ü:"u"})[letter]);
export const normalizeSearchTerm = term => foldSearchTerm(String(term).trim().replace(/\s+/g," "));
export const normalizedSearchBackfill = `UPDATE products SET ${["name","brand","description"].map(field => `search_${field} = ${normalizedSearchSqlExpression(field)}`).join(", ")}`;
export const normalizedSearchTriggers = ["INSERT", "UPDATE OF name, brand, description"].map((event,index) => `CREATE TRIGGER products_search_${index ? "update" : "insert"} AFTER ${event} ON products BEGIN UPDATE products SET ${["name","brand","description"].map(field => `search_${field} = ${normalizedSearchSqlExpression("NEW."+field)}`).join(", ")} WHERE id = NEW.id; END`);
