const { default: tsJest } = require('ts-jest');

const transformer = tsJest.createTransformer({
  diagnostics: false,
  tsconfig: {
    allowJs: true,
    esModuleInterop: true,
    module: 'commonjs',
    target: 'ES2023',
  },
});

function downlevelImportMeta(code) {
  return code
    .replaceAll(/^[ \t]*const require = .*createRequire.*$/gm, '')
    .replaceAll('import.meta.url', 'require("node:url").pathToFileURL(__filename).href')
    .replaceAll('import.meta.dirname', '__dirname')
    .replaceAll('import.meta.resolve', 'require.resolve');
}

module.exports = {
  process(source, filename, options) {
    const result = transformer.process(source, filename, options);
    return {
      code: downlevelImportMeta(result.code),
      map: result.map,
    };
  },
  getCacheKey(source, filename, options) {
    return `${transformer.getCacheKey(source, filename, options)}:import-meta-cjs-2`;
  },
};
