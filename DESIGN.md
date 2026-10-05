# Toy Wars — design

A lane-defense game for the Atari 2600 (16K F6 bank switching with Atari's
Super Chip, 128 bytes of cartridge RAM; NTSC), in the
spirit of Plants vs. Zombies: toys on a shelf hold off monsters marching in
from the right. (The reference mockup is kept locally, not in the repo.)

Status: playable (2026-10-04). Built: board, batteries, all six toys, all
eight enemies, waves 1-12 with unlocks, boss waves and the second lap, lid
slams, game over, sound effects, the jet's flight in green, Game Select
(games 1-3 start at waves 1/5/9 with 30/50/70 batteries; the status line
reads GAME n while choosing) and the left difficulty switch (A: second-lap
pace and spawn gaps from wave 1), music. Everything in this document is
built.
As built, the T-Rex is a full-height 8-pixel sprite in orange, not double
width: setting player 1's width per enemy needs a fifth pull in the event
row, and the earliest-position variant has no cycles left for it. The
knight's armor shows in its sprite (with and without the shield), not as a
dark red; enemies move every other frame (half of them each frame).
Numbers as built: army man fires every 42 frames (1 damage), tank every 300
(8), cannon every 198 (3, and the same to every other monster on the shelf
within 12 pixels of the one hit: the burst is swept one monster per odd frame,
so its cost stays bounded); cowboy lasso holds 60 frames, every 120; chewing
takes 1 health every 16 frames; enemies gain 1 health every fourth wave.

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
- The trickle shrinks a little each wave; rewards keep strong defenses
  self-funding.
- Shown on the status line: `00120 W01` in gold (the score's last five digits
  and the wave, 40-pixel text) and the batteries as two big green digits drawn
  with PF1 (4-pixel blocks, x 96-123), set mid-line after the text.
- Named batteries *(decided 2026-10-04)*.

## Toys

Roster (user, 2026-10-04): army man, tank, teddy, cowboy, cannon, jet.

| Toy | Unlocks | PvZ role | Behavior | Best against |
|---|---|---|---|---|
| Army Man | wave 1 | Peashooter | Cheap; shoots along its shelf. | Dino, Mouse, Balloon Clown |
| Teddy | wave 2 | Wall-nut | High health, no attack; enemies stop and chew. | Everything that walks |
| Tank | wave 4 | Potato Mine / heavy | One heavy shell destroys the first ground enemy hit; long recharge. Can't hit flyers. | Crawler, Knight, Pogo Frog |
| Cowboy | wave 5 | Snow Pea / crowd control | Lasso: short range (about one slot ahead); ropes an enemy and holds it in place for a few seconds. | Knight's charge, Pogo Frog, packs |
| Cannon | wave 7 | Melon-pult | Slow, heavy cannonball with a small splash; breaks shields, hits flyers. | Knight, Helicopter, groups |
| Jet | wave 9 | Cherry Bomb | One-shot air strike: flies the length of its shelf, damaging every enemy on it (flyers too), then it's gone. Expensive, long recharge. | T-Rex, emergencies |

Each toy has a battery cost and a recharge time before that type can be
placed again.

Drawing note: the jet flying along its shelf is a moving object, drawn by
the enemy sprite (player 1) in green, using per-object colors *(decided
2026-10-04; built)*. It takes an enemy slot (kind 9, shelf stored as 4-6 so
no enemy check matches it), flies 4 pixels per update (about a second across)
and hits each enemy on its shelf once as its nose passes the enemy's middle;
with all enemy slots full it strikes the shelf at once instead.

## Enemies

As built (logic.asm: EnHP, EnReward, EnScore, EnMask/EnStep). Speeds in
pixels per second, first lap / second lap (wave 13+ or difficulty A); every
enemy gains 1 health every fourth wave (wave / 4), laps included.

| Kind | Enemy | PvZ equivalent | From wave | Health | Speed | Batteries / points | Trick |
|---|---|---|---|---|---|---|---|
| 1 | Dino | Basic | 1 | 6 | 15 / 30 | 3 / 10 | Walks; stops to chew toys. |
| 4 | Wind-up Mouse | Imp | 3 | 1 | 60 / 90 | 1 / 5 | Comes in packs of three. |
| 3 | Crawler | — | 4 | 3 | 30 / 60 | 2 / 10 | Low: army men's bullets pass over it while it chews; tanks and cannons still hit it. |
| 5 | Knight | Newspaper | 5 | 6 | 15 / 30; charging 60 / 90 | 4 / 20 | Shield breaks when its health drops below 3, then it charges at four times its pace (three in the second lap). |
| 8 | T-Rex (boss) | Gargantuar | 6 (and two in 12) | 20 | 7.5 / 15 | 10 / 50 | Crushes a toy in one bite. Single-width (a five-pull variant can't be scheduled). |
| 2 | Helicopter | Pole Vaulter | 7 | 5 | 30 / 60 | 3 / 15 | Hops over the first toy it reaches, once; then chews. |
| 6 | Balloon Clown | Balloon | 8 | 2 | 15 / 30 | 3 / 15 | Floats over every toy. Tank shells can't reach it; army men and cannons can. |
| 7 | Pogo Frog | lane changer | 9 | 3 | 30 / 60 | 3 / 15 | The first time a toy blocks it, it jumps to the next shelf; then it chews. |

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
  left difficulty A = second-lap speed from the start.

## Waves and difficulty

Three knobs ramp at different times: count (enemies per wave), pressure
(spawn gap, most on screen at once), mix (new types, each introduced alone
first). Speed stays fixed until the second lap.

| Wave | New toy | New enemy | Enemies | Spawn gap | Max on screen | Notes |
|---|---|---|---|---|---|---|
| 1 | Army Man | Dino | 5 | 6 s | 2 | Placing toys, batteries |
| 2 | Teddy | — | 7 | 5 s | 3 | Blocking |
| 3 | — | Mouse | 9 | 5 s | 3 | First pack |
| 4 | Tank | Crawler | 10 | 4.5 s | 3 | Crawler needs tank or teddy |
| 5 | Cowboy | Knight | 12 | 4 s | 4 | Lasso the charge; first big-wave finale |
| 6 | — | T-Rex | boss + 6 | 4 s | 4 | Boss, then a breather |
| 7 | Cannon | Helicopter | 12 | 4 s | 4 | Cannon answers flyers |
| 8 | — | Balloon Clown | 14 | 3.5 s | 4 | |
| 9 | Jet | Pogo Frog | 15 | 3.5 s | 5 | |
| 10 | — | — | 18 | 3 s | 5 | Full mix |
| 11 | — | — | 20 | 3 s | 5 | Two big waves |
| 12 | — | 2 × T-Rex | 2 bosses + 10 | 3 s | 5 | Final |
| 13+ | — | — | waves 1–12 | ×0.8 | 5 | Second lap, 25 % faster; laps repeat |

Within a wave: trickle → ramp → final burst, announced by a flash and a
sound. Score: points per enemy, bonus per shelf never breached.

## Sound

Two TIA channels, table-driven (logic.asm, SndData): channel 0 for the
player and the game (cursor tick, toy select, place/pick-up chirps, the
no-batteries buzz, the wave jingle, the game-over tune), channel 1 for the
fighting (army man pop, tank boom, cannon thump, lasso whip, hit, kill,
chewing crunch, lid slam, jet strike). A new sound replaces the one on its
channel unless that one has a higher priority. Steps are two frames long.
The sound steps and the music run in VBLANK (bank 2 through the CallSound
stub), on alternate frames, which keeps the overscan game logic short: its
worst measured frame is about 2,130 cycles of about 2,216 usable
(tools/budget.mjs).

## Music

An original 8-bar toy march (logic.asm, MelNote/BassNote): melody in eighth
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
- **RAM** *(Super Chip decided 2026-10-04; done)*: the console's 128 bytes
  hold the kernel's pointers, the event queue and scratch (88 used); game
  state lives in the Super Chip's 128 bytes (19 used so far: enemies, score,
  wave). Super Chip RAM is written at `W_name` and read at `R_name` ($80
  higher); read-modify-write instructions can't be used on it.
- **ROM**: the kernel can only read graphics in its own bank (bank 1), which
  has 3,840 bytes (the Super Chip takes the first 256 of every bank); 761 are
  free. The full roster (8 enemies × 2 frames + jet) plus color tables and
  toy sprites needs more, so the plan is: move each enemy's setup row to the
  middle of the gap before it (halves the zero padding per frame, ~90 → ~50
  bytes), share color tables, and compact the special-row code.

## Open decisions

1. Shot color behavior: keep (red just before a hit), one-line shots, or
   instant hits.
