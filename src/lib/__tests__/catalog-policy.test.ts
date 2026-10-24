import { afterEach, expect, it, vi } from "vitest";
const flags=vi.hoisted(()=>({catalogOnly:true}));
vi.mock("@/config/catalog-capabilities",()=>flags);
vi.mock("@/lib/comercio",()=>({waLinkPublico:async(text:string)=>"https://example.com/?text="+encodeURIComponent(text)}));
vi.mock("@/lib/site-url",()=>({siteOrigin:()=>new URL("https://catalog.example")}));
afterEach(()=>{flags.catalogOnly=true;vi.resetModules();});
it("normal Next commerce preserves stock and its checkout/stock/bulk capabilities",async()=>{
 flags.catalogOnly=false;vi.resetModules();const policy=await import("@/lib/catalog-policy");
 expect(policy.effectiveSaleMode(undefined)).toBe("stock");expect(policy.effectiveSaleMode("stock")).toBe("stock");expect(policy.effectiveSaleMode("enquiry")).toBe("enquiry");expect(policy.effectiveSaleMode("showcase")).toBe("showcase");
 expect(policy.catalogCapabilities).toEqual({checkout:true,adjustStock:true,bulkProducts:true,bulkPrices:true});
});
it("catalogue mode uses enquiry for legacy stock and suppresses transaction capabilities",async()=>{
 flags.catalogOnly=true;vi.resetModules();const policy=await import("@/lib/catalog-policy");
 expect(policy.effectiveSaleMode(undefined)).toBe("enquiry");expect(policy.effectiveSaleMode("stock")).toBe("enquiry");expect(policy.effectiveSaleMode("showcase")).toBe("showcase");expect(policy.catalogCapabilities).toEqual({checkout:false,adjustStock:false,bulkProducts:true,bulkPrices:false});
});
it("legacy stock enquiry links contain the corresponding variant SKU and canonical product URL",async()=>{
 flags.catalogOnly=true;vi.resetModules();const {productInquiryLinks}=await import("@/domain/product-inquiries");
 const links=await productInquiryLinks({slug:"fixture",name:"Fixture",saleMode:"stock",variants:[{id:11,label:"Primera",sku:"SKU_FIRST"},{id:12,label:"Segunda",sku:"SKU_SECOND"}]} as Parameters<typeof productInquiryLinks>[0]);
 expect(decodeURIComponent(links[11]!)).toContain("SKU_FIRST");expect(decodeURIComponent(links[12]!)).toContain("SKU_SECOND");expect(decodeURIComponent(links[12]!)).toContain("https://catalog.example/producto/fixture");
});
