import fetch from 'node-fetch';
const res = await fetch("http://localhost:3000/api/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "昨日は東京へ行きました" })
});
console.log(await res.json());
