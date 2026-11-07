import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        // NodeNext is valid with isolatedModules disabled. ts-jest warns anyway.
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
    // @nestjs/config and @nestjs/terminus ship ESM only. Node can require() them;
    // Jest on Node 22 cannot, so those packages are transpiled to CommonJS.
    '^.+\\.js$': '<rootDir>/test/esm-cjs-transformer.cjs',
  },
  transformIgnorePatterns: ['node_modules/(?!(@nestjs/config|@nestjs/terminus)/)'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    // Process entrypoint only. It calls bootstrap(), which is unit-tested, and
    // importing this file would start the HTTP server.
    '!src/main.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary', 'cobertura'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/jest-setup.ts'],
  testTimeout: 30000,
  reporters: ['default', ['jest-junit', { outputDirectory: 'reports', outputName: 'junit.xml' }]],
};

export default config;
