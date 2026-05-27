import { fetchAttackCosts, writeAttackCostsTable } from "./fetchAttackCosts";

(async () => {
  const results = await fetchAttackCosts();
  await writeAttackCostsTable(results);
  console.log(`\n✓ Done. ${results.length} total entries cached.`);
})();
