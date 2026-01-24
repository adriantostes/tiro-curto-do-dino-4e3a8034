import { useEffect, useMemo, useState } from "react";

type Options = {
  /** Target background to remove (RGB). Default: pure black */
  key?: { r: number; g: number; b: number };
  /** Hard threshold in 0..255 for distance from key color. Default: 24 */
  threshold?: number;
  /** Soft edge size in 0..255. Default: 36 */
  feather?: number;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Removes a solid-ish background color from an image (chroma key) and returns an object URL.
 * This avoids shipping a PNG with embedded background when the generator can't output alpha.
 */
export function useChromaKeyImage(src: string | undefined, opts?: Options) {
  const options = useMemo(
    () => ({
      key: opts?.key ?? { r: 0, g: 0, b: 0 },
      threshold: opts?.threshold ?? 24,
      feather: opts?.feather ?? 36,
    }),
    [opts?.feather, opts?.key?.b, opts?.key?.g, opts?.key?.r, opts?.threshold]
  );

  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!src) return;
    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);

    const img = new Image();
    img.decoding = "async";
    img.onload = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas context not available");
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const { r: kr, g: kg, b: kb } = options.key;
        const t = options.threshold;
        const f = Math.max(1, options.feather);

        // simple RGB distance keying
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const dr = r - kr;
          const dg = g - kg;
          const db = b - kb;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);

          // dist <= t => fully transparent
          // dist >= t+f => fully opaque
          const alpha = clamp01((dist - t) / f);
          data[i + 3] = Math.round(data[i + 3] * alpha);
        }

        ctx.putImageData(imageData, 0, 0);

        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Failed to export PNG");
        const url = URL.createObjectURL(blob);
        revoked = url;
        if (!cancelled) setOutUrl(url);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setOutUrl(null);
        setLoading(false);
      }
    };

    img.src = src;

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src, options]);

  return { src: outUrl ?? src, loading };
}
