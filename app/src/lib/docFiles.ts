// Archivos de documentos de compra: fotos (cámara o galería) y PDF.
//   - pageImages: imágenes para buscar códigos (un PDF se dibuja página a página);
//   - forStorage: lo que se guarda (la foto reducida a JPEG legible, el PDF tal cual);
//   - forGemini: lo que se manda a leer (Gemini acepta PDF directo).

export const DOC_ACCEPT = 'image/*,application/pdf';
export const isPdf = (f: Blob & { name?: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? '');
const MAX_PDF_BYTES = 14 * 1024 * 1024;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

// Páginas de un PDF como PNG (escala 2,5: el PDF417 del timbre necesita nitidez).
export async function pdfPages(file: Blob, maxPages = 3, scale = 2.5): Promise<Blob[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: Blob[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    // Una factura tamaño carta queda en ~1.500 × 2.000 px; un PDF con páginas
    // enormes se limita a 2.400 px por lado para que la lectura no se eternice.
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(scale, 2400 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent 'print': dibuja sin requestAnimationFrame (no se detiene si la
    // app pasa a segundo plano mientras lee).
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    out.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo dibujar el PDF.'))), 'image/png')));
  }
  await doc.destroy();
  return out;
}

export async function pageImages(file: Blob): Promise<Blob[]> {
  return isPdf(file) ? pdfPages(file) : [file];
}

async function toJpeg(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('No se pudo leer la imagen.')); i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo comprimir la imagen.'))), 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}

const toBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(r.error); r.readAsDataURL(b);
});

export async function forStorage(file: Blob): Promise<{ blob: Blob; contentType: string; ext: string }> {
  if (isPdf(file)) {
    if (file.size > MAX_PDF_BYTES) throw new Error('El PDF pesa más de 14 MB. Guárdelo en menor calidad o saque una foto.');
    return { blob: file, contentType: 'application/pdf', ext: 'pdf' };
  }
  // 2400 px por lado: se lee la letra chica de una factura y pesa ~0,5 MB.
  return { blob: await toJpeg(file, 2400, 0.85), contentType: 'image/jpeg', ext: 'jpg' };
}

export async function forGemini(file: Blob): Promise<{ base64: string; mimeType: string }> {
  if (isPdf(file)) return { base64: await toBase64(file), mimeType: 'application/pdf' };
  return { base64: await toBase64(await toJpeg(file, 2000, 0.85)), mimeType: 'image/jpeg' };
}
