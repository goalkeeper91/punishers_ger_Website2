// Turns a selected image plus a react-easy-crop crop rectangle into a single,
// normalized output file (JPEG, fixed pixel size) - this is the actual fix
// for "abgehackte Bilder": the person uploading picks exactly what's kept
// *before* upload, instead of the display's `object-fit: cover` cropping an
// arbitrary region of whatever full-size image happened to get uploaded.

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Bild konnte nicht geladen werden.")));
    image.src = src;
  });
}

export async function getCroppedImageFile(
  imageSrc: string,
  crop: PixelCrop,
  outputWidth: number,
  outputHeight: number,
  filename: string
): Promise<File> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas wird von diesem Browser nicht unterstützt.");
  }
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, outputWidth, outputHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    throw new Error("Bild konnte nicht zugeschnitten werden.");
  }
  const baseName = filename.replace(/\.[^.]+$/, "") || "bild";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}
