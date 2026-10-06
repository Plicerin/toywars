# Toy Wars — design

A lane-defense game for the Atari 2600 (16K F6 bank switching with Atari's
Super Chip, 128 bytes of cartridge RAM; NTSC), in the
spirit of Plants vs. Zombies: toys on a shelf hold off monsters marching in
from the right. (The reference mockup is kept locally, not in the repo.)

Status: playable (2026-10-04). Built: board, batteries, all six toys, all
eight enemies, waves 1-12 with unlocks, boss waves and the second lap, lid
slams, game over, sound effects, the jet's flight in green, Game Select
(games 1-3 start at waves 1/5/9 with 30/50/70 batteries; the status line
reads GAME n while choosing) and the left difficulty switch (A: shorter spawn
gaps from wave 1 at the first-lap pace; in the second lap shorter still, and
every enemy one health tougher), music. Everything in this document is
built.
As built, the T-Rex is a full-height 8-pixel sprite in orange, not double
width: setting player 1's width per enemy needs a fifth pull in the event
row, and the earliest-position variant has no cycles left for it. The
knight's armor shows in its sprite (with and without the shield), not as a
dark red; enemies move every other frame (half of them each frame).
Numbers as built: army man fires every 42 frames (1 damage), tank every 300
(8), cannon every 198 (3, and the same to every other monster on the shelf
within 12 pixels of the one hit: the burst is swept one monster per odd frame,
so its cost stays bounded); a jack-in-the-box springs once for 20 on every
enemy within 8 pixels of the one that sprang it and throws each survivor 16
pixels back up the shelf, short of the next column's toy (the same sweep); chewing
takes 1 health every 16 frames; enemies gain 1 health every fourth wave
(wind-up mice and balloon clowns every eighth).

## Board

- 3 slanted shelves × 3 slots (player 0 drawn as three copies, so toys never
  flicker). The toy box on the left is the "house"; enemies enter from the
  right edge of each shelf.
- An enemy reaching the toy box triggers that shelf's **lid slam** once (the
  lawnmower): the box flashes and every enemy on that shelf is cleared. A
  second breach of the same shelf ends the game. *(decided 2026-10-04)*

## Resource: batteries

- The roster has no generator toy, so batteries come from a timer trickle
  plus a reward for every enemy destroyed (more for armored ones and
  bosses). No collecting (a joystick can't chase falling sun comfortably).
  *(decided 2026-10-04)*
- The trickle is one battery every 240 frames (4 s) in the first lap and
  every 150 (2.5 s) in the second, where the cannon layout ran short
  *(2026-10-05)*; batteries cap at 99, and any the trickle or a kill would
  add over the cap become points, one each (a pick-up's refund doesn't)
  *(2026-10-06: strong layouts sat at the cap a third of the second lap)*. Rewards are small (1-2, the T-Rex 5) *(tuned 2026-10-04 with
  tools/player.mjs: at 1.5 s and the old rewards, 3/3/2/1/4/3/3/10, batteries
  sat near the cap 44% of the time and spending was never a choice)*.
- Shown on the status line: `00120 W01` in gold (the score's last five digits
  and the wave, 40-pixel text) and the batteries as two big green digits drawn
  with PF1 (4-pixel blocks, x 96-123), set mid-line after the text.
- Named batteries *(decided 2026-10-04)*.

## Toys

Roster (user, 2026-10-04): army man, tank, teddy, cowboy, cannon, jet. The
cowboy was replaced by the jack-in-the-box *(2026-10-06: no strategy ever
bought it; it cost a shooter's slot and did no damage)*.

As built (logic.asm: ToyCost, ToyHP, ToyDmg, ToyPeriod). A toy acts on every
sixth frame (one shelf per odd frame); its first action comes 30 frames after
it's placed. Shooters fire only at a monster to their right, and each shelf
has one shot in flight at a time, shared by its toys.

| Toy | Unlocks | Cost | Health | PvZ role | Behavior | Best against |
|---|---|---|---|---|---|---|
| Army Man | wave 1 | 10 | 8 | Peashooter | A bullet every 0.7 s (42 frames), 1 damage. Bullets pass over a chewing crawler. | Dino, Mouse, Balloon Clown |
| Teddy | wave 2 | 5 | 40 | Wall-nut | No attack; walkers stop and chew it (1 health every 16 frames, about 11 s for one chewer). A T-Rex crushes it in one bite. | Holding anything that walks |
| Tank | wave 4 | 25 | 12 | heavy shooter | A shell every 5 s (300 frames), 8 damage. Shells can't hit the balloon clown. | Knight, Helicopter, Crawler |
| Jack-in-the-box | wave 5 | 15 | 8 | Potato Mine | One use: the first walker to reach it springs it with a boing, and every enemy within 8 pixels of that one takes 20 and, if it survives, is thrown 16 pixels back up the shelf, short of the next column's toy (through the burst sweep, one a frame), then it's gone. A T-Rex, a helicopter (instead of hopping) or a pogo frog (instead of jumping) springs it; balloons float over it, though the sweep can catch one passing. While another burst (cannon splash, jet strike) is being swept, a walker at a jack waits; no jet can be placed while a jack's spring is being swept *(2026-10-06, after the seventh playtest: centred reach, 20 damage, throw 16, the waits)*. | Mouse packs, T-Rex |
| Cannon | wave 7 | 20 | 10 | Melon-pult | A cannonball every 3.3 s (198 frames), 3 damage, splashing the same to every other monster on the shelf within 12 pixels of the one hit. Hits balloons and chewing crawlers. | Crowds at a teddy, Crawler, Balloon Clown |
| Jet | wave 9 | 30 | — | Cherry Bomb | One use: takes off from the toy box end of its shelf and flies it in about a second, hitting every monster on it once for 10 damage. It never stands in the slot, so it can launch where a monster stands. | T-Rex, emergencies |

Placing costs batteries only (no per-toy recharge). Picking a toy up gives
half its cost back. A toy can't go down where a monster stands (the balloon
clown floats over toys, so it doesn't count).

Drawing note: the jet flying along its shelf is a moving object, drawn by
the enemy sprite (player 1) in green, using per-object colors *(decided
2026-10-04; built)*. It takes an enemy slot (kind 9, shelf stored as 4-6 so
no enemy check matches it), flies 4 pixels per update (about a second across)
and hits each enemy on its shelf once its nose has passed the enemy's middle
(its unused health byte marks the enemy slots hit, so each is hit exactly
once; at most two an update, so a bunched pack never dies in one frame).
With all enemy slots full it strikes the shelf as a burst instead: one enemy
an odd frame, through the cannon's splash sweep (about ten frames).

## Enemies

As built (logic.asm: EnHP, EnReward, EnScore, EnMask/EnStep). Speeds in
pixels per second, first lap / second lap (wave 13+); every
enemy gains 1 health every fourth wave (wave / 4), laps included; wind-up mice
and balloon clowns every eighth (wave / 8); balloon clowns also keep their
first-lap pace in the second lap *(2026-10-06: they ended 46 of 47 lid slams
for the strongest layout, crossing before army men and cannons could hit
them enough)* *(2026-10-05: at wave / 4 a wave-20
mouse had six times its base health and a balloon three and a half, and the
two caused about three quarters of the bot's second-lap losses)*.

| Kind | Enemy | PvZ equivalent | From wave | Health | Speed | Batteries / points | Trick |
|---|---|---|---|---|---|---|---|
| 1 | Dino | Basic | 1 | 6 | 15 / 30 | 2 / 10 | Walks; stops to chew toys. |
| 4 | Wind-up Mouse | Imp | 3 | 1 | 60 / 90 | 1 / 5 | Comes in packs of three. |
| 3 | Crawler | — | 4 | 3 | 30 / 60 | 1 / 10 | Low: army men's bullets pass over it while it chews; tanks and cannons still hit it. |
| 5 | Knight | Newspaper | 5 | 6 | 15 / 30; charging 60 / 90 | 2 / 20 | Shield breaks when its health drops below 3, then it charges at four times its pace (three in the second lap). |
| 8 | T-Rex (boss) | Gargantuar | 6 (and two in 12) | 20 | 7.5 / 15 | 5 / 50 | Crushes a toy in one bite. Single-width (a five-pull variant can't be scheduled). |
| 2 | Helicopter | Pole Vaulter | 7 | 5 | 30 / 60 | 2 / 15 | Hops over the first toy it reaches, once; then chews. |
| 6 | Balloon Clown | Balloon | 8 | 2 | 15 / 15 | 2 / 15 | Floats over every toy. Tank shells can't reach it; army men and cannons can. |
| 7 | Pogo Frog | lane changer | 9 | 3 | 30 / 60 | 2 / 15 | The first time a toy blocks it, it jumps to the next shelf; then it chews. |

All enemies have a two-frame walk (frame chosen by `(x >> 2) & 1`).

Per-object colors *(decided 2026-10-04)*: every object player 1 draws picks
its color (red for most enemies, dark red for armor, orange for the boss,
green for the jet). The kernel reads the color per row from a table page per
color, so each color costs a 160-byte page in bank 1, and each event-queue
record gains one byte (the page).

## Controls

- Joystick moves a cursor over the 9 slots; the slot shows a flashing ghost
  of the toy about to be placed.
- Hold fire + left/right cycles the toy; fire on an empty slot places it
  (costs batteries; not on a monster standing there, which could hold it out
  of every shot's reach for good; a jet, which takes off, is fine); fire on an occupied slot picks it up (the shovel).
- Game Reset starts; Game Select picks game 1/2/3 (start at wave 1/5/9);
  left difficulty A = the second lap's shorter spawn gaps (three quarters)
  from the start, and five eighths in the second lap, where every enemy also
  has one more health (A_LAP2_HP; tuned 2026-10-05: shorter gaps alone left
  the bot's results on A the same as on B; +1 health ends heavy runs about
  2.4 waves sooner, +2 made a wall at wave 16); the pace stays the first lap's
  until wave 13 *(changed 2026-10-05: A
  used to mean the second-lap pace too, and even a perfect opening lost a
  lid in wave 1 in 8 of 10 games)*.

## Waves and difficulty

Three knobs ramp at different times: count (enemies per wave), pressure
(spawn gap, most on screen at once), mix (each wave adds its new kind to the
kinds chosen at random; mice come in packs of three, and a boss wave starts
with its T-Rexes). Speed stays fixed until the second lap.

Each spawn's shelf comes from a shuffle bag of six (each shelf twice, in
random order), so the shelves get exactly even shares; an 8-bit LFSR read on
the spawn timer's beat leaned to some shelves.

"Enemies" counts spawns: a wind-up mouse pack is one spawn of three mice, so
a wave with mice brings more monsters than its count (wave 3's 9 spawns can
be about 20 monsters). A wave ends when its last spawn, including the rest of
a pack, has arrived and every enemy is gone. "Max on screen" holds back new
spawns only: a pack's two followers come whenever an enemy slot is free, so a
pack can briefly take the count to five.

| Wave | New toy | New enemy | Enemies | Spawn gap | Max on screen | Notes |
|---|---|---|---|---|---|---|
| 1 | Army Man | Dino | 5 | 6 s | 2 | Placing toys, batteries |
| 2 | Teddy | — | 7 | 5 s | 3 | Blocking |
| 3 | — | Mouse | 9 | 5 s | 3 | First pack |
| 4 | Tank | Crawler | 10 | 4.5 s | 3 | Bullets pass over a chewing crawler: tanks |
| 5 | Jack-in-the-box | Knight | 12 | 4 s | 4 | A trap for the charge |
| 6 | — | T-Rex | boss + 6 | 4 s | 4 | Boss, then a breather |
| 7 | Cannon | Helicopter | 12 | 4 s | 4 | Cannon answers flyers |
| 8 | — | Balloon Clown | 14 | 3.5 s | 4 | |
| 9 | Jet | Pogo Frog | 15 | 3.5 s | 5 | |
| 10 | — | — | 18 | 3 s | 5 | Full mix |
| 11 | — | — | 20 | 3 s | 5 | |
| 12 | — | 2 × T-Rex | 2 bosses + 10 | 3 s | 5 | Final |
| 13+ | — | — | waves 1–12 | ×0.75 (A ×0.625) | 5 | Second lap: every kind at its fast pace (about twice as fast); laps repeat |

Within a wave the spawn gap is constant; the next wave starts when its last
enemy is gone. The shelves flash white only for a lid slam or a jet. Score:
points per enemy (5 to 50), no bonuses.

## Sound

Two TIA channels, table-driven (sound.asm, SndData; SndPlay in logic.asm): channel 0 for the
player and the game (cursor tick, toy select, place/pick-up chirps, the
no-batteries buzz, the wave jingle, the game-over tune), channel 1 for the
fighting (army man pop, tank boom, cannon thump, jack-in-the-box boing, hit, kill,
chewing crunch, lid slam, jet strike). A new sound replaces the one on its
channel unless that one has a higher priority. Steps are two frames long.
The sound steps and the music run in VBLANK (bank 3, sound.asm, through the
CallSound stub), on alternate frames, which keeps the overscan game logic
short. One frame's heavy work is also bounded: the shots go first, and once
an enemy has died that frame a jet hits one enemy instead of two, an enemy
about to reach the toy box waits an update, and the spawner waits a frame
(tools/budget.mjs measures the logic time; about 2,216 cycles are usable).

## Music

An original 8-bar toy march (sound.asm, MelNote/BassNote): melody in eighth
notes on the pentatonic C5 D5 E5 G5 A5 C6 (pure tone, AUDC 4), bass in
quarters on F3 G3 A3 C4 E3 (AUDC 12), all within 19 cents of true pitch.
An eighth is 12 frames (150 quarter notes a minute). Before a game and at
game over the melody (channel 0) and bass (channel 1) play; during play only
the melody, at volume 3, and only when no sound effect has channel 0.

## Hardware limits the design accepts

- **Shots**: one in flight per shelf (missile 1, one pointer per shelf);
  soldiers on a shelf take turns. Shots share the enemy sprite's color, so
  they turn red when they share lines with an enemy, just before a hit.
  *(open: keep, one-line shots, or instant hits)*
- **Enemies**: at most 5 on screen (event queue); enemies that share lines
  take turns (flicker). The longest any enemy goes undrawn is 6 frames.
- **Toys**: all green (one color for player 0's three copies), 8 px wide;
  six toy sprites (plus a second frame each where they animate).
- **RAM** *(as built, 2026-10-05)*: the console's 128 bytes hold the
  kernel's pointers, the event queue and scratch (106 used; the deepest
  stack outside the kernel leaves about 9 bytes spare). Game state lives in
  the Super Chip's 128 bytes, now all used (enemies, toys, shots, score,
  wave, batteries, sound, the splash/jet burst, the spawn bag, the status
  line). Super Chip RAM is written at `W_name` and read at `R_name` ($80
  higher); read-modify-write instructions can't be used on it. A new feature
  needing RAM must free some first.
- **ROM** *(as built)*: 16K in four 4K banks, each losing its first 256
  bytes to the Super Chip window. Bank 0: frame loop, header and status
  kernel, the enemy scheduler (about 950 bytes free). Bank 1: the play
  kernel and all graphics, which it must read from its own bank (about 40
  free; enemy frames are padded 40 zeros, setup rows sit mid-gap). Bank 2:
  game logic, logic.asm (about 400 free). Bank 3: sound steps and music,
  sound.asm (about 3,250 free). Bank calls go through stubs at $FFB0
  (sound), $FFC0 (init) and $FFD0 (logic).

## Open decisions

1. Shot color behavior: keep (red just before a hit), one-line shots, or
   instant hits.
