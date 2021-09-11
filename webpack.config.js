const { join } = require('path');
const { statSync, readdirSync } = require('fs');
const CopyPlugin = require('copy-webpack-plugin');

const API_DIR = join(process.cwd(), 'src/api');

const crawlRoutes = (path, routes = []) => {
  if (statSync(path).isDirectory()) {
    readdirSync(path).map(file => crawlRoutes(join(path, file), routes));
  } else if (path !== __filename) {
    routes.push(path.replace(process.cwd(), '').replace(/\\/g, '/'));
  }

  return routes;
};

const entry = crawlRoutes(API_DIR).reduce((output, path) => {
  const key = path.replace(/\..+|.*?\//g, '');
  output[key] = path;

  return output;
}, {});

module.exports = {
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
    ],
  },
  resolve: {
    modules: [join(process.cwd(), 'src'), 'node_modules'],
    fallback: {
      os: false,
      fs: false,
      url: false,
      path: false,
      crypto: false,
      tls: false,
      net: false,
    },
  },
  entry,
  output: {
    filename: '[name].js',
    path: join(process.cwd(), 'api'),
  },
  plugins: [
    new CopyPlugin({
      patterns: [join(process.cwd(), 'package.json')],
    }),
  ],
};
