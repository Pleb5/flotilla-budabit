/**
 * Convert a base64 string or raw content into a Blob with the given MIME type.
 */
export function createBlob(content: string, mimeType: string): Blob {
  const byteCharacters = atob(content);
  const byteArrays: BlobPart[] = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);

    for (let i = 0; i < slice.length; i += 1) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const bytes = new Uint8Array(byteNumbers);
    byteArrays.push(bytes.buffer);
  }

  return new Blob(byteArrays, { type: mimeType });
}

/**
 * Encode content into a data URL with the specified MIME type.
 */
export function createDataUrl(content: string, mimeType: string): string {
  return `data:${mimeType};base64,${content}`;
}
