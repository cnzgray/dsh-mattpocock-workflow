import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 空工程阶段还没有测试，不把「没有测试文件」当成失败。
    passWithNoTests: true,
    // 测试和源码放在一起：foo.ts 旁边是 foo.test.ts。界面测试跑在 jsdom 里，其余跑在 Node 里。
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/{core,adapters,host,protocol}/**/*.test.ts', 'scripts/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // 和正式构建保持一致，用 classic 模式（React.createElement）转译 JSX。
        oxc: { jsx: { runtime: 'classic' } },
        test: {
          name: 'client',
          include: ['src/client/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // 测试共享夹具不是插件代码，不计入覆盖率。
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*-test-support.ts'],
      // core 是纯逻辑，没有理由测不到；其余层先不设门槛，开发过程中再逐层加。
      thresholds: {
        'src/core/**': { lines: 80, branches: 80, functions: 80, statements: 80 },
      },
    },
  },
})
