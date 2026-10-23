import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductForm } from "@/components/admin/product-form";
import { AddToCart } from "@/components/add-to-cart";
import { BulkActionsBar, DuplicateProductButton } from "@/components/admin/bulk-actions";
import { VariantEditor } from "@/components/admin/variant-editor";
import { CartSheet } from "@/components/cart-sheet";
import { TESTIDS } from "@/lib/testids";
import type { CatalogProductDetail } from "@/db/queries";
const flags=vi.hoisted(()=>({catalogOnly:true}));
vi.mock("@/config/catalog-capabilities",()=>flags);
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()})}));
vi.mock("@/app/actions/admin-products",()=>({saveProduct:vi.fn(),adjustVariantStock:vi.fn(),saveProductVariant:vi.fn(),bulkMoveProductsCategory:vi.fn(),bulkSetProductsActive:vi.fn(),duplicateProductAction:vi.fn(),previewBulkPriceAdjustment:vi.fn(),bulkAdjustProductPrices:vi.fn()}));
vi.mock("@/app/actions/cart-consulta",()=>({cartWhatsAppLink:vi.fn()}));
vi.mock("@/components/stock-alert-form",()=>({StockAlertForm:()=>null}));
vi.mock("@/lib/funnel",()=>({sendFunnelEvent:vi.fn()}));
vi.mock("@/components/admin/markdown-editor",()=>({MarkdownEditor:()=>null}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
const product={id:1,slug:"fixture",name:"Fixture",saleMode:"stock",showPrice:true,variants:[{id:11,sku:"FIRST",label:"Primera",available:8,pricePyg:10000,compareAtPyg:null},{id:12,sku:"SECOND",label:"Segunda",available:0,pricePyg:11000,compareAtPyg:null}]} as CatalogProductDetail;
afterEach(cleanup);
it("stock fixtures use selected-variant enquiry links without an unavailable purchase path",()=>{
 render(<AddToCart product={product} inquiryLinks={{11:"https://example.com/FIRST",12:"https://example.com/SECOND"}}/>);
 expect(screen.queryByTestId(TESTIDS.productAddToCart)).toBeNull();
 expect(screen.getByTestId(TESTIDS.variantInquiryLink)).toHaveAttribute("href","https://example.com/FIRST");
 fireEvent.click(screen.getByRole("button",{name:"Segunda"}));
 expect(screen.getByTestId(TESTIDS.variantInquiryLink)).toHaveAttribute("href","https://example.com/SECOND");
});
it("showcase does not expose an enquiry or purchase button",()=>{
 render(<AddToCart product={{...product,saleMode:"showcase"}} inquiryLinks={{11:"https://example.com/FIRST"}}/>);
 expect(screen.queryByTestId(TESTIDS.productAddToCart)).toBeNull();expect(screen.queryByTestId(TESTIDS.variantInquiryLink)).toBeNull();
});
it("bulk, duplication and stock adjustment explain unavailable mutations",()=>{
 render(<><BulkActionsBar productIds={[1]} categories={[{id:1,name:"Prueba"}]} canBulkPrice onDone={vi.fn()}/><DuplicateProductButton productId={1}/><VariantEditor productId={1} variants={[{id:11,sku:"FIRST",label:"Primera",pricePyg:10000,compareAtPyg:null,isActive:true,onHand:8,heldQty:0,available:8}]}/></>);
 expect(screen.getByTestId(TESTIDS.adminBulkActivate)).toBeDisabled();expect(screen.getByTestId(TESTIDS.adminBulkDeactivate)).toBeDisabled();expect(screen.getByTestId(TESTIDS.adminBulkMoveCategorySelect)).toBeDisabled();expect(screen.getByTestId(TESTIDS.adminProductDuplicate)).toBeDisabled();expect(screen.queryByTestId(TESTIDS.adminBulkPriceOpen)).toBeNull();
 expect(screen.getByRole("button",{name:/Ajustar stock/i})).toBeDisabled();
 expect(screen.getByText(/El ajuste de stock no está habilitado/)).toBeInTheDocument();
});
it("stale carts cannot expose checkout in a catalogue",()=>{const {container}=render(<CartSheet/>);expect(container).toBeEmptyDOMElement();});

it("catalogue product forms default to enquiry even with legacy stock defaults",()=>{
 render(<ProductForm defaults={{slug:"",name:"",description:"",categoryId:1,brand:"",ivaRate:10,isActive:true,published:true,isFeatured:false,saleMode:"stock"}} categories={[{id:1,name:"Prueba"}]}/>);
 expect(document.querySelector('select[name="saleMode"]')).toHaveValue("enquiry");
 expect(document.querySelector('option[value="stock"]')).toBeDisabled();
});
