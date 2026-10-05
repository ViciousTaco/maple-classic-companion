# Datapack notice

## MapleClassic Wiki

Records in this datapack whose `sources` cite "MapleClassic Wiki (CC BY-NC-SA 4.0)" are adapted from
**MapleClassic Wiki** (https://mapleclassic.wiki/), which is available under the
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** licence
(CC BY-NC-SA 4.0): https://creativecommons.org/licenses/by-nc-sa/4.0/

- **Attribution:** each such record names the wiki and gives the URL of the exact page it was taken from
  (`sources[].url`) together with the date it was retrieved.
- **Changes were made:** values were read from the wiki pages and re-structured into JSON records for this
  app's datapack schema. Some wording (for example training-spot notes) was rewritten in our own words.
  Ids, field names and groupings are ours. No images, sprites or icons were copied.
- Quest records (`regions/*/quests.json`) restate each quest page's walkthrough steps, requirements and rewards in
  shortened form; the quest step text is adapted from the walkthrough sentences. Skill records (`skills/*.json`) copy
  the MP cost and damage figures from each skill page's "Stats per level" table; hits and targets come from the page's
  skill box, or from the in-game skill description quoted on the same page where the two disagree (Lucky Seven
  "throw 2 throwing stars", Slash Blast "up to 4 enemies"). Item records created for quests
  cite the quest page that mentions them and the wiki's item category listing (or the item page itself for equipment).
- **NonCommercial:** the app and this datapack are a personal, non-commercial fan tool.
- **ShareAlike:** the datapack's data derived from MapleClassic Wiki is shared under the same licence,
  CC BY-NC-SA 4.0. Anyone reusing those records must keep this notice, keep the attribution, say that
  they changed it, and share their derived data under the same licence.
- These records are marked `confidence: "likely"`. The wiki labels its figures "pre-launch", so they may
  change once the live game is checked.

## Game content

MapleStory is a trademark of NEXON, and all game content (names, monsters, items, maps, characters and
artwork) belongs to Nexon. This project is an unofficial fan tool and is not affiliated with or endorsed by
Nexon or MapleClassic Wiki.
