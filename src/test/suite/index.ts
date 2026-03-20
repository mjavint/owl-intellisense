import * as path from 'path';
import Mocha from 'mocha';

export function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise<void>((resolve, reject) => {
		const files = [
			'index.test.js',
			'scanner.test.js',
			'addonDetector.test.js',
			'owlAliasResolver.test.js',
			'definition.test.js',
			'hover.test.js',
			'rules.test.js',
			'references.test.js',
			'symbols.test.js',
			'codeActions.test.js',
			'perf.test.js',
			'deepCompletion.test.js',
			'parser.test.js',
			'extension.test.js',
		];

		files.forEach((f) => {
			mocha.addFile(path.resolve(testsRoot, f));
		});

		try {
			mocha.run((failures: number) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}
