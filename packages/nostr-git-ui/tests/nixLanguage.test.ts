import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";

import { nixStreamParser } from "../src/lib/utils/nixLanguage";

const createState = () =>
  nixStreamParser.startState?.(2) ?? {
    inBlockComment: false,
    inDoubleQuotedString: false,
    inIndentedString: false,
  };

const tokenizeLine = (line: string, state = createState()) => {
  const stream = new StringStream(line, 2, 2);
  const tokens: Array<{ text: string; type: string | null }> = [];

  while (!stream.eol()) {
    stream.start = stream.pos;
    const type = nixStreamParser.token(stream, state);
    tokens.push({ text: stream.current(), type });
  }

  return tokens.filter((token) => token.text.length > 0);
};

const getTokenTypes = (tokens: Array<{ text: string; type: string | null }>, text: string) =>
  tokens.filter((token) => token.text === text).map((token) => token.type);

describe("nix stream parser", () => {
  it("classifies nix keywords, attrs, atoms, and paths", () => {
    const tokens = tokenizeLine("let pkgs = import <nixpkgs> {}; in inherit pkgs");

    expect(getTokenTypes(tokens, "let")).toEqual(["keyword"]);
    expect(getTokenTypes(tokens, "pkgs")).toEqual(["propertyName", "variableName"]);
    expect(getTokenTypes(tokens, "import")).toEqual(["keyword"]);
    expect(getTokenTypes(tokens, "<nixpkgs>")).toEqual(["string"]);
    expect(getTokenTypes(tokens, "in")).toEqual(["keyword"]);
    expect(getTokenTypes(tokens, "inherit")).toEqual(["keyword"]);

    const attrTokens = tokenizeLine("services.nginx.enable = true;");

    expect(getTokenTypes(attrTokens, "services")).toEqual(["propertyName"]);
    expect(getTokenTypes(attrTokens, "nginx")).toEqual(["propertyName"]);
    expect(getTokenTypes(attrTokens, "enable")).toEqual(["propertyName"]);
    expect(getTokenTypes(attrTokens, "true")).toEqual(["atom"]);
  });

  it("keeps multiline strings and block comments in nix mode", () => {
    const state = createState();

    expect(getTokenTypes(tokenizeLine("description = ''", state), "''")).toEqual(["string"]);
    expect(getTokenTypes(tokenizeLine("  hello nix", state), "  hello nix")).toEqual(["string"]);
    expect(getTokenTypes(tokenizeLine("'';", state), "''")).toEqual(["string"]);
    expect(state.inIndentedString).toBe(false);

    const commentState = createState();
    expect(getTokenTypes(tokenizeLine("/* comment", commentState), "/* comment")).toEqual([
      "comment",
    ]);

    const commentTokens = tokenizeLine("still comment */ pkgs", commentState);

    expect(commentTokens[0]).toEqual({ text: "still comment */", type: "comment" });
    expect(commentTokens.at(-1)).toEqual({ text: "pkgs", type: "variableName" });
    expect(commentState.inBlockComment).toBe(false);
  });
});
