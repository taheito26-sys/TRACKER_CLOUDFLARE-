fetch("http://127.0.0.1:8787/api/merchant/profile/ensure", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-User-Email": "taheito26@gmail.com",
    "X-User-Id": "compat:taheito26@gmail.com"
  },
  body: JSON.stringify({
    nickname: "test_master_key",
    display_name: "Master Key Tester",
    merchant_type: "independent",
    region: "Global",
    discoverability: "public",
    bio: "Testing the Master Key DB Wipe"
  })
}).then(r => r.json()).then(data => {
  console.log("Ensure Profile Response:");
  console.log(JSON.stringify(data, null, 2));
}).catch(err => {
  console.error(err);
});
