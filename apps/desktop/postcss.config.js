// CommonJS on purpose — package.json has no "type": "module", and this file
// is loaded directly by Node via postcss-load-config/cosmiconfig, so plain
// `module.exports` avoids any ESM/CJS ambiguity for that loader.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
