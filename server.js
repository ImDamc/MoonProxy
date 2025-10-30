import express from "express"
import fetch from "node-fetch"

const app = express()
const PORT = process.env.PORT || 10000

app.get("/", (req, res) => res.send("Proxy active"))

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim()
  if (!q) return res.status(400).json({ error: "missing q" })

  const url = "https://www.google.com/search?q=" + encodeURIComponent(q)

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36"
      }
    })

    res.set("Content-Type", r.headers.get("content-type") || "text/html")
    const body = await r.text()
    res.send(body)
  } catch (e) {
    console.error(e)
    res.status(500).send("Failed to fetch page")
  }
})

app.listen(PORT, () => console.log("Running on", PORT))
