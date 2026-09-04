<!-- Draft LinkedIn post. Paste into LinkedIn; trim/adjust voice as you like. -->

I built an AI agent that controls my browser — then benchmarked it to check if my "clever" idea was actually clever.

It wasn't. And that turned out to be the most useful result. 👇

The setup: a Chrome extension that turns a webpage into a compact, semantic view for an LLM, so an agent can read the page and click/type in my *real* browser (real logins, real sessions). I was convinced the win would come from representing the page as a structured graph instead of a flat list.

So I measured it on real pages. Three findings:

1️⃣ Feeding the model a semantic view instead of raw HTML is a massive win: 17–105× fewer tokens (Wikipedia 64k → 3.7k tokens; a news homepage 85k → 2.6k). If your agent dumps raw HTML into the context, you're paying 10–100× more per step than you need to.

2️⃣ My "clever" graph was NOT smaller than a plain flat list — it was ~1.2× bigger. The token savings come from semantic extraction in general, not from the fancy structure. My core assumption was wrong, and one afternoon of benchmarking told me that instead of six months of hindsight.

3️⃣ A gotcha for anyone building this: reading the page via eval() breaks on strict-CSP sites (GitHub, MDN). Read the DOM from the extension's isolated world instead.

Then I did the humbling part — I searched the market. Turns out this is a crowded space: browser-use (100k+ stars), real-browser-mcp, Vercel's Agent-Browser, and others already ship nearly this exact architecture. There was no secret sauce and nothing to patent.

The takeaway I keep coming back to:

→ Measure your assumptions before you fall in love with them.
→ "Is this novel?" is a 30-minute search, not a 6-month build.
→ Sometimes the real deliverable isn't the product — it's the honest number that saves you (and everyone who reads it) from a wrong assumption.

Shipping the code + the full benchmark writeup as open source. If you're building web agents: skip raw HTML, measure your representation, and don't assume structure = savings.

#AI #LLM #Agents #BrowserAutomation #BuildInPublic #Engineering
