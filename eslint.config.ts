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
    // 文案词典是扁平数据表，键集本身就是文件长度；单文件让中英两套键在同一处对照。
    files: ['src/client/messages.ts'],
    rules: { 'max-lines': ['error', { max: 1200, skipBlankLines: true, skipComments: true }] },
  },
  {
    // 面板界面的用户可见文案必须走 messages.ts；词典、测试与测试夹具除外。
    files: ['src/client/**/*.{ts,tsx}'],
    ignores: [
      'src/client/messages.ts',
      'src/client/*-styles.ts',
      'src/client/**/*.test.{ts,tsx}',
      'src/client/**/*-test-support.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: '请用具名导出。' },
        {
          selector: 'Literal[value=/[\\u4e00-\\u9fff]/]',
          message: '界面文案请写进 src/client/messages.ts，不要在组件里写死中文。',
        },
        {
          selector: 'TemplateElement[value.raw=/[\\u4e00-\\u9fff]/]',
          message: '界面文案请写进 src/client/messages.ts，不要在模板里写死中文。',
        },
        {
          selector: 'JSXText[value=/[\\u4e00-\\u9fff]/]',
          message: '界面文案请写进 src/client/messages.ts，不要在 JSX 里写死中文。',
        },
      ],
    },
  },
  {
    // 测试里一个 describe 往往很长，不限制函数长度；文件上限也放宽，覆盖用例比拆分更有价值。
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }],
    },
  },
  prettier,
)
