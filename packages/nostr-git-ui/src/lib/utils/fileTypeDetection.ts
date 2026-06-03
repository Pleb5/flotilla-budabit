/**
 * File type detection utilities for the FileView component
 */

export interface FileTypeInfo {
  category: "text" | "image" | "pdf" | "binary" | "archive" | "video" | "audio";
  mimeType: string;
  language?: string; // For CodeMirror syntax highlighting
  icon: string; // Lucide icon name
  canPreview: boolean;
  canEdit: boolean;
}

// Language mappings for CodeMirror
const LANGUAGE_MAPPINGS: Record<string, string> = {
  // JavaScript/TypeScript
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mjs: "javascript",
  cjs: "javascript",

  // Web technologies
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  vue: "vue",
  svelte: "svelte",

  // Programming languages
  py: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  kt: "kotlin",
  kts: "kotlin",
  dart: "dart",
  swift: "swift",
  scala: "scala",
  r: "r",
  matlab: "matlab",
  m: "matlab",

  // Shell and config
  nix: "nix",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "batch",
  cmd: "batch",

  // Data formats
  json: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  properties: "ini",
  cfg: "ini",
  conf: "ini",
  env: "ini",
  service: "ini",
  socket: "ini",
  timer: "ini",
  mount: "ini",
  automount: "ini",
  path: "ini",
  target: "ini",
  slice: "ini",
  swap: "ini",
  network: "ini",
  netdev: "ini",
  link: "ini",

  // Markup
  md: "markdown",
  markdown: "markdown",
  rst: "rst",
  tex: "latex",
  latex: "latex",

  // SQL
  sql: "sql",
  mysql: "sql",
  pgsql: "sql",
  sqlite: "sql",

  // Other
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",
  gradle: "groovy",
  groovy: "groovy",
  pp: "puppet",
  nginx: "nginx",
  apacheconf: "apache",
  htaccess: "apache",
  lua: "lua",
  perl: "perl",
  pl: "perl",
  proto: "protobuf",
  pb: "protobuf",
  graphql: "graphql",
  gql: "graphql",
  vim: "vim",
  diff: "diff",
  patch: "diff",
  log: "log",
};

// File type detection based on extension
const FILE_TYPE_MAPPINGS: Record<string, Omit<FileTypeInfo, "language">> = {
  // Images
  jpg: {
    category: "image",
    mimeType: "image/jpeg",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },
  jpeg: {
    category: "image",
    mimeType: "image/jpeg",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },
  png: {
    category: "image",
    mimeType: "image/png",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },
  gif: {
    category: "image",
    mimeType: "image/gif",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },
  webp: {
    category: "image",
    mimeType: "image/webp",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },
  svg: {
    category: "image",
    mimeType: "image/svg+xml",
    icon: "Image",
    canPreview: true,
    canEdit: true,
  },
  bmp: {
    category: "image",
    mimeType: "image/bmp",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },
  ico: {
    category: "image",
    mimeType: "image/x-icon",
    icon: "Image",
    canPreview: true,
    canEdit: false,
  },

  // PDFs
  pdf: {
    category: "pdf",
    mimeType: "application/pdf",
    icon: "FileText",
    canPreview: true,
    canEdit: false,
  },

  // Archives
  zip: {
    category: "archive",
    mimeType: "application/zip",
    icon: "Archive",
    canPreview: false,
    canEdit: false,
  },
  tar: {
    category: "archive",
    mimeType: "application/x-tar",
    icon: "Archive",
    canPreview: false,
    canEdit: false,
  },
  gz: {
    category: "archive",
    mimeType: "application/gzip",
    icon: "Archive",
    canPreview: false,
    canEdit: false,
  },
  rar: {
    category: "archive",
    mimeType: "application/vnd.rar",
    icon: "Archive",
    canPreview: false,
    canEdit: false,
  },
  "7z": {
    category: "archive",
    mimeType: "application/x-7z-compressed",
    icon: "Archive",
    canPreview: false,
    canEdit: false,
  },

  // Video
  mp4: {
    category: "video",
    mimeType: "video/mp4",
    icon: "Video",
    canPreview: true,
    canEdit: false,
  },
  avi: {
    category: "video",
    mimeType: "video/x-msvideo",
    icon: "Video",
    canPreview: true,
    canEdit: false,
  },
  mov: {
    category: "video",
    mimeType: "video/quicktime",
    icon: "Video",
    canPreview: true,
    canEdit: false,
  },
  mkv: {
    category: "video",
    mimeType: "video/x-matroska",
    icon: "Video",
    canPreview: true,
    canEdit: false,
  },
  webm: {
    category: "video",
    mimeType: "video/webm",
    icon: "Video",
    canPreview: true,
    canEdit: false,
  },

  // Audio
  mp3: {
    category: "audio",
    mimeType: "audio/mpeg",
    icon: "Music",
    canPreview: true,
    canEdit: false,
  },
  wav: {
    category: "audio",
    mimeType: "audio/wav",
    icon: "Music",
    canPreview: true,
    canEdit: false,
  },
  ogg: {
    category: "audio",
    mimeType: "audio/ogg",
    icon: "Music",
    canPreview: true,
    canEdit: false,
  },
  flac: {
    category: "audio",
    mimeType: "audio/flac",
    icon: "Music",
    canPreview: true,
    canEdit: false,
  },
  m4a: {
    category: "audio",
    mimeType: "audio/mp4",
    icon: "Music",
    canPreview: true,
    canEdit: false,
  },

  // Binary files
  exe: {
    category: "binary",
    mimeType: "application/octet-stream",
    icon: "Binary",
    canPreview: false,
    canEdit: false,
  },
  dll: {
    category: "binary",
    mimeType: "application/octet-stream",
    icon: "Binary",
    canPreview: false,
    canEdit: false,
  },
  so: {
    category: "binary",
    mimeType: "application/octet-stream",
    icon: "Binary",
    canPreview: false,
    canEdit: false,
  },
  dylib: {
    category: "binary",
    mimeType: "application/octet-stream",
    icon: "Binary",
    canPreview: false,
    canEdit: false,
  },
};

/**
 * Detect file type based on filename and content heuristics
 */
export function detectFileType(filename: string, content?: string): FileTypeInfo {
  const extension = getFileExtension(filename).toLowerCase();
  const basename = getBasename(filename).toLowerCase();

  // Check for special files by name
  const specialFile = detectSpecialFiles(basename, filename);
  if (specialFile) {
    return specialFile;
  }

  // Check extension mappings
  const typeInfo = FILE_TYPE_MAPPINGS[extension];
  if (typeInfo) {
    return {
      ...typeInfo,
      language: LANGUAGE_MAPPINGS[extension],
    };
  }

  if (LANGUAGE_MAPPINGS[extension]) {
    return {
      category: "text",
      mimeType: "text/plain",
      language: LANGUAGE_MAPPINGS[extension],
      icon: "FileCode",
      canPreview: true,
      canEdit: true,
    };
  }

  // Content-based detection for text files
  if (content !== undefined) {
    const contentType = detectContentType(content, extension);
    if (contentType) {
      return contentType;
    }
  }

  // Default to text file with appropriate language
  return {
    category: "text",
    mimeType: "text/plain",
    language: LANGUAGE_MAPPINGS[extension] || "text",
    icon: "FileText",
    canPreview: true,
    canEdit: true,
  };
}

/**
 * Get file extension from filename
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return "";
  }
  return filename.slice(lastDot + 1);
}

/**
 * Get basename (filename without extension)
 */
function getBasename(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const nameWithoutPath = filename.slice(lastSlash + 1);
  const lastDot = nameWithoutPath.lastIndexOf(".");
  if (lastDot === -1) {
    return nameWithoutPath;
  }
  return nameWithoutPath.slice(0, lastDot);
}

/**
 * Detect special files by name patterns
 */
function detectSpecialFiles(basename: string, fullname: string): FileTypeInfo | null {
  const lowerName = fullname
    .slice(Math.max(fullname.lastIndexOf("/"), fullname.lastIndexOf("\\")) + 1)
    .toLowerCase();

  // Configuration files
  if (["package.json", "composer.json", "tsconfig.json", "jsconfig.json"].includes(lowerName)) {
    return {
      category: "text",
      mimeType: "application/json",
      language: "json",
      icon: "Settings",
      canPreview: true,
      canEdit: true,
    };
  }

  // Go module files
  if (lowerName === "go.mod" || lowerName === "go.sum") {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "go",
      icon: "FileCode",
      canPreview: true,
      canEdit: true,
    };
  }

  // Cargo lock files
  if (lowerName === "cargo.lock") {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "toml",
      icon: "FileCode",
      canPreview: true,
      canEdit: true,
    };
  }

  // Nix lock files
  if (lowerName === "flake.lock") {
    return {
      category: "text",
      mimeType: "application/json",
      language: "json",
      icon: "Settings",
      canPreview: true,
      canEdit: true,
    };
  }

  // Dotenv files
  if (lowerName === ".env" || lowerName.startsWith(".env.")) {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "ini",
      icon: "Settings",
      canPreview: true,
      canEdit: true,
    };
  }

  // Docker files
  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "dockerfile",
      icon: "Container",
      canPreview: true,
      canEdit: true,
    };
  }

  // Nginx files
  if (
    lowerName === "nginx.conf" ||
    ["mime.types", "fastcgi_params", "uwsgi_params", "scgi_params", "proxy_params"].includes(
      lowerName
    )
  ) {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "nginx",
      icon: "Settings",
      canPreview: true,
      canEdit: true,
    };
  }

  // Apache files
  if ([".htaccess", "httpd.conf", "apache2.conf"].includes(lowerName)) {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "apache",
      icon: "Settings",
      canPreview: true,
      canEdit: true,
    };
  }

  // Makefiles
  if (lowerName === "makefile" || lowerName === "makefile.am" || lowerName === "makefile.in") {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "makefile",
      icon: "Hammer",
      canPreview: true,
      canEdit: true,
    };
  }

  // README files
  if (basename === "readme") {
    return {
      category: "text",
      mimeType: "text/markdown",
      language: "markdown",
      icon: "BookOpen",
      canPreview: true,
      canEdit: true,
    };
  }

  // License files
  if (basename === "license" || basename === "licence") {
    return {
      category: "text",
      mimeType: "text/plain",
      language: "text",
      icon: "Scale",
      canPreview: true,
      canEdit: true,
    };
  }

  return null;
}

/**
 * Detect content type based on file content
 */
function detectContentType(content: string, extension: string): FileTypeInfo | null {
  // Check for binary content
  if (isBinaryContent(content)) {
    return {
      category: "binary",
      mimeType: "application/octet-stream",
      icon: "Binary",
      canPreview: false,
      canEdit: false,
    };
  }

  // Check for specific patterns in text content
  const trimmedContent = content.trim();

  // JSON detection
  if (
    (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) ||
    (trimmedContent.startsWith("[") && trimmedContent.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmedContent);
      return {
        category: "text",
        mimeType: "application/json",
        language: "json",
        icon: "Braces",
        canPreview: true,
        canEdit: true,
      };
    } catch {
      // Not valid JSON
    }
  }

  // XML detection
  if (
    trimmedContent.startsWith("<?xml") ||
    (trimmedContent.startsWith("<") && trimmedContent.includes(">"))
  ) {
    return {
      category: "text",
      mimeType: "application/xml",
      language: "xml",
      icon: "Code2",
      canPreview: true,
      canEdit: true,
    };
  }

  // Shebang detection
  if (trimmedContent.startsWith("#!")) {
    const firstLine = trimmedContent.split("\n")[0];
    if (firstLine.includes("python")) {
      return {
        category: "text",
        mimeType: "text/x-python",
        language: "python",
        icon: "FileCode",
        canPreview: true,
        canEdit: true,
      };
    }
    if (firstLine.includes("bash") || firstLine.includes("sh")) {
      return {
        category: "text",
        mimeType: "text/x-shellscript",
        language: "shell",
        icon: "Terminal",
        canPreview: true,
        canEdit: true,
      };
    }
  }

  return null;
}

/**
 * Check if content appears to be binary
 */
function isBinaryContent(content: string): boolean {
  // Check for null bytes (common in binary files)
  if (content.includes("\0")) {
    return true;
  }

  // Check for high ratio of non-printable characters
  let nonPrintableCount = 0;
  const sampleSize = Math.min(content.length, 1000); // Sample first 1000 chars

  for (let i = 0; i < sampleSize; i++) {
    const charCode = content.charCodeAt(i);
    // Consider characters outside printable ASCII range (excluding common whitespace)
    if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
      nonPrintableCount++;
    }
    if (charCode > 126) {
      nonPrintableCount++;
    }
  }

  // If more than 10% non-printable, likely binary
  return nonPrintableCount / sampleSize > 0.1;
}

/**
 * Get file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get file metadata for display
 */
export function getFileMetadata(
  file: any,
  content?: string,
  typeInfo?: FileTypeInfo
): Record<string, string> {
  const metadata: Record<string, string> = {};

  // Basic file info
  metadata["Name"] = file.name || "Unknown";
  metadata["Path"] = file.path || "Unknown";
  metadata["Type"] = typeInfo?.category || "Unknown";

  if (file.size !== undefined) {
    metadata["Size"] = formatFileSize(file.size);
  }

  if (file.mode !== undefined) {
    metadata["Mode"] = file.mode.toString(8); // Convert to octal
  }

  if (file.lastCommit) {
    metadata["Last Commit"] = file.lastCommit.slice(0, 8);
  }

  // Content-specific metadata
  if (content && typeInfo?.category === "text") {
    const lines = content.split("\n").length;
    metadata["Lines"] = lines.toString();
    metadata["Characters"] = content.length.toString();

    // Word count for text files
    const words = content
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
    metadata["Words"] = words.toString();
  }

  if (typeInfo?.language) {
    metadata["Language"] = typeInfo.language;
  }

  if (typeInfo?.mimeType) {
    metadata["MIME Type"] = typeInfo.mimeType;
  }

  return metadata;
}
