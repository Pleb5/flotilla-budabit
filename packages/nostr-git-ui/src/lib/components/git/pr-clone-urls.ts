export type ForkCloneUrlValidation = {
  urls: string[];
  errors: string[];
  success: boolean;
};

export function validateForkCloneUrls(values: string[]): ForkCloneUrlValidation {
  const urls: string[] = [];
  const errors = values.map(() => "");
  const seen = new Set<string>();

  values.forEach((value, index) => {
    const trimmed = value.trim();
    if (!trimmed) {
      errors[index] = "Clone URL is required";
      return;
    }

    let normalized: string;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors[index] = "Clone URL must start with http:// or https://";
        return;
      }
      normalized = parsed.toString();
    } catch {
      errors[index] = "Enter a valid clone URL";
      return;
    }

    if (seen.has(normalized)) {
      errors[index] = "Duplicate clone URL";
      return;
    }

    seen.add(normalized);
    urls.push(normalized);
  });

  return {
    urls,
    errors,
    success: values.length > 0 && errors.every((error) => !error),
  };
}
