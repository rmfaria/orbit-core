import fs from 'node:fs';
import path from 'node:path';

function stateFile(stateDir: string, file: string): string {
  return path.join(stateDir, encodeURIComponent(file) + '.pos');
}

export function readPosition(stateDir: string, file: string): number {
  try {
    const val = parseInt(fs.readFileSync(stateFile(stateDir, file), 'utf8').trim(), 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

export function writePosition(stateDir: string, file: string, pos: number): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile(stateDir, file), String(pos));
}
