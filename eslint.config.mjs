import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'
import layers from './scripts/eslint-layers.mjs'

const existingVueFormatRules = {
  'vue/attributes-order': 'off',
  'vue/html-quotes': 'off',
  'vue/html-self-closing': 'off',
  'vue/max-attributes-per-line': 'off',
  'vue/multiline-html-element-content-newline': 'off',
  'vue/singleline-html-element-content-newline': 'off',
}

export default [
  { plugins: { local: { rules: { layers } } } },
  { files: ['client/src/**/*.{ts,vue}'], rules: { 'local/layers': 'error' } },
  {
    files: ['client/src/**/*.vue'],
    ignores: ['client/src/shared/ui/**'],
    rules: {
      'vue/no-restricted-html-elements': ['error', { element: ['button', 'input', 'textarea', 'select'], message: 'Use shared/ui controls. See docs/client/ui-components.md.' }],
      'vue/no-restricted-class': ['error', 'btn', 'control'],
    },
  },
  {
    ignores: ['**/dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['client/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-empty': 'off',
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      ...existingVueFormatRules,
    },
  },
  {
    files: ['client/src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'no-empty': 'off',
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      ...existingVueFormatRules,
      'vue/multi-word-component-names': 'off',
    },
  },
]
