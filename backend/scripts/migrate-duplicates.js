const fs = require('fs');
const { execSync } = require('child_process');

console.log("=== Merchant Profile Duplicate Cleanup Script ===");

// We build a query to find all duplicate emails
const duplicateQuery = `
  SELECT lower(email) as em, COUNT(*) as c
  FROM merchant_profiles
  WHERE email IS NOT NULL AND email != ''
  GROUP BY lower(email)
  HAVING c > 1;
`;

// Helper to run local wrangler D1 commands
function runD1Sql(sql, format="json") {
  const tmpFile = `./temp_mig_${Date.now()}.sql`;
  fs.writeFileSync(tmpFile, sql);
  const cmd = `npx wrangler d1 execute crypto-tracker --file="${tmpFile}" --json`;
  try {
    const out = execSync(cmd, { encoding: 'utf8' }).trim();
    // wrangler sometimes outputs some logs before the JSON array.
    const startIdx = out.indexOf('[');
    if (startIdx >= 0) {
      fs.unlinkSync(tmpFile);
      return JSON.parse(out.slice(startIdx));
    }
    fs.unlinkSync(tmpFile);
    return JSON.parse(out);
  } catch (err) {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (!sql.includes("SELECT")) return []; // Ignore delete/update output errors if they worked
    console.error("SQL failed:", sql);
    console.error(err.message);
    return [];
  }
}

async function main() {
  console.log("Fetching duplicates...");
  const dupes = runD1Sql(duplicateQuery);
  
  // Unwrap nested array if present
  const results = Array.isArray(dupes) && Array.isArray(dupes[0]?.results) 
    ? dupes[0].results 
    : (Array.isArray(dupes) ? dupes : []);

  if (!results.length) {
    console.log("No duplicate emails found. DB is clean!");
    return;
  }

  console.log(`Found ${results.length} emails with duplicate merchant profiles.`);

  for (const dup of results) {
    const email = dup.em;
    console.log(`\nProcessing email: ${email} (${dup.c} profiles)`);

    const profilesQuery = `SELECT id, created_at FROM merchant_profiles WHERE lower(email) = '${email.replace(/'/g, "''")}' ORDER BY created_at ASC`;
    const profileRes = runD1Sql(profilesQuery);
    
    // Safety unwrap
    const rows = Array.isArray(profileRes) && Array.isArray(profileRes[0]?.results) ? profileRes[0].results : (Array.isArray(profileRes) ? profileRes : []);
    
    if (rows.length <= 1) continue;

    const canonical = rows[0];
    const toBurn = rows.slice(1);

    console.log(`  Canonical ID: ${canonical.id} (Keeping)`);
    
    for (const falseProfile of toBurn) {
      console.log(`  Migrating away from ID: ${falseProfile.id} ...`);

      // Reassign relationships acting as A
      runD1Sql(`UPDATE merchant_relationships SET merchant_a_id = '${canonical.id}' WHERE merchant_a_id = '${falseProfile.id}'`);
      
      // Reassign relationships acting as B
      runD1Sql(`UPDATE merchant_relationships SET merchant_b_id = '${canonical.id}' WHERE merchant_b_id = '${falseProfile.id}'`);

      // Reassign deals (if tracked directly to merchant id in other columns)
      // Usually deals are tied to relationship_id or user_id, but if there's any merchant_id hardlinks:
      runD1Sql(`UPDATE merchant_deals SET merchant_id = '${canonical.id}' WHERE merchant_id = '${falseProfile.id}'`);
      
      // Reassign invites
      runD1Sql(`UPDATE merchant_invites SET from_merchant_id = '${canonical.id}' WHERE from_merchant_id = '${falseProfile.id}'`);
      runD1Sql(`UPDATE merchant_invites SET to_merchant_id = '${canonical.id}' WHERE to_merchant_id = '${falseProfile.id}'`);

      // Delete the duplicate
      console.log(`  Deleting duplicate profile ${falseProfile.id}`);
      runD1Sql(`DELETE FROM merchant_profiles WHERE id = '${falseProfile.id}'`);
    }
    
    console.log(`  Finished cleaning ${email}.`);
  }

  console.log("\nCleanup complete.");
}

main().catch(console.error);
