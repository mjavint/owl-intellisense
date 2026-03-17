const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const clientCtx = await esbuild.context({
		entryPoints: ['src/client/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/client/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	const serverCtx = await esbuild.context({
		entryPoints: ['src/server/server.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/server/server.js',
		external: [],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	if (watch) {
		await Promise.all([clientCtx.watch(), serverCtx.watch()]);
	} else {
		await Promise.all([clientCtx.rebuild(), serverCtx.rebuild()]);
		await Promise.all([clientCtx.dispose(), serverCtx.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
