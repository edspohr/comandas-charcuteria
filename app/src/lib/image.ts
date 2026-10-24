// Foto desde la cámara → JPEG reducido (lado mayor 1600 px) en base64, para
// mandarla a la IA sin gastar datos. Mantiene la legibilidad de una planilla.
export async function photoToJpegBase64(file: File, maxSide = 1600, quality = 0.8): Promise<{ base64: string; mimeType: 'image/jpeg'; dataUrl: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('No se pudo leer la foto.')); i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', dataUrl };
  } finally { URL.revokeObjectURL(url); }
}
