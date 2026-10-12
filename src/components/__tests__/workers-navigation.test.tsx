import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {ReactNode, MouseEvent} from "react";

const state = vi.hoisted(() => ({pathname: "/", search: "", prefetch: vi.fn(), push: vi.fn()}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({prefetch: state.prefetch, push: state.push}),
}));
vi.mock("next/link", () => ({default: ({href, children, prefetch: _prefetch, onNavigate, ...props}: {
  href: string; children?: ReactNode; prefetch?: boolean; onNavigate?: (event: {preventDefault(): void}) => void;
}) => <a {...props} href={href} data-auto-prefetch={String(_prefetch)} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate?.({preventDefault() {}});
}}>{children}</a>}));
import {CatalogLink, NavigationProgress} from "../../../workers/d1/navigation-progress";

beforeEach(() => {
  vi.useFakeTimers();state.pathname="/";state.search="";state.prefetch.mockReset();state.push.mockReset();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(navigator,"connection",{configurable:true,value:{saveData:false}});
});
afterEach(() => {cleanup();vi.useRealTimers();});
describe("Workers storefront navigation", () => {
  it("does not prefetch after a quick touch tap has already started navigation", () => {
    window.history.replaceState({},"","/categoria/quick-touch-review");
    render(<><NavigationProgress/><CatalogLink href="/producto/quick-touch-review">Quick tap</CatalogLink></>);
    const link=screen.getByText("Quick tap");
    fireEvent.touchStart(link);act(()=>vi.advanceTimersByTime(60));fireEvent.click(link);
    act(()=>vi.advanceTimersByTime(120));expect(state.prefetch).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
  });
  it("cancels touch-scroll and cancelled gestures while preserving stationary touch intent", () => {
    window.history.replaceState({},"","/categoria/touch-review");
    const move=vi.fn(),cancel=vi.fn();
    render(<CatalogLink href="/producto/touch-review" onTouchMove={move} onTouchCancel={cancel}>Touch product</CatalogLink>);
    const link=screen.getByText("Touch product");
    fireEvent.touchStart(link);fireEvent.touchMove(link);
    act(()=>vi.advanceTimersByTime(120));expect(state.prefetch).not.toHaveBeenCalled();expect(move).toHaveBeenCalledOnce();
    fireEvent.touchStart(link);fireEvent.touchCancel(link);
    act(()=>vi.advanceTimersByTime(120));expect(state.prefetch).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledOnce();
    fireEvent.touchStart(link);act(()=>vi.advanceTimersByTime(120));
    expect(state.prefetch).toHaveBeenCalledTimes(1);expect(state.prefetch.mock.calls[0]?.[0]).toBe("/producto/touch-review");
  });
  it("shows feedback immediately, clears on route change and preserves same-page/modified clicks", () => {
    const ui=()=> <><div id="contenido" /><NavigationProgress /><CatalogLink href="/producto/first">Product</CatalogLink><CatalogLink href="#details">Anchor</CatalogLink></>;
    const result=render(ui());
    fireEvent.click(screen.getByText("Anchor"));expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("Product"),{ctrlKey:true});expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("Product"));expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    expect(document.getElementById("contenido")).toHaveAttribute("aria-busy","true");
    state.pathname="/producto/first";result.rerender(ui());expect(screen.queryByRole("status")).toBeNull();
    expect(document.getElementById("contenido")).toHaveAttribute("aria-busy","false");
  });
  it("clears a failed navigation after its timeout and respects cancelled navigation", () => {
    render(<><NavigationProgress/><CatalogLink href="/producto/first">Product</CatalogLink><CatalogLink href="/producto/second" onNavigate={event=>event.preventDefault()}>Cancelled</CatalogLink></>);
    fireEvent.click(screen.getByText("Cancelled"));expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("Product"));expect(screen.getByRole("status")).toBeInTheDocument();
    act(()=>vi.advanceTimersByTime(15000));expect(screen.queryByRole("status")).toBeNull();
  });
  it("prefetches only after intent, cancels brief hover, limits fan-out and respects Save-Data", () => {
    render(<>{Array.from({length:8},(_,id)=><CatalogLink key={id} href={`/producto/item-${id}`}>Item {id}</CatalogLink>)}</>);
    expect(state.prefetch).not.toHaveBeenCalled();
    fireEvent.mouseEnter(screen.getByText("Item 0"));act(()=>vi.advanceTimersByTime(119));expect(state.prefetch).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByText("Item 0"));act(()=>vi.advanceTimersByTime(10));expect(state.prefetch).not.toHaveBeenCalled();
    for(let id=0;id<8;id++){fireEvent.focus(screen.getByText(`Item ${id}`));act(()=>vi.advanceTimersByTime(120));}
    expect(state.prefetch).toHaveBeenCalledTimes(6);
    expect(state.prefetch.mock.calls[0]?.[1]).toMatchObject({kind:"full"});
    window.history.replaceState({},"","/categoria/tools");
    Object.defineProperty(navigator,"connection",{configurable:true,value:{saveData:true}});
    fireEvent.touchStart(screen.getByText("Item 7"));act(()=>vi.advanceTimersByTime(120));expect(state.prefetch).toHaveBeenCalledTimes(6);
  });
});
