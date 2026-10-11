import {describe,it,expect,vi} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
const capabilities=vi.hoisted(()=>({catalogOnly:true}));
vi.mock("@/config/catalog-capabilities",()=>capabilities);
vi.mock("@/lib/comercio",()=>({contactoPublico:async()=>({whatsapp:"595995628862",email:null,direccion:null,horario:null})}));
vi.mock("@/lib/site-url",()=>({siteOrigin:()=>new URL("https://productos.com.py")}));
import ContactPage,{generateMetadata} from "./page";
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
