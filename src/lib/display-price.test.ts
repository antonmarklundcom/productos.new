import {expect,it} from "vitest";
import {displayedVariant} from "./display-price";
import {parseBudget} from "./price-ranges";
it("uses available price for stock sales and cheapest active price for enquiries",()=>{
 const variants=[{pricePyg:100,available:0},{pricePyg:500,available:1}];
 expect(displayedVariant({saleMode:"stock",variants})?.pricePyg).toBe(500);
 expect(displayedVariant({saleMode:"enquiry",variants})?.pricePyg).toBe(100);
 expect(displayedVariant({saleMode:"showcase",variants})?.pricePyg).toBe(100);
 expect(displayedVariant({saleMode:"stock",variants:variants.map(v=>({...v,available:0}))})?.pricePyg).toBe(100);
});
it("parses exact inclusive integer budgets and rejects malformed amounts",()=>{
 expect(parseBudget("0","2147483647")).toEqual({min:0,max:2147483647});
 expect(parseBudget("300","100")).toEqual({min:100,max:300});
 for(const value of ["-1","1.5","1e3","Infinity","2147483648"," 1","1,000"]) expect(parseBudget(value)).toEqual({invalid:true});
 expect(parseBudget("","","0-100000")).toEqual({min:0,max:100000});
});
