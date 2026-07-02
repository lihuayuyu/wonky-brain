// api/score.js — 歪腦袋比分代抓（快取 30 秒，避免限流）
export default async function handler(req, res) {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard", {
      headers: { "User-Agent": "Mozilla/5.0 (wonky-brain scoreboard)" }
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    const j = await r.json();
    const matches = (j.events || []).map(ev => {
      const c = (ev.competitions || [])[0] || {};
      const st = c.status || ev.status || {};
      const cs = c.competitors || [];
      const h = cs.find(x => x.homeAway === "home") || cs[0] || {};
      const a = cs.find(x => x.homeAway === "away") || cs[1] || {};
      const side = x => {
        const t = x.team || {};
        return {
          abbr: String(t.abbreviation || "").toUpperCase(),
          name: t.shortDisplayName || t.displayName || "",
          score: (x.score != null && x.score !== "") ? String(x.score) : "-",
          pk: (x.shootoutScore != null && x.shootoutScore !== "") ? String(x.shootoutScore) : null
        };
      };
      return {
        id: String(ev.id || ""), date: ev.date || "",
        state: (st.type && st.type.state) || "",
        detail: (st.type && st.type.shortDetail) || (st.type && st.type.description) || "",
        clock: st.displayClock || "",
        home: side(h), away: side(a)
      };
    });
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ matches });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
