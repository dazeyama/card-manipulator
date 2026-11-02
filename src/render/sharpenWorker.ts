// Sharpens playmat art off the page (decision 323): about 150 ms of pixel
// work per mat, which would otherwise stall a frame.

import { sharpenArt } from './sharpen';

interface Job {
  id: number;
  bitmap: ImageBitmap;
}

const post = (self as unknown as { postMessage(msg: unknown, transfer: Transferable[]): void }).postMessage.bind(self);

self.addEventListener('message', (e: MessageEvent<Job>) => {
  const { id, bitmap } = e.data;
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const read = new OffscreenCanvas(w, h).getContext('2d')!;
    read.drawImage(bitmap, 0, 0);
    bitmap.close();
    const out = sharpenArt(read.getImageData(0, 0, w, h).data, w, h);
    const canvas = new OffscreenCanvas(out.w, out.h);
    canvas.getContext('2d')!.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.w, out.h), 0, 0);
    const result = canvas.transferToImageBitmap();
    post({ id, bitmap: result }, [result]);
  } catch {
    post({ id, bitmap: null }, []);
  }
});
