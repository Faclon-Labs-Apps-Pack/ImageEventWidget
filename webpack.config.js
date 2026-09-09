import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── A. EDIT THIS PER WIDGET ────────────────────────────────────────────────
const COMPONENTS = {
  ImageWidget: './src/components/ImageWidget/index.ts',
  ImageWidgetConfiguration: './src/components/ImageWidgetConfiguration/index.ts',
};
// ────────────────────────────────────────────────────────────────────────────

// ─── B. design-sdk comes from the host as window.FDS (do not edit) ───────────
// The host only ships the subpaths in its manifest; importing one that is missing
// yields `undefined` at RUNTIME (blank widget), so fail the BUILD instead. Point
// FDS_MANIFEST at the file if IOSense is not a sibling checkout.
const FDS_MANIFEST = process.env.FDS_MANIFEST
  || path.resolve(__dirname, '../IOSense/src/assets/react/design-sdk.subpaths.json');
let fdsSubpaths = null;
try {
  fdsSubpaths = new Set(JSON.parse(fs.readFileSync(FDS_MANIFEST, 'utf8')).subpaths);
} catch {
  console.warn(`[design-sdk] manifest not found at ${FDS_MANIFEST} — cannot verify `
    + `imported subpaths are in the host bundle. Set FDS_MANIFEST to enable the check.`);
}

// A FUNCTION external is required (not an object): there are many subpaths, some
// with slashes (EmptyState/illustrations/*), and `.css` imports must stay in the
// bundle so MiniCssExtractPlugin still emits the widget's own component CSS.
function designSdkExternal({ request }, callback) {
  const m = /^@faclon-labs\/design-sdk(?:\/(.+))?$/.exec(request || '');
  if (!m) return callback();
  const sub = m[1];
  if (sub && sub.endsWith('.css')) return callback();            // keep CSS bundled
  if (sub && fdsSubpaths && !fdsSubpaths.has(sub)) {
    return callback(new Error(
      `[design-sdk] '${request}' is not in the host's shared bundle.\n` +
      `  Add it by running \`npm run build:design-sdk -- --scan\` in IOSense and ` +
      `redeploying design-sdk.global.js, or import a subpath that is included.`));
  }
  return callback(null, sub ? `FDS[${JSON.stringify(sub)}]` : 'FDS.__root');
}

export default (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: isProd ? COMPONENTS : { app: './src/index.tsx' },
    output: {
      path: path.resolve(__dirname, isProd ? 'dist-bundle' : 'dist'),
      filename: isProd ? '[name].bundle.js' : '[name].js',
      globalObject: 'this',
      clean: true,
    },
    // Externals below are UNIVERSAL: entries for a library this widget never
    // imports are simply never triggered (inert). One block fits every widget.
    externals: isProd
      ? [
        designSdkExternal,
        {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOM',
          'react-dom/server': 'ReactDOMServer',
          'react/jsx-runtime': 'ReactJSXRuntime',
          'react/jsx-dev-runtime': 'ReactJSXRuntime',
          // Highcharts widgets: host serves window.Highcharts + its modules.
          highcharts: 'Highcharts',
          'highcharts/modules/exporting': 'Highcharts',
          'highcharts/modules/export-data': 'Highcharts',
          'highcharts/modules/full-screen': 'Highcharts',
          // ApexCharts widgets (gauges): host serves window.ApexCharts. Every
          // specifier must map to it — react-apexcharts imports the SUBPATHS,
          // not bare `apexcharts`, so a bare-only external would bundle a second
          // ApexCharts (two svg.js copies → render crash on type switch).
          apexcharts: 'ApexCharts',
          'apexcharts/client': 'ApexCharts',
          'apexcharts/core': 'ApexCharts',
        },
      ]
      : [],
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      // Force a SINGLE React — design-sdk ships its own copy in dist/node_modules
      // which otherwise wins resolution and crashes hooks (useId returns null).
      alias: {
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      },
    },
    module: {
      rules: [
        // design-sdk re-exports some highcharts files extension-less; webpack 5
        // ESM refuses those without this opt-out.
        { test: /\.m?js$/, resolve: { fullySpecified: false } },
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
              ],
            },
          },
        },
        { test: /\.css$/, use: [isProd ? MiniCssExtractPlugin.loader : 'style-loader', 'css-loader'] },
        {
          test: /\.(png|jpg|jpeg|gif|webp|svg)$/i,
          type: 'asset/resource',
          generator: { filename: 'assets/[name][ext]' },
        },
      ],
    },
    plugins: [
      ...(isProd ? [new MiniCssExtractPlugin({ filename: '[name].bundle.css' })] : []),
    ],
    ...(!isProd && {
      devServer: {
        static: path.resolve(__dirname, 'public'),
        port: Number(process.env.PORT) || 3004,
        hot: true,
        open: false,
        historyApiFallback: true,
      },
    }),
  };
};
