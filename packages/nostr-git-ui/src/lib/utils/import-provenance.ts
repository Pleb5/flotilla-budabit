/** Display-only attribution asserted by the importer, never signing authority. */
export function getImportProvenance(event?: { tags: string[][] }) {
  if (!event?.tags.some((tag) => tag[0] === "imported")) return undefined;
  const proxy = event.tags.find((tag) => tag[0] === "proxy" && tag[2] === "github");
  const author = event.tags.find((tag) => tag[0] === "source-author")?.[1];
  if (!proxy?.[1] || !author) return undefined;
  try {
    const url = new URL(proxy[1]);
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      !/^\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(url.pathname) ||
      (url.hash && !/^#issuecomment-\d+$/.test(url.hash))
    )
      return undefined;
    const date = Number(event.tags.find((tag) => tag[0] === "original_date")?.[1]);
    return {
      url: url.toString(),
      author: author.slice(0, 100),
      date:
        Number.isSafeInteger(date) && date > 0 && date < 8_640_000_000_000
          ? new Date(date * 1000).toISOString().slice(0, 10)
          : undefined,
    };
  } catch {
    return undefined;
  }
}
