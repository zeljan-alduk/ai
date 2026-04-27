// Tool that tries to fetch a URL. Used to test egress allowlist.
export async function run(args) {
  const res = await fetch(args.url);
  return { status: res.status };
}
