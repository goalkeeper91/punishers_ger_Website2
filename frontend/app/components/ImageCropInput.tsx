import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { getCroppedImageFile } from "~/lib/imageCrop";

interface ImageCropInputProps {
  id: string;
  name: string;
  /** Width / height, e.g. 1 for square, 3/2 for landscape. */
  aspect: number;
  outputWidth: number;
  outputHeight: number;
  accept?: string;
  className?: string;
  onCropped?: (file: File | null) => void;
}

/**
 * Drop-in replacement for a plain `<input type="file" accept="image/*">`
 * that forces every upload through a crop step first - the actual fix for
 * "abgehackte Bilder" (see this component's introduction commit): instead
 * of the display's `object-fit: cover` cropping an arbitrary region of
 * whatever full-size image got uploaded, the person uploading picks exactly
 * what's kept, at a fixed aspect ratio matching where the image is shown.
 *
 * Still renders a real, named `<input type="file">` so existing
 * `<Form encType="multipart/form-data">` + `formData.get(name)` action code
 * doesn't need to change - after cropping, the cropped file is written back
 * into that input via the DataTransfer API, so a normal form submit just
 * picks it up like any other file input.
 */
export default function ImageCropInput({
  id,
  name,
  aspect,
  outputWidth,
  outputHeight,
  accept = "image/*",
  className,
  onCropped,
}: ImageCropInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [rawFilename, setRawFilename] = useState("bild.jpg");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setRawFilename(file.name);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setRawImageSrc(URL.createObjectURL(file));
  };

  const closeModal = () => {
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc(null);
  };

  const handleCancel = () => {
    if (inputRef.current) inputRef.current.value = "";
    closeModal();
    onCropped?.(null);
  };

  const handleConfirm = async () => {
    if (!rawImageSrc || !croppedAreaPixels) return;
    try {
      const croppedFile = await getCroppedImageFile(rawImageSrc, croppedAreaPixels, outputWidth, outputHeight, rawFilename);
      if (inputRef.current) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(croppedFile);
        inputRef.current.files = dataTransfer.files;
      }
      closeModal();
      onCropped?.(croppedFile);
    } catch (err: any) {
      setError(err.message || "Bild konnte nicht zugeschnitten werden.");
    }
  };

  return (
    <>
      <input ref={inputRef} id={id} name={name} type="file" accept={accept} onChange={handleFileSelected} className={className} />

      {rawImageSrc && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-bold text-white mb-4">Bildausschnitt wählen</h3>
            <div className="relative w-full h-80 bg-gray-900 rounded-md overflow-hidden">
              <Cropper
                image={rawImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_croppedArea, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>
            <label htmlFor={`${id}-zoom`} className="block text-sm font-medium text-gray-300 mt-4 mb-1">
              Zoom
            </label>
            <input
              id={`${id}-zoom`}
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full"
            />
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={handleCancel}
                className="py-2 px-4 rounded-md text-gray-300 text-sm font-medium bg-gray-700 hover:bg-gray-600"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!croppedAreaPixels}
                className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Übernehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
