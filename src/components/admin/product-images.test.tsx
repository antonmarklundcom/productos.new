import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import {ProductImages} from "./product-images";
const mocks=vi.hoisted(()=>({removed:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("next/image",()=>({default:()=>null}));
vi.mock("@/app/actions/admin-products",()=>({listRemovedProductImages:mocks.removed,editProductImage:vi.fn(),reorderProductImages:vi.fn(),restoreProductImage:vi.fn(),removeProductImage:vi.fn(),uploadProductImage:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("does not refetch removed images when an action refresh supplies the same IDs with fresh object identity",async()=>{
 mocks.removed.mockResolvedValue({ok:true,images:[]});const view=render(<ProductImages productId={1} images={[{id:1,cloudinaryId:"fixture",alt:"Original"}]}/>);
 await waitFor(()=>expect(mocks.removed).toHaveBeenCalledTimes(1));
 view.rerender(<ProductImages productId={1} images={[{id:1,cloudinaryId:"fixture",alt:"Refreshed alt"}]}/>);
 await new Promise(resolve=>setTimeout(resolve,0));expect(mocks.removed).toHaveBeenCalledTimes(1);
 mocks.removed.mockResolvedValue({ok:true,images:[{id:"removed",alt:"Restaurable"}]});view.rerender(<ProductImages productId={1} images={[]}/>);
 await screen.findByRole("button",{name:"Deshacer: Restaurable"});expect(mocks.removed).toHaveBeenCalledTimes(2);
 view.rerender(<ProductImages productId={1} images={[]}/>);await new Promise(resolve=>setTimeout(resolve,0));expect(mocks.removed).toHaveBeenCalledTimes(2);
});
