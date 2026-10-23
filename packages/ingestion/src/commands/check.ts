import { runConnectivityChecks } from "@compliancechat/shared";

export async function checkCmd(): Promise<void> {
  const { results, ok } = await runConnectivityChecks("app");
  const width = Math.max(...results.map((r) => r.name.length));
  console.log("\nAWS connectivity & permissions:\n");
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    console.log(`  ${icon}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  console.log(`\n${ok ? "All checks passed." : "Some checks FAILED."}\n`);
  if (!ok) process.exitCode = 1;
}
