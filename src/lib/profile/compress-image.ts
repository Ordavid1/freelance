const MAX_PROFILE_IMAGE_BYTES = 300_000;
const MAX_EDGE = 1200;

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image'));
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode image')), 'image/webp', quality));
}

/** Resize a user-selected image before putting it in the profile document. */
export async function compressProfileImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 7; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.74, 0.62, 0.5]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= MAX_PROFILE_IMAGE_BYTES) return await asDataUrl(blob);
      }
      scale *= 0.72;
    }
    throw new Error('Image could not be reduced enough');
  } finally {
    bitmap.close();
  }
}
