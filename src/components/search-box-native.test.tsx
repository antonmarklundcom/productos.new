import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const nav=vi.hoisted(()=>({push:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:nav.push}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/config/catalog-capabilities",()=>({catalogOnly:true}));
vi.mock("@/app/actions/search-suggest",()=>({sugerirProductos:vi.fn(()=>{throw Error("native mode must use GET");})}));
import {SearchBox} from "./search-box";
beforeEach(()=>{nav.push.mockReset();vi.useFakeTimers();});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it("provides native bounded GET suggestions, keyboard selection and a visible submit",async()=>{
 const fetcher=vi.fn(async (...args: unknown[])=>{void args;return {ok:true,json:async()=>({products:[{slug:"cafe",name:"Café",brand:"Casa"}]})};});vi.stubGlobal("fetch",fetcher);
 render(<SearchBox/>);const input=screen.getByRole("combobox");
 expect(screen.getByRole("button",{name:"Buscar"})).toHaveAttribute("type","submit");expect(input).toHaveAttribute("enterkeyhint","search");
 fireEvent.change(input,{target:{value:"cafe"}});await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 expect(fetcher.mock.calls[0]![0]).toBe("/api/catalog/suggest?q=cafe");expect(screen.getByRole("option")).toHaveTextContent("Café");
 fireEvent.keyDown(input,{key:"ArrowDown"});fireEvent.submit(input.closest("form")!);expect(nav.push).toHaveBeenCalledWith("/producto/cafe");
});
it("cancels obsolete requests and never offers their stale response for a newer query",async()=>{
 let resolveOld!:(value:unknown)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue({ok:true,json:async()=>({products:[{slug:"nuevo",name:"Nuevo",brand:null}]})});vi.stubGlobal("fetch",fetcher);
 render(<SearchBox/>);const input=screen.getByRole("combobox");
 fireEvent.change(input,{target:{value:"viejo"}});await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 const signal=fetcher.mock.calls[0]![1].signal as AbortSignal;
 fireEvent.change(input,{target:{value:"nuevo"}});expect(signal.aborted).toBe(true);
 await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 await act(async()=>{resolveOld({ok:true,json:async()=>({products:[{slug:"viejo",name:"Viejo",brand:null}]})});});
 expect(screen.getByRole("option")).toHaveTextContent("Nuevo");expect(screen.queryByText("Viejo")).toBeNull();
});
