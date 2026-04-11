const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const appDirectory = path.resolve(__dirname, '../mobile/app');

module.exports = {
  entry: path.resolve(__dirname, 'src/index.web.tsx'),

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true,
    publicPath: '/',
  },

  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
    alias: {
      // Redirect react-native imports to react-native-web
      'react-native$': 'react-native-web',
      // Point to the mobile app source so we reuse its screens directly
      '@': path.resolve(appDirectory, 'src'),
    },
  },

  module: {
    rules: [
      {
        test: /\.(tsx?|jsx?)$/,
        include: [
          path.resolve(__dirname, 'src'),
          appDirectory,
          // React Native packages that need transpilation
          /node_modules\/(react-native|@react-navigation|react-redux|@reduxjs)/,
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { browsers: ['last 2 versions'] } }],
              '@babel/preset-react',
              '@babel/preset-typescript',
            ],
            plugins: ['babel-plugin-react-native-web'],
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/,
        type: 'asset/resource',
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'public/index.html'),
    }),
  ],

  devServer: {
    port: 3000,
    historyApiFallback: true,
    hot: true,
  },
};
