// Tool that echoes its input. Used by subprocess sandbox tests.
export async function run(args) {
  return { echoed: args, cwd: process.cwd(), pid: process.pid };
}
