import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {ProductImages} from "./product-images";
const mocks=vi.hoisted(()=>({removed:vi.fn(),refresh:vi.fn(),remove:vi.fn(),capabilities:{nativeGallery:true}}));
vi.mock("@/lib/catalog-policy",()=>({catalogCapabilities:mocks.capabilities}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("next/image",()=>({default:()=>null}));
vi.mock("@/app/actions/admin-products",()=>({listRemovedProductImages:mocks.removed,editProductImage:vi.fn(),reorderProductImages:vi.fn(),restoreProductImage:vi.fn(),removeProductImage:mocks.remove,uploadProductImage:vi.fn()}));
beforeEach(()=>{mocks.capabilities.nativeGallery=true;mocks.remove.mockResolvedValue({ok:true});});
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

it("retained SQL gallery keeps upload/remove and read-only descriptions without native-only actions",async()=>{
 mocks.capabilities.nativeGallery=false;render(<ProductImages productId={1} images={[{id:1,cloudinaryId:"fixture",alt:"Original SQL description"}]}/>);
 await new Promise(resolve=>setTimeout(resolve,0));expect(mocks.removed).not.toHaveBeenCalled();expect(screen.queryByRole("textbox",{name:"Descripción de foto 1"})).toBeNull();expect(screen.queryByRole("button",{name:"Usar de portada"})).toBeNull();expect(screen.queryByRole("button",{name:/Mover foto/})).toBeNull();expect(screen.queryByRole("button",{name:/Deshacer:/})).toBeNull();expect(screen.getByText("Descripción: Original SQL description")).toBeInTheDocument();expect(document.querySelector("input#file")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:/quitar/i}));await waitFor(()=>expect(mocks.remove).toHaveBeenCalledOnce());expect(mocks.removed).not.toHaveBeenCalled();
});
