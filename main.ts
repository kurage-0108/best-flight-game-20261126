// Packs the entry: copies game/ and screenshots/ from beside this file into the output
// directory and writes dossier.json there with the competition library's buildDossier.
// Node 22+, standard library only, erasable TypeScript (runs as `node main.ts`).

import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const repoDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** Replaces `outputDir/name` with a fresh copy of `repoDir/name`. */
function copyDirectory(name: string): void {
  const from = join(repoDir, name);
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    throw new Error(`${name}/ is missing beside main.ts`);
  }
  const to = join(outputDir, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, dereference: false, errorOnExist: false });
}

function main(): void {
  mkdirSync(outputDir, { recursive: true });
  copyDirectory('game');
  copyDirectory('screenshots');
  const dossier = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  console.log(`dossier.json written to ${outputDir} (${dossier.length} bytes)`);
}

try {
  main();
} catch (err) {
  console.error(`main.ts: ${(err as Error).message}`);
  process.exit(1);
}
