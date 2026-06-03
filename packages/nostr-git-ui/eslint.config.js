export default [
  {
    rules: {
      // Disallow direct event.tags.find/filter usage; use shared helpers instead
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(find|filter)$/] > *.object[type='MemberExpression'][property.name='tags']",
          message:
            "Do not use event.tags.find/filter directly. Use getTag/getTags/getTagValue from @nostr-git/shared-types.",
        },
      ],
    },
  },
];
