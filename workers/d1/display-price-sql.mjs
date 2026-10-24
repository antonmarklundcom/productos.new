/** Native Workers are enquiry-only. The optional stock policy supports held reservations. */
export function displayedPriceSql({stockSales = false} = {}) {
 const cheapest = "(SELECT MIN(pv.price_pyg) FROM variants pv WHERE pv.product_id = p.id AND pv.is_active = 1)";
 const available = "(SELECT MIN(pv.price_pyg) FROM variants pv WHERE pv.product_id = p.id AND pv.is_active = 1 AND pv.on_hand - COALESCE((SELECT SUM(sr.qty) FROM stock_reservations sr WHERE sr.variant_id = pv.id AND sr.state = 'held' AND sr.expires_at > CURRENT_TIMESTAMP),0) > 0)";
 return `CASE WHEN p.show_price = 1 THEN ${stockSales ? `CASE WHEN p.sale_mode = 'stock' THEN COALESCE(${available},${cheapest}) ELSE ${cheapest} END` : cheapest} ELSE NULL END`;
}
