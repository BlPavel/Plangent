import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

const featureBoundaryRule = [
  'error',
  {
    patterns: [
      {
        group: ['@features/*/*'],
        message: 'Import from a feature public API (@features/<name>) or move reusable code to shared.',
      },
    ],
  },
]

const existingVueFormatRules = {
  'vue/attributes-order': 'off',
  'vue/html-quotes': 'off',
  'vue/html-self-closing': 'off',
  'vue/max-attributes-per-line': 'off',
  'vue/multiline-html-element-content-newline': 'off',
  'vue/singleline-html-element-content-newline': 'off',
}

export default [
  {
    ignores: ['client/dist/**', 'dist/**', 'node_modules/**'],
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
      'no-restricted-imports': featureBoundaryRule,
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
      'no-restricted-imports': featureBoundaryRule,
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      ...existingVueFormatRules,
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['client/src/shared/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@features/*'],
              message: 'shared cannot depend on features.',
            },
          ],
        },
      ],
    },
  },
]
