// Tool that returns its env + cwd contents (top level basenames).
import { readdirSync } from 'node:fs';
export async function run() {
  return {
    env: { ...process.env },
    cwd: process.cwd(),
    cwdEntries: readdirSync(process.cwd()),
  };
}
