export async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 背标照片压缩到长边 1400px：实测 960px 时配料和厂家会被读错，
 * 1400px 明显更准，体积仍在 200KB 量级。
 */
export async function downscale(dataUrl: string, max = 1400, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

/**
 * 按归一化区域（0-1）裁切并放大。
 * 局部小字和点阵喷码在整张图里像素太少，裁出来放大重读准得多。
 * 区域看起来不靠谱（太窄/太扁/跑出画面）时退回整张，避免裁出一块空白。
 */
export async function cropRegion(
  dataUrl: string,
  region: { x: number; y: number; w: number; h: number },
  options: { expand?: number; target?: number; maxScale?: number } = {},
): Promise<string | undefined> {
  const expand = options.expand ?? 0.18;
  const target = options.target ?? 1600;
  const maxScale = options.maxScale ?? 4;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        resolve(undefined);
        return;
      }
      const bounded = (value: number) => Math.min(1, Math.max(0, value));
      const x0 = bounded(region.x - region.w * expand) * width;
      const y0 = bounded(region.y - region.h * expand) * height;
      const x1 = bounded(region.x + region.w * (1 + expand)) * width;
      const y1 = bounded(region.y + region.h * (1 + expand)) * height;
      let cropX = x0;
      let cropY = y0;
      let cropW = x1 - x0;
      let cropH = y1 - y0;
      // 模型偶尔会给出一个极小的框，这时候裁出来什么都看不清，直接用整张
      if (cropW < width * 0.12 || cropH < height * 0.12) {
        cropX = 0;
        cropY = 0;
        cropW = width;
        cropH = height;
      }
      const scale = Math.min(maxScale, Math.max(1, target / Math.max(cropW, cropH)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropW * scale);
      canvas.height = Math.round(cropH * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(undefined);
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}
