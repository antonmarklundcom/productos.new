import { afterEach, expect, it, vi } from "vitest";
import { prepareR2ImageForm } from "@/lib/prepare-r2-images";
afterEach(() => vi.unstubAllGlobals());
function fixture(size: (attempt: number) => number, onEncode?: () => void) {
  let calls = 0;
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 1200, close })));
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob(callback: (b: Blob) => void, type: string) { onEncode?.(); callback(new Blob([new Uint8Array(size(++calls))], { type })); } }) });
  const data = new FormData(); data.set("file", new File(["fixture"], "photo.jpg", { type: "image/jpeg" }));
  return { data, close, calls: () => calls };
}
it("retries bounded quality/dimensions and only commits a complete <=800KiB set", async () => {
  const f = fixture(attempt => attempt <= 10 ? 200000 : 1000), progress = vi.fn();
  await prepareR2ImageForm(f.data, { onProgress: progress });
  expect(f.data.has("file")).toBe(false); expect(f.data.get("imageWidth")).toBe("800");
  expect(f.data.get("imageHeight")).toBe("600"); expect(f.data.has("webp1200")).toBe(false);
  expect(f.close).toHaveBeenCalledOnce(); expect(progress).toHaveBeenLastCalledWith(100);
});
it("cancellation during encode leaves original FormData and closes decoded bitmap", async () => {
  const controller = new AbortController(), f = fixture(() => 100, () => controller.abort());
  const original = f.data.get("file");
  await expect(prepareR2ImageForm(f.data, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.data.get("file")).toBe(original); expect(f.data.has("imageWidth")).toBe(false); expect(f.close).toHaveBeenCalledOnce();
});
it("exhausted budget never mutates FormData and stops after bounded attempts", async () => {
  const f = fixture(() => 300000), original = f.data.get("file");
  await expect(prepareR2ImageForm(f.data)).rejects.toThrow("800 KB");
  expect(f.calls()).toBeLessThanOrEqual(15); expect(f.data.get("file")).toBe(original); expect(f.data.has("imageHeight")).toBe(false); expect(f.close).toHaveBeenCalledOnce();
});
it("cancellation while decoding closes bitmap without encoding", async () => {
  const f = fixture(() => 100), controller = new AbortController();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => { controller.abort(); return { width: 10, height: 20, close: f.close }; }));
  await expect(prepareR2ImageForm(f.data, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.calls()).toBe(0); expect(f.close).toHaveBeenCalledOnce();
});
