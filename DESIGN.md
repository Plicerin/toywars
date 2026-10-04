# Toy Wars — design

A lane-defense game for the Atari 2600 (16K F6 bank switching with Atari's
Super Chip, 128 bytes of cartridge RAM; NTSC), in the
spirit of Plants vs. Zombies: toys on a shelf hold off monsters marching in
from the right. (The reference mockup is kept locally, not in the repo.)

Status: playable (2026-10-04). Built: board, batteries, all six toys, three
enemies (dino, helicopter, crawler), waves 1-12 with unlocks and the second
lap, lid slams, game over. Not yet: mouse, knight, balloon clown, pogo frog,
T-Rex, the jet's flight in green, sound, Game Select, difficulty switch.
Numbers as built: army man fires every 42 frames (1 damage), tank every 300
(8), cannon every 198 (3); cowboy lasso holds 60 frames, every 120; chewing
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
- Shown on the status line (12 narrow characters): `000120 ▮25 W1`.
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
2026-10-04)*.

## Enemies

| # | Enemy | PvZ equivalent | Health | Speed | Trick |
|---|---|---|---|---|---|
| 1 | Dino | Basic | 3 | Slow | Walks; stops to chew toys. |
| 2 | Wind-up Mouse | Imp | 1 | Fast | Comes in packs of three. |
| 3 | Crawler | — | 2 | Medium | Low: soldier shots pass over it within 16 px of the toy; only tank/teddy stop it. |
| 4 | Knight | Newspaper | 2 + 4 shield | Slow | Shield breaks → charges at double speed. |
| 5 | Helicopter | Pole Vaulter | 3 | Medium | Hops over the first toy it reaches. |
| 6 | Balloon Clown | Balloon | 2 | Slow | Floats over every toy; only soldiers hit it. |
| 7 | Pogo Frog | lane changer | 3 | Medium | When blocked, jumps to the next shelf. |
| 8 | T-Rex (boss) | Gargantuar | 20 | Very slow | Double-width sprite; crushes a toy in one bite. |

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
  (costs batteries); fire on an occupied slot picks it up (the shovel).
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
