import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Write a deterministic generated file, or compare it byte-for-byte in a
 * read-only Bazel test action.
 *
 * @param {string} outputFile
 * @param {string} content
 * @param {{ check: boolean; label: string }} options
 */
export async function writeOrCheckGeneratedFile(outputFile, content, { check, label }) {
	if (check) {
		let committed;
		try {
			committed = await fs.readFile(outputFile, 'utf8');
		} catch (error) {
			throw new Error(`${label}: committed output is missing: ${outputFile}`, { cause: error });
		}
		if (committed !== content) {
			const limit = Math.min(committed.length, content.length);
			let offset = 0;
			while (offset < limit && committed[offset] === content[offset]) offset += 1;
			throw new Error(
				`${label}: committed output drifted at character ${offset}; run the registered build recipe and commit the result`,
			);
		}
		console.log(`${label}: committed output is current`);
		return;
	}

	await fs.mkdir(path.dirname(outputFile), { recursive: true });
	await fs.writeFile(outputFile, content);
}

/**
 * The generators accept one deliberately narrow test mode. Unknown arguments
 * fail closed so a misspelled validation flag cannot turn into a write.
 *
 * @param {string[]} args
 */
export function generatedFileCheckMode(args) {
	if (args.length === 0) return false;
	if (args.length === 1 && args[0] === '--check') return true;
	throw new Error(`unsupported generated-file arguments: ${args.join(' ')}`);
}
