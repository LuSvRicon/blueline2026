import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only material that controls the executable build and its checks. Reports,
// temporary bundles, private attachments and git metadata are deliberately out.
export function sourceFingerprint(root = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const paths = [];
  function visit(path) {
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Source fingerprint refuses symbolic link: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(resolve(path, name));
    } else if (stat.isFile()) paths.push(path);
  }
  for (const name of ['src', 'scripts', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', '.github/workflows']) visit(resolve(root, name));
  const textExtensions = new Set(['.ts','.tsx','.js','.mjs','.json','.jsonc','.html','.css','.yml','.yaml','.toml','.md']);
  const files = paths.map(path => {
    const bytes = readFileSync(path);
    // Git may check the same text out as CRLF on Windows and LF in CI. Hash
    // equivalent source identically while keeping all binary assets exact.
    const content = textExtensions.has(extname(path)) ? bytes.toString('utf8').replaceAll('\r\n','\n') : bytes;
    return { path: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(content).digest('hex') };
  });
  files.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(sourceFingerprint(), null, 2) + '\n');
}
