import { cp, rename, rm } from 'node:fs/promises';

async function main() {
  await rm('build', { recursive: true, force: true });
  try {
    await rename('out', 'build');
  } catch {
    await cp('out', 'build', { recursive: true });
    await rm('out', { recursive: true, force: true });
  }
  console.log('Prepared deploy folder: build/');
}

main().catch((err) => {
  console.error('Failed to prepare build folder:', err);
  process.exit(1);
});
