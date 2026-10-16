const path = require("node:path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");

const shared = {
  resolve: { extensions: [".ts", ".js"], fallback: { fs: false, path: false, crypto: false, url: false, module: false } },
  module: { rules: [
    { test: /\.ts$/, exclude: /node_modules/, use: { loader: "ts-loader", options: { transpileOnly: true, compilerOptions: { noEmit: false } } } },
    { test: /\.wasm$/, type: "asset/resource" },
    { test: /\.css$/, use: [MiniCssExtractPlugin.loader, "css-loader"] },
  ] },
  output: { path: path.resolve(__dirname, "dist"), publicPath: "/plugins/sy-imgcompression/", assetModuleFilename: "codecs/[name].[contenthash:8][ext]" },
  performance: { hints: false },
};
module.exports = (_, argv) => [
  { ...shared, name: "plugin", target: "web", entry: "./src/index.ts", devtool: argv.mode === "development" ? "source-map" : false,
    externals: { siyuan: "commonjs siyuan" },
    output: { ...shared.output, filename: "index.js", library: { type: "commonjs2", export: "default" } },
    plugins: [new MiniCssExtractPlugin({ filename: "index.css" }), new CopyPlugin({ patterns: [
      { from: "plugin.json" }, { from: "src/i18n", to: "i18n" }, { from: "README*.md", to: "[name][ext]" },
      { from: "LICENSE" }, { from: "THIRD-PARTY-NOTICES.md" }, { from: "VALIDATION.md" },
      { from: "icon.png" }, { from: "preview.png" },
      { from: "assets/guide", to: "assets/guide", noErrorOnMissing: true },
      { from: "assets/marketing", to: "assets/marketing", noErrorOnMissing: true },
    ] })],
  },
  { ...shared, name: "worker", target: "webworker", entry: "./src/compression/compression.worker.ts", devtool: false,
    output: { ...shared.output, filename: "compression.worker.js", chunkFilename: "codecs/[name].[contenthash:8].js", globalObject: "self", chunkLoading: "import-scripts" },
    plugins: [],
  },
];
