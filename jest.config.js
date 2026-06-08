/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // В тестах подменяем реальный ioredis на in-memory mock.
  moduleNameMapper: {
    '^ioredis$': 'ioredis-mock',
  },
  testTimeout: 30000,
  clearMocks: true,
};
