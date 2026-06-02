import ts from "typescript-eslint"

export default [
  // Base config: TypeScript parser and global ignores
  {
    ignores: [
      "**/dist/**",
      "dist/**",
      "**/out/**",
      "**/.svelte-kit/**",
      "**/tools/**",
    ],
    languageOptions: {
      parser: ts.parser,
      sourceType: "module",
    },
    rules: {
      // Enforce canonical tag helpers instead of direct event.tags find/filter
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(find|filter)$/] > *.object[type='MemberExpression'][property.name='tags']",
          message:
            "Do not use event.tags.find/filter directly. Use getTag/getTags/getTagValue from nostr-git/events.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(map|some|every|forEach|reduce)$/] > *.object[type='MemberExpression'][property.name='tags']",
          message:
            "Do not iterate event.tags directly (map/some/every/forEach/reduce). Use canonical tag helpers.",
        },
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.property.name='tags'][computed=true]",
          message: "Do not access event.tags by index. Use canonical tag helpers.",
        },
        {
          selector:
            "ForOfStatement > *.right[type='MemberExpression'][property.name='tags'], ForInStatement > *.right[type='MemberExpression'][property.name='tags']",
          message: "Do not iterate over event.tags. Use canonical tag helpers.",
        },
      ],
    },
  },
  // Do not enforce or parse codemods/tools with TS parser
  {
    files: ["tools/**"],
    languageOptions: {
      // Use default Espree parser
      sourceType: "script",
    },
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Allow helper implementation code to access tags directly
  {
    files: ["src/events/**/*.*"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]
