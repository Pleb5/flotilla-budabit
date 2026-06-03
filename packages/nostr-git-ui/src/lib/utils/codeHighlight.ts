import type { Extension } from "@codemirror/state";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import plaintext from "highlight.js/lib/languages/plaintext";
import kotlin from "highlight.js/lib/languages/kotlin";
import dart from "highlight.js/lib/languages/dart";
import swift from "highlight.js/lib/languages/swift";
import powershell from "highlight.js/lib/languages/powershell";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import gradle from "highlight.js/lib/languages/gradle";
import groovy from "highlight.js/lib/languages/groovy";
import lua from "highlight.js/lib/languages/lua";
import diff from "highlight.js/lib/languages/diff";
import makefile from "highlight.js/lib/languages/makefile";
import cmake from "highlight.js/lib/languages/cmake";
import protobuf from "highlight.js/lib/languages/protobuf";
import graphql from "highlight.js/lib/languages/graphql";
import scala from "highlight.js/lib/languages/scala";
import r from "highlight.js/lib/languages/r";
import matlab from "highlight.js/lib/languages/matlab";
import perl from "highlight.js/lib/languages/perl";
import vim from "highlight.js/lib/languages/vim";
import latex from "highlight.js/lib/languages/latex";
import nix from "highlight.js/lib/languages/nix";
import nginx from "highlight.js/lib/languages/nginx";
import apache from "highlight.js/lib/languages/apache";
import puppet from "highlight.js/lib/languages/puppet";
import svelte from "highlight.svelte";

import { detectFileType, type FileTypeInfo } from "./fileTypeDetection";

let hasRegisteredHighlightLanguages = false;

const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, string> = {
  text: "plaintext",
  plaintext: "plaintext",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  sass: "scss",
  less: "css",
  svelte: "svelte",
  kts: "kotlin",
  psm1: "powershell",
  psd1: "powershell",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  patch: "diff",
  proto: "protobuf",
  pb: "protobuf",
  gql: "graphql",
  nixos: "nix",
  nginxconf: "nginx",
  apacheconf: "apache",
  rst: "plaintext",
  batch: "plaintext",
  log: "plaintext",
};

const escapeHtml = (content: string) =>
  content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const registerLanguage = (name: string, language: any) => {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
};

export function getHighlightJs() {
  if (hasRegisteredHighlightLanguages) return hljs;

  registerLanguage("javascript", javascript);
  registerLanguage("typescript", typescript);
  registerLanguage("python", python);
  registerLanguage("rust", rust);
  registerLanguage("go", go);
  registerLanguage("java", java);
  registerLanguage("cpp", cpp);
  registerLanguage("c", c);
  registerLanguage("csharp", csharp);
  registerLanguage("ruby", ruby);
  registerLanguage("php", php);
  registerLanguage("css", css);
  registerLanguage("scss", scss);
  registerLanguage("xml", xml);
  registerLanguage("html", xml);
  registerLanguage("svelte", svelte);
  registerLanguage("json", json);
  registerLanguage("yaml", yaml);
  registerLanguage("yml", yaml);
  registerLanguage("markdown", markdown);
  registerLanguage("bash", bash);
  registerLanguage("shell", bash);
  registerLanguage("sh", bash);
  registerLanguage("zsh", bash);
  registerLanguage("fish", bash);
  registerLanguage("sql", sql);
  registerLanguage("plaintext", plaintext);
  registerLanguage("text", plaintext);
  registerLanguage("kotlin", kotlin);
  registerLanguage("kt", kotlin);
  registerLanguage("kts", kotlin);
  registerLanguage("dart", dart);
  registerLanguage("swift", swift);
  registerLanguage("powershell", powershell);
  registerLanguage("ps1", powershell);
  registerLanguage("psm1", powershell);
  registerLanguage("psd1", powershell);
  registerLanguage("ini", ini);
  registerLanguage("cfg", ini);
  registerLanguage("conf", ini);
  registerLanguage("toml", ini);
  registerLanguage("dockerfile", dockerfile);
  registerLanguage("gradle", gradle);
  registerLanguage("groovy", groovy);
  registerLanguage("lua", lua);
  registerLanguage("diff", diff);
  registerLanguage("patch", diff);
  registerLanguage("makefile", makefile);
  registerLanguage("cmake", cmake);
  registerLanguage("protobuf", protobuf);
  registerLanguage("proto", protobuf);
  registerLanguage("graphql", graphql);
  registerLanguage("gql", graphql);
  registerLanguage("scala", scala);
  registerLanguage("r", r);
  registerLanguage("matlab", matlab);
  registerLanguage("perl", perl);
  registerLanguage("pl", perl);
  registerLanguage("vim", vim);
  registerLanguage("latex", latex);
  registerLanguage("tex", latex);
  registerLanguage("nix", nix);
  registerLanguage("nixos", nix);
  registerLanguage("nginx", nginx);
  registerLanguage("nginxconf", nginx);
  registerLanguage("apache", apache);
  registerLanguage("apacheconf", apache);
  registerLanguage("puppet", puppet);

  hasRegisteredHighlightLanguages = true;
  return hljs;
}

export function normalizeHighlightLanguage(language?: string | null) {
  const key = (language || "plaintext").toLowerCase();
  return HIGHLIGHT_LANGUAGE_ALIASES[key] || key;
}

interface OpenHighlightTag {
  name: string;
  open: string;
  close: string;
}

const looksLikeSvelteMarkup = (content: string) =>
  /<\/?[a-z]/i.test(content) || /<svelte:[a-z-]+/i.test(content) || /\{[#:@/]/.test(content);

const getMeaningfulSnippetLines = (content: string) =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const looksLikeStyleSnippet = (content: string) => {
  const lines = getMeaningfulSnippetLines(content);
  return lines.some(
    (line) =>
      /^(?:@[\w-]+.*|[.#:]?[\w-]+(?:\s*[>~+,]\s*[.#:]?[\w-]+)*)\s*\{$/i.test(line) ||
      /^(?:color|display|gap|padding|margin|font|background|border|grid|flex|width|height|position|top|right|bottom|left|inset)\s*:/i.test(
        line
      )
  );
};

const looksLikeTypescriptSnippet = (content: string) => {
  const lines = getMeaningfulSnippetLines(content);
  return lines.some(
    (line) =>
      /^(?:interface|type|enum)\b/.test(line) ||
      /:\s*[A-Z_a-z][\w<>{}\[\]|&?, ]*(?=[,)=;])/.test(line) ||
      /\b(?:readonly|private|public|protected|implements|satisfies|as const)\b/.test(line)
  );
};

const looksLikeScriptSnippet = (content: string) => {
  const lines = getMeaningfulSnippetLines(content);
  return (
    lines.some(
      (line) =>
        /^(?:import|export|const|let|var|function|async|await|class|interface|type|enum|try|catch|return)\b/.test(
          line
        ) || /=>/.test(line)
    ) || looksLikeTypescriptSnippet(content)
  );
};

const resolveSnippetLanguage = (content: string, language: string) => {
  if (language !== "svelte") return language;
  if (!content.trim()) return language;
  if (looksLikeSvelteMarkup(content)) return "svelte";
  if (looksLikeStyleSnippet(content)) return "css";
  if (looksLikeScriptSnippet(content)) {
    return looksLikeTypescriptSnippet(content) ? "typescript" : "javascript";
  }
  return "svelte";
};

const splitHighlightedSnippetLines = (html: string, expectedLines: number) => {
  const tokens = html.split(/(<[^>]+>)/g).filter(Boolean);
  const openTags: OpenHighlightTag[] = [];
  const lines: string[] = [];

  const closeOpenTags = () =>
    openTags
      .slice()
      .reverse()
      .map((tag) => tag.close)
      .join("");
  const reopenTags = () => openTags.map((tag) => tag.open).join("");

  let currentLine = "";

  for (const token of tokens) {
    if (token.startsWith("<")) {
      currentLine += token;

      if (/^<\//.test(token)) {
        const name = token.match(/^<\/([^\s>]+)/)?.[1];
        if (!name) continue;

        for (let i = openTags.length - 1; i >= 0; i -= 1) {
          if (openTags[i].name === name) {
            openTags.splice(i, 1);
            break;
          }
        }
      } else if (!/\/>$/.test(token) && !/^<!/.test(token)) {
        const name = token.match(/^<([^\s/>]+)/)?.[1];
        if (!name) continue;

        openTags.push({
          name,
          open: token,
          close: `</${name}>`,
        });
      }

      continue;
    }

    const segments = token.split("\n");
    segments.forEach((segment, index) => {
      currentLine += segment;

      if (index < segments.length - 1) {
        lines.push(currentLine + closeOpenTags());
        currentLine = reopenTags();
      }
    });
  }

  lines.push(currentLine + closeOpenTags());

  while (lines.length < expectedLines) {
    lines.push("");
  }

  return lines.slice(0, expectedLines);
};

export function getHighlightLanguageForPath(filepath: string, preferredLanguage?: string | null) {
  const detectedLanguage =
    preferredLanguage || detectFileType(filepath, "").language || "plaintext";
  return normalizeHighlightLanguage(detectedLanguage);
}

const getCodeMirrorLanguageKey = (filename: string, info: FileTypeInfo | null) => {
  const lowerName = filename.toLowerCase();
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const detectedLanguage =
    info?.language?.toLowerCase() || detectFileType(filename, "").language?.toLowerCase() || ext;

  if (lowerName === "go.mod" || lowerName === "go.sum") return "go";

  switch (detectedLanguage) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "svelte":
      return "svelte";
    case "sass":
    case "scss":
    case "less":
      return "css";
    case "shell":
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return "shell";
    case "kts":
      return "kotlin";
    case "ps1":
    case "psm1":
    case "psd1":
      return "powershell";
    case "gradle":
      return "groovy";
    case "cfg":
    case "conf":
    case "properties":
      return "ini";
    case "patch":
      return "diff";
    case "proto":
    case "pb":
      return "protobuf";
    case "nix":
      return "nix";
    case "nginxconf":
      return "nginx";
    case "apacheconf":
      return "apache";
    case "pp":
      return "puppet";
    default:
      return detectedLanguage || ext;
  }
};

export async function loadCodeMirrorLanguageExtensions(
  filename: string,
  info: FileTypeInfo | null
): Promise<Extension[]> {
  const languageKey = getCodeMirrorLanguageKey(filename, info);
  const ext = (filename.split(".").pop() || "").toLowerCase();

  switch (languageKey) {
    case "typescript":
    case "javascript": {
      const mod = await import("@codemirror/lang-javascript");
      return [
        mod.javascript({
          jsx: ["jsx", "tsx"].includes(ext),
          typescript: languageKey === "typescript" || ["ts", "tsx"].includes(ext),
        }),
      ];
    }
    case "go": {
      const mod = await import("@codemirror/lang-go");
      return [mod.go()];
    }
    case "rust":
    case "rs": {
      const mod = await import("@codemirror/lang-rust");
      return [mod.rust()];
    }
    case "json": {
      const mod = await import("@codemirror/lang-json");
      return [mod.json()];
    }
    case "css": {
      const mod = await import("@codemirror/lang-css");
      return [mod.css()];
    }
    case "svelte": {
      const mod = await import("@replit/codemirror-lang-svelte");
      return [mod.svelte()];
    }
    case "html": {
      const mod = await import("@codemirror/lang-html");
      return [mod.html()];
    }
    case "xml": {
      const mod = await import("@codemirror/lang-xml");
      return [mod.xml()];
    }
    case "markdown":
    case "md": {
      const mod = await import("@codemirror/lang-markdown");
      return [mod.markdown()];
    }
    case "python":
    case "py": {
      const mod = await import("@codemirror/lang-python");
      return [mod.python()];
    }
    case "shell": {
      const languageMod = await import("@codemirror/language");
      const shellModeMod = await import("@codemirror/legacy-modes/mode/shell");
      return [languageMod.StreamLanguage.define(shellModeMod.shell)];
    }
    case "makefile": {
      const languageMod = await import("@codemirror/language");
      const shellModeMod = await import("@codemirror/legacy-modes/mode/shell");
      return [languageMod.StreamLanguage.define(shellModeMod.shell)];
    }
    case "java": {
      const mod = await import("@codemirror/lang-java");
      return [mod.java()];
    }
    case "c":
    case "cpp":
    case "h":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh": {
      const mod = await import("@codemirror/lang-cpp");
      return [mod.cpp()];
    }
    case "yaml":
    case "yml": {
      const mod = await import("@codemirror/lang-yaml");
      return [mod.yaml()];
    }
    case "sql": {
      const mod = await import("@codemirror/lang-sql");
      return [mod.sql()];
    }
    case "php": {
      const mod = await import("@codemirror/lang-php");
      return [mod.php()];
    }
    case "csharp":
    case "scala":
    case "kotlin":
    case "dart": {
      const languageMod = await import("@codemirror/language");
      const clikeModeMod = await import("@codemirror/legacy-modes/mode/clike");
      const parser =
        languageKey === "csharp"
          ? clikeModeMod.csharp
          : languageKey === "scala"
            ? clikeModeMod.scala
            : languageKey === "kotlin"
              ? clikeModeMod.kotlin
              : clikeModeMod.dart;
      return [languageMod.StreamLanguage.define(parser)];
    }
    case "ruby": {
      const languageMod = await import("@codemirror/language");
      const rubyModeMod = await import("@codemirror/legacy-modes/mode/ruby");
      return [languageMod.StreamLanguage.define(rubyModeMod.ruby)];
    }
    case "swift": {
      const languageMod = await import("@codemirror/language");
      const swiftModeMod = await import("@codemirror/legacy-modes/mode/swift");
      return [languageMod.StreamLanguage.define(swiftModeMod.swift)];
    }
    case "powershell": {
      const languageMod = await import("@codemirror/language");
      const powershellModeMod = await import("@codemirror/legacy-modes/mode/powershell");
      return [languageMod.StreamLanguage.define(powershellModeMod.powerShell)];
    }
    case "toml": {
      const languageMod = await import("@codemirror/language");
      const tomlModeMod = await import("@codemirror/legacy-modes/mode/toml");
      return [languageMod.StreamLanguage.define(tomlModeMod.toml)];
    }
    case "dockerfile": {
      const languageMod = await import("@codemirror/language");
      const dockerfileModeMod = await import("@codemirror/legacy-modes/mode/dockerfile");
      return [languageMod.StreamLanguage.define(dockerfileModeMod.dockerFile)];
    }
    case "groovy": {
      const languageMod = await import("@codemirror/language");
      const groovyModeMod = await import("@codemirror/legacy-modes/mode/groovy");
      return [languageMod.StreamLanguage.define(groovyModeMod.groovy)];
    }
    case "lua": {
      const languageMod = await import("@codemirror/language");
      const luaModeMod = await import("@codemirror/legacy-modes/mode/lua");
      return [languageMod.StreamLanguage.define(luaModeMod.lua)];
    }
    case "diff": {
      const languageMod = await import("@codemirror/language");
      const diffModeMod = await import("@codemirror/legacy-modes/mode/diff");
      return [languageMod.StreamLanguage.define(diffModeMod.diff)];
    }
    case "ini": {
      const languageMod = await import("@codemirror/language");
      const propertiesModeMod = await import("@codemirror/legacy-modes/mode/properties");
      return [languageMod.StreamLanguage.define(propertiesModeMod.properties)];
    }
    case "cmake": {
      const languageMod = await import("@codemirror/language");
      const cmakeModeMod = await import("@codemirror/legacy-modes/mode/cmake");
      return [languageMod.StreamLanguage.define(cmakeModeMod.cmake)];
    }
    case "r": {
      const languageMod = await import("@codemirror/language");
      const rModeMod = await import("@codemirror/legacy-modes/mode/r");
      return [languageMod.StreamLanguage.define(rModeMod.r)];
    }
    case "perl": {
      const languageMod = await import("@codemirror/language");
      const perlModeMod = await import("@codemirror/legacy-modes/mode/perl");
      return [languageMod.StreamLanguage.define(perlModeMod.perl)];
    }
    case "protobuf": {
      const languageMod = await import("@codemirror/language");
      const protobufModeMod = await import("@codemirror/legacy-modes/mode/protobuf");
      return [languageMod.StreamLanguage.define(protobufModeMod.protobuf)];
    }
    case "nix": {
      const mod = await import("./nixLanguage");
      return [mod.nixLanguage];
    }
    case "nginx": {
      const languageMod = await import("@codemirror/language");
      const nginxModeMod = await import("@codemirror/legacy-modes/mode/nginx");
      return [languageMod.StreamLanguage.define(nginxModeMod.nginx)];
    }
    case "puppet": {
      const languageMod = await import("@codemirror/language");
      const puppetModeMod = await import("@codemirror/legacy-modes/mode/puppet");
      return [languageMod.StreamLanguage.define(puppetModeMod.puppet)];
    }
    default:
      return [];
  }
}

export function highlightCodeSnippet(content: string, language?: string | null) {
  if (!content) return "";

  const highlighter = getHighlightJs();
  const normalizedLanguage = normalizeHighlightLanguage(language);
  const resolvedLanguage = resolveSnippetLanguage(content, normalizedLanguage);

  try {
    if (highlighter.getLanguage(resolvedLanguage)) {
      return highlighter.highlight(content, { language: resolvedLanguage, ignoreIllegals: true })
        .value;
    }

    return highlighter.highlight(content, { language: "plaintext", ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}

export function highlightCodeLines(lines: string[], language?: string | null) {
  if (lines.length === 0) return [];

  const highlighted = highlightCodeSnippet(lines.join("\n"), language);
  return splitHighlightedSnippetLines(highlighted, lines.length);
}
