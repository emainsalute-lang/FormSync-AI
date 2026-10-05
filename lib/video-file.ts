const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
const SUPPORTED_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export function normalizeVideoFile(file: File): File | null {
  const type = file.type.toLowerCase();
  const extension = file.name.match(/\.[^.]+$/)?.[0].toLowerCase() || "";
  const extensionType = MIME_BY_EXTENSION[extension];

  if (extensionType) {
    const compatible =
      !type ||
      type === "application/octet-stream" ||
      type === extensionType ||
      (extensionType === "video/mp4" && type === "video/x-m4v");
    if (!compatible) return null;
    if (type === extensionType) return file;
    return new File([file], file.name, {
      type: extensionType,
      lastModified: file.lastModified,
    });
  }

  return SUPPORTED_TYPES.has(type) ? file : null;
}
