# Draft: asking MapleClassic Wiki for permission to sync automatically

**Nothing has been sent.** This is a draft for the owner to post (or not) on the MapleClassic Wiki Discord, from whichever
Discord account they like. It contains no personal details; add only what you're comfortable sharing.

---

Hi! I've made a small, free, non-commercial desktop companion app for MapleStory Classic World — just for my own use
(it suggests training spots and quests for my character and shows Nexon's news). Some of its guide data comes from
MapleClassic Wiki: monsters, maps, spawns, drops, NPCs and job quests, credited on every record and shared under
CC BY-NC-SA 4.0, as your licence asks.

Right now I only re-check pages by hand, one at a time. Would you be OK with a small script that checks the pages I cite
for changes about **once a day**, at a slow rate (one page every few seconds, a clear User-Agent naming the app, no
images downloaded in bulk)? If you'd prefer it to use the MediaWiki API, a dump, or a specific rate or time window,
I'm happy to follow that — or to keep doing it manually if you'd rather.

Thanks for all the work on the wiki — it's the best Classic World reference around.

---

If they say yes: schedule `npm run datapack:refresh` daily (e.g. a GitHub Actions cron that opens a "data review
needed" issue listing changed pages), following any rate/time they ask for, and record their answer in
`docs/SOURCES.md` and MASTER_PLAN §15.
