import {describe,it,expect,vi} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
const capabilities=vi.hoisted(()=>({catalogOnly:true}));
const orderAccess=vi.hoisted(()=>({lookup:vi.fn(),redirect:vi.fn(()=>{throw new Error("redirect:/");})}));
vi.mock("@/domain/order-access",()=>({getOrderByPagoparHash:orderAccess.lookup,orderUrl:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:orderAccess.redirect}));
vi.mock("@/config/catalog-capabilities",()=>capabilities);
vi.mock("@/lib/comercio",()=>({contactoPublico:async()=>({whatsapp:"595995628862",email:null,direccion:null,horario:null})}));
vi.mock("@/lib/site-url",()=>({siteOrigin:()=>new URL("https://productos.com.py")}));
import ContactPage,{generateMetadata} from "./page";
import NotFound from "../not-found";
import PagoparReturn from "../pedido/pagopar/retorno/page";
describe("catalogue payment return",()=>{
 it("returns home without querying the unported order tables",async()=>{
  capabilities.catalogOnly=true;orderAccess.lookup.mockClear();
  await expect(PagoparReturn({searchParams:Promise.resolve({hash_pedido:"example"})})).rejects.toThrow("redirect:/");
  expect(orderAccess.lookup).not.toHaveBeenCalled();
 });
});
describe("unavailable order tracking is hidden on error pages",()=>{
 it("catalogue 404 offers home without order tracking",()=>{
  capabilities.catalogOnly=true;render(<NotFound />);
  expect(document.querySelector('a[href="/pedido/buscar"]')).toBeNull();
  expect(document.querySelector('a[href="/"]')).not.toBeNull();cleanup();
 });
 it("full-store 404 keeps order tracking",()=>{
  capabilities.catalogOnly=false;render(<NotFound />);
  expect(document.querySelector('a[href="/pedido/buscar"]')).not.toBeNull();cleanup();capabilities.catalogOnly=true;
 });
});
describe("contact page matches the deployment capabilities",()=>{
 it("enquiry catalog offers WhatsApp without a dead order lookup link",async()=>{
  capabilities.catalogOnly=true;
  render(await ContactPage());
  expect(screen.queryByRole("link",{name:/Consultá un pedido/})).toBeNull();
  expect(screen.getByRole("link",{name:/WhatsApp/}).getAttribute("href")).toContain("595995628862");
  expect((generateMetadata()).description).not.toMatch(/seguir tu pedido/);
  cleanup();
 });
 it("full store retains its order lookup",async()=>{
  capabilities.catalogOnly=false;
  render(await ContactPage());
  expect(screen.getByRole("link",{name:/Consultá un pedido/}).getAttribute("href")).toBe("/pedido/buscar");
  cleanup();capabilities.catalogOnly=true;
 });
});
