import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'e2e/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 只启用 essential：只查会产生 bug 的正确性规则，不含纯格式规则（max-attributes-per-line / html-indent 等），
  // 避免老项目已有的格式差异被当成噪音淹没真正的问题。
  ...pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    // Vue SFC 的 <script> 用 TS 解析
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    files: ['**/*.{ts,mts,cts,vue}'],
    rules: {
      // 允许以 _ 开头的未用变量（常见于函数入参占位）
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // 业务/数据接口处 any 较普遍，先作为 warn 而非 error，避免存量直接爆红
      '@typescript-eslint/no-explicit-any': 'warn',
      // 本项目组件命名不强制多词
      'vue/multi-word-component-names': 'off',
    },
  },
)
