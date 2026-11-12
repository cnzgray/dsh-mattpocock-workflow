import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['lib/', 'coverage/', 'skills/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 默认导出改名不跟随、也不好搜索，统一用具名导出。必须默认导出的入口在下面单独放开。
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: '请用具名导出。' },
      ],
      // 文件和函数的长度上限：超过就拆。空行和注释不计入。
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // DSH 按默认导出加载服务端插件入口；配置文件也由各自的工具按默认导出读取。
    files: ['src/host/index.ts', '*.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // 脚本在终端里运行，打印输出就是它们的本职。
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // 测试里一个 describe 往往很长，不限制函数长度。
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'max-lines-per-function': 'off' },
  },
  prettier,
)
