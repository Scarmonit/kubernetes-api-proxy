import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {languageOptions: { globals: { ...globals.browser, ...globals.node } }},
  pluginJs.configs.recommended,
  {
    rules: {
        "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
        "no-console": "off",
        "no-undef": "off" // Workers have global fetch/Response/etc which can be tricky to mock perfectly in globals without a specific worker preset, turning off no-undef for now as strict mode handles most.
    }
  }
];
