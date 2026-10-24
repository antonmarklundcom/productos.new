import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const nav=vi.hoisted(()=>({query:"q=cafe&orden=precio-desc&marca=Casa&precio=0-100000&page=2",push:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:nav.push}),useSearchParams:()=>new URLSearchParams(nav.query)}));
import {CatalogFilters} from "./catalog-filters";
beforeEach(()=>nav.push.mockReset());
afterEach(cleanup);
it("clears filter keys while retaining search and selected sort",()=>{
 render(<CatalogFilters brands={[{brand:"Casa",total:3}]} />);
 fireEvent.click(screen.getByRole("button",{name:"Limpiar todo"}));
 expect(nav.push).toHaveBeenCalledWith("?q=cafe&orden=precio-desc",{scroll:false});
});
it("normalizes reversed integer budgets and preserves the GET search fallback",()=>{
 render(<CatalogFilters brands={[]} />);
 fireEvent.change(screen.getByLabelText("Mínimo (Gs.)"),{target:{value:"300"}});
 fireEvent.change(screen.getByLabelText("Máximo (Gs.)"),{target:{value:"100"}});
 const form=screen.getByRole("button",{name:"Aplicar presupuesto"}).closest("form")!;
 expect(form).toHaveAttribute("method","get");expect(form.querySelector('input[name="q"]')).toHaveValue("cafe");
 fireEvent.submit(form);
 const target=new URLSearchParams(nav.push.mock.calls[0]![0].slice(1));
 expect(target.get("min")).toBe("100");expect(target.get("max")).toBe("300");expect(target.has("precio")).toBe(false);expect(target.has("page")).toBe(false);
});
it("rejects fractional or unsafe budgets without navigation",()=>{
 render(<CatalogFilters brands={[]} />);
 fireEvent.change(screen.getByLabelText("Mínimo (Gs.)"),{target:{value:"1.5"}});
 fireEvent.submit(screen.getByRole("button",{name:"Aplicar presupuesto"}).closest("form")!);
 expect(screen.getByRole("alert")).toHaveTextContent("montos enteros");expect(nav.push).not.toHaveBeenCalled();
});
