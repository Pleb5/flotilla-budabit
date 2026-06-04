import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language";

interface NixStreamState {
  inBlockComment: boolean;
  inDoubleQuotedString: boolean;
  inIndentedString: boolean;
}

const KEYWORDS = new Set([
  "assert",
  "else",
  "if",
  "import",
  "in",
  "inherit",
  "let",
  "or",
  "rec",
  "then",
  "with",
]);

const ATOMS = new Set(["false", "null", "true"]);

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_'-]*/;
const NUMBER_PATTERN = /^-?(?:\d+\.\d+|\d+)(?:[eE][+-]?\d+)?/;
const PATH_PATTERN = /^(?:\.\.?\/|\/)[^\s\]})(",;]+/;
const SEARCH_PATH_PATTERN = /^<[A-Za-z0-9+._/-]+>/;
const URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s\]})(",;]+/;
const PUNCTUATION_PATTERN = /^(?:\.\.\.|[{}[\](),.;])/;
const OPERATOR_PATTERN = /^(?:\+\+|==|!=|<=|>=|&&|\|\||->|[=:+?@!*/<>-])/;

const getPreviousSignificantChar = (line: string, offset: number) => {
  for (let i = offset - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch.trim()) return ch;
  }

  return null;
};

const getNextSignificantChar = (line: string, offset: number) => {
  for (let i = offset; i < line.length; i++) {
    const ch = line[i];
    if (ch.trim()) return ch;
  }

  return null;
};

const isPropertyName = (stream: StringStream) => {
  const previous = getPreviousSignificantChar(stream.string, stream.start);
  if (previous === ".") return true;

  const next = getNextSignificantChar(stream.string, stream.pos);
  return [".", "=", ":", "?", ",", "}"].includes(next ?? "");
};

const readBlockComment = (stream: StringStream, state: NixStreamState) => {
  while (!stream.eol()) {
    if (stream.match("*/")) {
      state.inBlockComment = false;
      break;
    }

    stream.next();
  }

  return "comment";
};

const readDoubleQuotedString = (stream: StringStream, state: NixStreamState) => {
  let escaped = false;

  while (!stream.eol()) {
    const ch = stream.next();

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      state.inDoubleQuotedString = false;
      break;
    }
  }

  return "string";
};

const readIndentedString = (stream: StringStream, state: NixStreamState) => {
  while (!stream.eol()) {
    if (stream.match("'''")) continue;
    if (stream.match("''${")) continue;
    if (stream.match("''")) {
      state.inIndentedString = false;
      break;
    }

    stream.next();
  }

  return "string";
};

export const nixStreamParser: StreamParser<NixStreamState> = {
  name: "nix",
  languageData: {
    commentTokens: { line: "#", block: { open: "/*", close: "*/" } },
  },
  startState: () => ({
    inBlockComment: false,
    inDoubleQuotedString: false,
    inIndentedString: false,
  }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.inBlockComment) return readBlockComment(stream, state);
    if (state.inDoubleQuotedString) return readDoubleQuotedString(stream, state);
    if (state.inIndentedString) return readIndentedString(stream, state);

    if (stream.eatSpace()) return null;

    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.match("/*")) {
      state.inBlockComment = true;
      return readBlockComment(stream, state);
    }

    if (stream.match("''")) {
      state.inIndentedString = true;
      return readIndentedString(stream, state);
    }

    if (stream.match('"')) {
      state.inDoubleQuotedString = true;
      return readDoubleQuotedString(stream, state);
    }

    if (stream.match("//")) return "operator";
    if (stream.match(SEARCH_PATH_PATTERN)) return "string";
    if (stream.match(PATH_PATTERN)) return "string";
    if (stream.match(URI_PATTERN)) return "string";
    if (stream.match(NUMBER_PATTERN)) return "number";
    if (stream.match("${")) return "punctuation";
    if (stream.match(PUNCTUATION_PATTERN)) return "punctuation";
    if (stream.match(OPERATOR_PATTERN)) return "operator";

    const identifier = stream.match(IDENTIFIER_PATTERN);
    if (identifier) {
      const value = stream.current();

      if (ATOMS.has(value)) return "atom";
      if (KEYWORDS.has(value)) return "keyword";
      if (isPropertyName(stream)) return "propertyName";

      return "variableName";
    }

    stream.next();
    return null;
  },
};

export const nixLanguage = StreamLanguage.define(nixStreamParser);
