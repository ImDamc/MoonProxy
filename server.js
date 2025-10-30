import express from "express"

const app = express()
const PORT = process.env.PORT || 10000

app.get("/", (req, res) => res.send("Proxy active"))

app.get("/search", (req, res) => {
  const q = (req.query.q || "").trim()
  if (!q) return res.status(400).json({ error: "missing q" })
  const url = "https://www.google.com/search?q=" + encodeURIComponent(q)
  res.redirect(url)
})

app.listen(PORT, () => console.log("Running on", PORT))
