import express from "express"
import fetch from "node-fetch"

const app = express()
const PORT = process.env.PORT || 10000

app.get("/", (req, res) => res.send("Proxy active"))

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim()
  if (!q) return res.status(400).send("missing q")

  const url = "https://duckduckgo.com/html/?q=" + encodeURIComponent(q)

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
      }
    })

    res.set("Content-Type", r.headers.get("content-type") || "text/html")
    const body = await r.text()
    res.send(body)
  } catch (e) {
    console.error(e)
    res.status(500).send("Failed to fetch")
  }
})

app.listen(PORT, () => console.log("Running on", PORT))
