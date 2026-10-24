import {beforeEach,expect,it,vi} from "vitest";
const reader=vi.hoisted(()=>vi.fn());
vi.mock("@/db/queries",()=>({getProductBySlug:reader}));
import {GET} from "../../src/app/api/catalog/recently-viewed/route";
const request=(slugs:string)=>new Request("https://fixture.invalid/api/catalog/recently-viewed?"+new URLSearchParams({slugs}));
const product={slug:"visible",name:"Public name",showPrice:true,saleMode:"enquiry",images:[{cloudinaryId:"public-image",alt:"Public alt"}],variants:[{pricePyg:50000,available:0}],supplierSecret:"PRIVATE_SUPPLIER",description:"not part of this projection"};
beforeEach(()=>{reader.mockReset();});
it("is a public bounded GET projection and excludes hidden-price/missing unpublished products and private fields",async()=>{
 reader.mockImplementation(async(slug:string)=>slug==="visible"?product:slug==="hidden-price"?{...product,slug,showPrice:false}:null);
 const response=await GET(request("visible,hidden-price,unpublished,missing,visible"));
 expect(reader.mock.calls.map(([slug])=>slug)).toEqual(["visible","hidden-price","unpublished","missing"]);
 expect(await response.json()).toEqual({products:[{slug:"visible",name:"Public name",pricePyg:50000,imageCloudinaryId:"public-image",imageAlt:"Public alt"}]});
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("x-robots-tag")).toContain("noindex");
});
it.each(["",Array.from({length:9},(_,i)=>"item-"+i).join(","),"a".repeat(201),"../admin","visible' OR 1=1", "item_unsafe","a".repeat(2000)])("rejects invalid or over-budget slug input before database work: %s",async(slugs)=>{
 const response=await GET(request(slugs));expect(response.status).toBe(400);expect(await response.json()).toEqual({products:[]});expect(reader).not.toHaveBeenCalled();expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("returns a safe non-cacheable failure instead of database details",async()=>{
 reader.mockRejectedValue(new Error("PRIVATE SQL failure"));const response=await GET(request("visible"));
 expect(response.status).toBe(503);expect(await response.json()).toEqual({products:[]});expect(response.headers.get("cache-control")).toBe("private, no-store");
});
