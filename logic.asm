; TOY WARS game logic (bank 2), included by toywars.asm.
;
; LogicInit runs once at power-on, Logic once per frame in overscan. Game
; state is in Super Chip RAM: read at R_name, written at W_name, so every
; change is load / modify / store (no INC/DEC on it). Toys and shots take
; turns: shots move on even frames, toys act on odd ones.

TOY_ARMY    = 1
TOY_TEDDY   = 2
TOY_TANK    = 3
TOY_JACK    = 4
TOY_CANNON  = 5
TOY_JET     = 6
EN_DINO     = 1
EN_HELI     = 2
EN_CRAWL    = 3
EN_MOUSE    = 4
EN_KNIGHT   = 5
EN_BALLOON  = 6
EN_POGO     = 7
EN_TREX     = 8
EN_JET      = 9                 ; a launched jet (drawn like an enemy, in green)
NKINDS      = 9                 ; (kind 0 = none; the jet has no pace entry)
SHOT_ARMY   = 1
SHOT_TANK   = 2
SHOT_CANNON = 3
SPLASH      = 12                ; a cannonball's splash reach, pixels each way
CANNON_DMG  = 3
JET_DMG     = 10
KILLED      = temp+3            ; this frame an enemy died or a toy went down (the
                                ;   spawner waits; overscan only: VBLANK uses temp)
JACK_DMG    = 20                ; a jack-in-the-box's spring: damage to each enemy
JACK_REACH  = 8                 ;   within this many pixels of the one that sprang it,
JACK_THROW  = 16                ;   thrown this many pixels back up the shelf (short of
                                ;   the next column's toy: it springs at x + 8 at most)
TRICKLE     = 240               ; frames per battery (one byte: at most 255)
A_LAP2_HP   = 1                 ; extra health for every enemy in the second lap on difficulty A
TRICKLE2    = 150               ;   in the second lap (2.5 s)
ST_ATTRACT  = 0
ST_PLAY     = 1
ST_OVER     = 2
COL_WHITE   = $0E
BREACH_X    = 41                ; an enemy left of this is at the toy box
JET_X0      = BREACH_X - 1      ; where a jet takes off

; sound effects (ids into SndStart/SndChan/SndPri)
SND_CURSOR  = 0
SND_SELECT  = 1
SND_PLACE   = 2
SND_PICK    = 3
SND_NOBATT  = 4
SND_WAVE    = 5
SND_OVER    = 6
SND_POP     = 7
SND_BOOM    = 8
SND_THUMP   = 9
SND_SPRING  = 10
SND_HIT     = 11
SND_KILL    = 12
SND_CHEW    = 13
SND_SLAM    = 14
SND_JET     = 15

    MAC SOUND                   ; play sound {1} (keeps X and Y)
    lda #{1}
    jsr SndPlay
    ENDM

;-------------------------------------------------------------------------------
LogicInit:
    SUBROUTINE
    lda #1
    sta W_rand
    lda #ST_ATTRACT
    sta W_state
    lda #1
    sta W_game
    jsr ClearBoard
    lda #$20                    ; the status line shows GAME 1
    sta W_dirty
    rts

;-------------------------------------------------------------------------------
Logic:
    SUBROUTINE
    jsr Random
    ; Game Reset starts a new game (on the press)
    lda SWCHB
    lsr
    bcs .noReset
    lda R_swPrev
    bne .input
    lda #1
    sta W_swPrev
    jsr NewGame
    jmp .input
.noReset:
    lda #0
    sta W_swPrev
.input:
    jsr GameSelect
    ; from wave 13: second-lap pace (bit 7) and shorter spawn gaps (bit 6);
    ; the left difficulty on A: the shorter gaps from the start, and bit 5
    ; (shorter still in the second lap)
    lda SWCHB
    and #$40
    beq .difficultyB
    lda #$60
.difficultyB:
    tay
    lda R_wave
    cmp #13
    tya                         ; (keeps the carry)
    bcc .fast
    ora #$C0
.fast:
    sta fast
    jsr ReadInput
    lda R_state
    cmp #ST_PLAY
    beq .play
    cmp #ST_OVER
    beq .over
    lda lt2                     ; attract: fire starts a game
    bpl .finish
    jsr NewGame
    jmp .finish
.over:
    lda R_overTimer             ; game over: fire again after two seconds
    beq .overReady
    sec
    sbc #1
    sta W_overTimer
    jmp .finish
.overReady:
    lda lt2
    bpl .finish
    jsr NewGame
    jmp .finish
.play:
    lda #0
    sta KILLED
    jsr Cursor
    jsr Batteries
    ; one frame's heavy work is bounded: the shots go first, and once an enemy
    ; has died (KILLED) a jet hits one enemy, not two, an enemy waits an update
    ; before reaching the toy box, and the spawner waits for the next frame
    lda frame
    lsr
    bcs .odd
    jsr Shots
    jsr Enemies
    jsr Spawner
    jmp .finish
.odd:
    jsr Enemies
    jsr Toys
    jsr Splash
.finish:
Finish:
    jsr Flash
    lda frame                   ; odd frames (with the toys): the kernel's toy
    lsr                         ; pointers
    bcc .evenFinish
    jmp SlotPointers
.evenFinish:
    rts

;-------------------------------------------------------------------------------

;-------------------------------------------------------------------------------
; GameSelect: on the press, a game in progress (or over) ends and the
; selection shows; pressed again, the next game (1-3). Reset or fire starts it.
GameSelect:
    SUBROUTINE
    lda SWCHB
    and #$02
    bne .released
    lda R_selPrev
    bne .done
    lda #1
    sta W_selPrev
    lda R_state
    cmp #ST_ATTRACT
    beq .next
    lda #ST_ATTRACT
    sta W_state
    jsr ClearBoard
    jmp .show
.next:
    lda R_game
    clc
    adc #1
    cmp #4
    bcc .set
    lda #1
.set:
    sta W_game
.show:
    lda #$20
    sta W_dirty
    SOUND SND_SELECT
.done:
    rts
.released:
    lda #0
    sta W_selPrev
    rts

GameWave:   .byte 0, 1, 5, 9
GameBatt:   .byte 0, 30, 50, 70

;-------------------------------------------------------------------------------
ClearBoard:
    SUBROUTINE
    ldx #8
.slots:
    lda #0
    sta W_slotType,x
    sta W_slotHP,x
    sta W_slotCool,x
    lda EmptyLo,x               ; and the kernel's pointer, right away
    sta slotPtr,x
    dex
    bpl .slots
    lda #0
    ldx #NENEMY-1
.enemies:
    sta W_eType,x
    sta W_eState,x
    dex
    bpl .enemies
    lda #$FF
    ldx #NENEMY-1
.rows:
    sta eTop,x
    sta W_eLane,x
    dex
    bpl .rows
    lda #0
    ldx #2
    sta W_splashN
    sta W_bag
.shots:
    lda #0
    sta W_shotDmg,x
    lda #80                     ; 80 = no shot (the pointer reads zeros)
    sta shotPtr,x
    dex
    bpl .shots
    lda #0
    sta W_flash
    sta W_packLeft
    rts

NewGame:
    SUBROUTINE
    jsr ClearBoard
    lda #0
    sta W_score
    sta W_score+1
    sta W_score+2
    sta W_lids
    sta W_battTimer
    sta W_repeat
    sta W_fireState
    ldx R_game                  ; games 2 and 3 start later, with more batteries
    lda GameBatt,x
    sta W_batt
    lda GameWave,x
    sta W_wave
    lda #1
    sta W_toy
    lda #3                      ; cursor on the middle shelf, first column
    sta W_cursor
    lda #ST_PLAY
    sta W_state
    lda #$80                    ; fire counts as held: the press that started the game does nothing
    sta W_input
    lda #7
    sta W_dirty
    jmp StartWave

; StartWave: set up the wave in W_wave (enemy count, the toys unlocked)
StartWave:
    SUBROUTINE
    jsr WaveIndex
    lda WaveCount,x
    sta W_spawnLeft
    lda WaveBoss,x
    sta W_bossLeft
    lda #90                     ; a three-second breather (ticks of 2 frames)
    sta W_spawnTimer
    lda R_wave
    cmp #13
    bcc .lap1
    lda #TOY_JET                ; second lap and later: every toy
    bne .unlock
.lap1:
    lda WaveUnlock,x
.unlock:
    sta W_unlock
    lda R_dirty
    ora #4
    sta W_dirty
    SOUND SND_WAVE
    rts

WaveIndex:                      ; X = (wave - 1) mod 12
    SUBROUTINE
    lda R_wave
    sec
    sbc #1
.mod:
    cmp #12
    bcc .done
    sbc #12
    jmp .mod
.done:
    tax
    rts

;-------------------------------------------------------------------------------
Random:                         ; 8-bit Galois LFSR
    SUBROUTINE
    lda R_rand
    lsr
    bcc .noEor
    eor #$B4
.noEor:
    sta W_rand
    rts

; ReadInput: lt1 = this frame's input (bits 3-0 right left down up, bit 7
; fire; 1 = pressed), lt2 = pressed since last frame, lt3 = last frame's
ReadInput:
    SUBROUTINE
    lda SWCHA
    eor #$FF
    lsr
    lsr
    lsr
    lsr
    sta lt1
    lda INPT4
    bmi .noFire
    lda lt1
    ora #$80
    sta lt1
.noFire:
    lda R_input
    sta lt3
    eor #$FF
    and lt1
    sta lt2
    lda lt1
    sta W_input
    rts

;-------------------------------------------------------------------------------
; Cursor: the joystick moves the cursor over the nine slots (auto-repeat
; when held). Holding fire, left/right choose the toy instead; releasing fire
; without having changed toys places the toy (or picks one up).
Cursor:
    SUBROUTINE
    lda lt2
    bpl .noPress
    lda #1
    sta W_fireState
.noPress:
    lda lt1
    bpl .notHeld
    lda lt2
    and #$08
    beq .noNext
    jsr NextToy
    jmp .changed
.noNext:
    lda lt2
    and #$04
    beq .heldDone
    jsr PrevToy
.changed:
    lda #2
    sta W_fireState
.heldDone:
    rts
.notHeld:
    lda lt3
    bpl .move                   ; fire wasn't down last frame
    lda R_fireState
    cmp #1
    bne .clear
    jsr Act
.clear:
    lda #0
    sta W_fireState
.move:
    lda lt1
    and #$0F
    bne .dir
    lda #0
    sta W_repeat
    rts
.dir:
    lda lt2
    and #$0F
    beq .held
    lda #18                     ; first repeat after 18 frames
    sta W_repeat
    lda lt2
    jmp .step
.held:
    lda R_repeat
    sec
    sbc #1
    sta W_repeat
    bne .done
    lda #6                      ; then every 6
    sta W_repeat
    lda lt1
.step:
    ldx R_cursor
    lsr
    bcc .noUp
    cpx #3
    bcc .noUp
    dex
    dex
    dex
.noUp:
    lsr
    bcc .noDown
    cpx #6
    bcs .noDown
    inx
    inx
    inx
.noDown:
    lsr
    bcc .noLeft
    ldy SlotCol,x
    beq .noLeft
    dex
.noLeft:
    lsr
    bcc .noRight
    ldy SlotCol,x
    cpy #2
    beq .noRight
    inx
.noRight:
    cpx R_cursor
    beq .same
    SOUND SND_CURSOR
.same:
    stx W_cursor
.done:
    rts

NextToy:
    SUBROUTINE
    lda R_toy
    clc
    adc #1
    cmp R_unlock
    beq .ok
    bcc .ok
    lda #1
.ok:
    sta W_toy
    SOUND SND_SELECT
    rts

PrevToy:
    SUBROUTINE
    lda R_toy
    sec
    sbc #1
    bne .ok
    lda R_unlock
.ok:
    sta W_toy
    SOUND SND_SELECT
    rts

; Act: on the cursor's slot, place the chosen toy (if there are batteries
; for it, and no monster stands there) or pick up the toy there (half its
; cost back)
Act:
    SUBROUTINE
    ldx R_cursor
    lda R_slotType,x
    beq .place
    tay
    lda ToyCost,y
    lsr
    clc
    adc R_batt
    jsr SetBatt
    lda #0
    sta W_slotType,x
    SOUND SND_PICK
    rts
.place:
    ldy R_toy
    cpy #TOY_JET
    bne .standing
    lda R_splashN               ; (no jet while a jack's spring is being swept:
    and #$F0                    ; with every enemy slot taken its strike would
    cmp #$70                    ; cut the sweep short)
    beq .cant
    bne .afford                 ; (a jet takes off: it never stands there)
.standing:
    jsr Occupied
    bcs .cant                   ; a toy can't go down on a monster
.afford:
    lda R_batt
    cmp ToyCost,y
    bcc .cant
    sbc ToyCost,y
    jsr SetBatt
    lda #1                      ; (a busy frame: the spawner waits a frame)
    sta KILLED
    cpy #TOY_JET
    beq JetStrike
    tya
    sta W_slotType,x
    lda ToyHP,y
    sta W_slotHP,x
    lda #5                      ; first action after 30 frames
    sta W_slotCool,x
    SOUND SND_PLACE
    rts
.cant:
    SOUND SND_NOBATT
    rts

; Occupied (X = slot; keeps X and Y): carry set if a monster (not the
; balloon clown, which floats over) stands on it,
; where the toy would stop it (the toy's x to x + 8). Without this a toy
; dropped on a monster, or put back each time it is eaten, could hold the
; monster out of every shot's reach for good, and the wave would never end.
Occupied:
    SUBROUTINE
    sty lt0
    lda SlotCol,x
    tay
    lda ColX,y
    sta lt5                     ; the toy's x
    lda SlotLane,x
    sta lt4
    ldy #NENEMY-1
.loop:
    lda R_eLane,y               ; (an empty slot's shelf is $FF, a jet's 4-6)
    cmp lt4
    bne .next
    lda R_eType,y
    cmp #EN_BALLOON
    beq .next                   ; (it floats over toys: it never stands there)
    lda R_eX,y
    sec
    sbc lt5
    cmp #9
    bcc .yes
.next:
    dey
    bpl .loop
    ldy lt0
    clc
    rts
.yes:
    ldy lt0
    sec
    rts

; JetStrike (X = slot): the jet takes off from the toy box end of the slot's
; shelf and flies the whole shelf (JetAct); if every enemy slot is taken, it
; strikes the whole shelf as a burst (Splash: one monster a frame, so five
; kills never land in one frame)
JetStrike:
    SUBROUTINE
    SOUND SND_JET
    lda SlotLane,x
    sta lt0
    lda #24
    sta W_flash
    jsr FreeEnemy
    bmi .instant
    lda #EN_JET
    sta W_eType,y
    lda lt0
    ora #4                      ; shelves 4-6: never matches an enemy's shelf
    sta W_eLane,y
    lda #JET_X0                 ; left of every enemy: its first step's nose
    sta W_eX,y                  ; passes the middle of one at BREACH_X
    lda #0
    sta W_eState,y
    sta W_eHP,y
    tya
    tax
    jmp EnemyRow
.instant:
    lda lt0
    sta W_splashL
    lda #$F0|NENEMY             ; a jet's burst (no monster hit first), all five
    sta W_splashN               ; (it replaces a cannonball's burst still going)
    rts

; GainBatt: batteries = A, earned (the trickle, a kill's reward): any over
; the cap of 99 become points, one each, instead of being lost. Keeps X, Y.
GainBatt:
    SUBROUTINE
    cmp #100
    bcc SetBatt
    sbc #99                     ; (carry set) the batteries over the cap, 1-10
    sed
    clc
    adc R_score+2
    sta W_score+2
    lda R_score+1
    adc #0
    sta W_score+1
    lda R_score
    adc #0
    sta W_score
    cld
    lda R_dirty
    ora #1
    sta W_dirty
    lda #99
SetBatt:                        ; batteries = A (at most 99)
    SUBROUTINE
    cmp #100
    bcc .ok
    lda #99
.ok:
    sta W_batt
    lda R_dirty
    ora #2
    sta W_dirty
    rts

; MaxHP: A = enemy kind -> A = its full health now: one more every fourth
; wave (every eighth for the light ones, wind-up mice and balloon clowns, which
; a ramp of wave / 4 made six and three times as tough by wave 20), and in the
; second lap on difficulty A one more. Keeps X and Y (uses temp+1, temp+2:
; overscan only).
MaxHP:
    SUBROUTINE
    sty temp+1
    tay
    lda R_wave
    lsr
    lsr
    cpy #EN_MOUSE
    beq .light
    cpy #EN_BALLOON
    bne .ramp
.light:
    lsr
.ramp:
    clc
    adc EnHP,y
    sta temp+2
    lda fast
    and #$A0
    cmp #$A0
    bne .done
    lda temp+2
    clc
    adc #A_LAP2_HP
    sta temp+2
.done:
    ldy temp+1
    lda temp+2
    rts

; Damage: enemy X loses A health; at 0 it is destroyed (Kill)
Damage:
    SUBROUTINE
    sta lt4
    lda R_eHP,x
    sec
    sbc lt4
    beq Kill
    bcc Kill
    sta W_eHP,x
    sta temp                    ; health now
    lda R_eState,x
    and #$0F                    ; half its full health (kept since it spawned)
    cmp temp
    bcc .sound                  ; more than half left
    lsr
    cmp temp                    ; (carry: a quarter or less left)
    lda R_eState,x
    ora #$20                    ; hurt: half or less (the kernel shows it in the
    bcc .half                   ;   other color; a quarter or less, flickering)
    ora #$10
.half:
    sta W_eState,x
.sound:
    SOUND SND_HIT
    lda R_eHP,x                 ; (SndPlay leaves A changed)
    cmp #3
    bcs .done
    lda R_eType,x               ; a knight's shield breaks
    cmp #EN_KNIGHT
    bne .done
    lda R_eState,x
    ora #$40
    sta W_eState,x
.done:
    rts

Kill:                           ; enemy X destroyed: batteries and score
    SUBROUTINE
    SOUND SND_KILL
    ldy R_eType,x
    lda EnReward,y
    clc
    adc R_batt
    jsr GainBatt
    sed
    lda R_score+2
    clc
    adc EnScore,y
    sta W_score+2
    lda R_score+1
    adc #0
    sta W_score+1
    lda R_score
    adc #0
    sta W_score
    cld
    lda #0
    sta W_eType,x
    lda #$FF
    sta eTop,x
    sta W_eLane,x               ; (no shelf: shots skip the empty slot)
    sta KILLED
    lda R_dirty
    ora #1
    sta W_dirty
    rts

;-------------------------------------------------------------------------------
Batteries:                      ; one more every TRICKLE frames (TRICKLE2 in the second lap)
    SUBROUTINE
    ldy #TRICKLE
    bit fast
    bpl .lap1
    ldy #TRICKLE2
.lap1:
    sty lt0
    lda R_battTimer
    clc
    adc #1
    cmp lt0
    bcc .store
    lda R_batt
    clc
    adc #1
    jsr GainBatt
    lda #0
.store:
    sta W_battTimer
    rts

CountAlive:                     ; A = enemies on the shelves (Z if none); keeps X
    SUBROUTINE                  ; (an empty slot's shelf is $FF, a flying jet's 4-6)
    ldy #0
    lda R_eLane
    cmp #3
    bcs .1
    iny
.1: lda R_eLane+1
    cmp #3
    bcs .2
    iny
.2: lda R_eLane+2
    cmp #3
    bcs .3
    iny
.3: lda R_eLane+3
    cmp #3
    bcs .4
    iny
.4: lda R_eLane+4
    cmp #3
    bcs .5
    iny
.5: tya
    rts

; Spawner (even frames): the wave's enemies arrive one by one at the right
; edge of a shelf drawn from a shuffle bag (a boss wave starts with its
; T-Rexes; wind-up mice come in packs of three); when all have come and gone,
; the next wave starts
Spawner:
    SUBROUTINE
    lda frame
    lsr
    bcs .done
    lda KILLED
    bne .done                   ; a kill this frame: spawn on the next even one
    jsr Pack
    lda R_spawnLeft
    bne .spawning
    lda R_packLeft
    bne .done                   ; (a pack's mice still to come belong to this wave)
    jsr CountAlive
    bne .done
    lda R_wave
    clc
    adc #1
    cmp #100
    bcc .next
    lda #99
.next:
    sta W_wave
    jmp StartWave
.spawning:
    lda R_spawnTimer
    beq .try
    sec
    sbc #1
    sta W_spawnTimer
.done:
    rts
.try:
    jsr CountAlive
    sta lt0
    jsr WaveIndex
    lda lt0
    cmp WaveMax,x
    bcs .done                   ; enough on the shelves already
    jsr FreeEnemy
    bmi .done
    ; kind: a boss first, else start from a random kind and take the first the wave allows
    lda R_bossLeft
    beq .random
    sec
    sbc #1
    sta W_bossLeft
    lda #EN_TREX
    jmp .kindOk
.random:
    lda R_rand
    and #31
    sty lt1
    tay
    lda Mod7,y
    ldy lt1
    sta lt2                     ; 0-6
    lda #7
    sta lt3                     ; tries
.kind:
    stx lt4
    ldx lt2
    lda KindBit,x
    ldx lt4
    and WaveKinds,x
    bne .found
    inc lt2
    lda lt2
    cmp #7
    bcc .kindNext
    lda #0
    sta lt2
.kindNext:
    dec lt3
    bne .kind
.found:
    lda lt2
    clc
    adc #1                      ; type = 1-7
.kindOk:
    sta lt5
    ; shelf: a shuffle bag of six, each shelf twice, so the shelves stay even
    ; (an 8-bit LFSR read on the spawn timer's beat leans to some shelves).
    ; The random pick is only where the search for one still in the bag starts:
    ; bits 5-6, which the kind (bits 0-4) doesn't use.
    lda R_rand
    lsr
    lsr
    lsr
    lsr
    lsr
    and #3
    cmp #3
    bcc .first
    lda #0
.first:
    sta lt0                     ; first choice
.bag:
    ldx lt0
    lda R_bag
    and BagMask,x
    cmp BagTwo,x
    bcc .take                   ; drawn less than twice this bag
    inx
    cpx #3
    bcc .nextShelf
    ldx #0
.nextShelf:
    stx lt0
    jmp .bag
.take:
    lda R_bag
    clc
    adc BagOne,x
    cmp #$2A                    ; every shelf twice: a new bag
    bne .keep
    lda #0
.keep:
    sta W_bag                   ; shelf: lt0
    lda lt5
    cmp #EN_MOUSE
    bne .one
    lda #2                      ; a pack: two more follow on the same shelf
    sta W_packLeft
    lda #6
    sta W_packTimer
    lda lt0
    sta W_packLane
.one:
    lda lt5
    jsr Spawn
    lda R_spawnLeft
    sec
    sbc #1
    sta W_spawnLeft
    jsr WaveIndex
    lda WaveGap,x
    bit fast
    bvc .gap
    lsr                         ; second lap (or difficulty A): three quarters of the gap
    lsr
    sta lt0
    lda fast
    and #$A0
    cmp #$A0
    bne .quarter
    lda lt0                     ; second lap on A: five eighths
    lsr
    clc
    adc lt0
    sta lt0
.quarter:
    lda WaveGap,x
    sec
    sbc lt0
.gap:
    sta W_spawnTimer
    rts

; Pack: the rest of a wind-up mouse pack, every 12 frames
Pack:
    SUBROUTINE
    lda R_packLeft
    beq .done
    lda R_packTimer
    sec
    sbc #1
    sta W_packTimer
    bne .done
    lda #6
    sta W_packTimer
    jsr FreeEnemy
    bmi .done
    lda R_packLeft
    sec
    sbc #1
    sta W_packLeft
    lda R_packLane
    sta lt0
    lda #EN_MOUSE
    jmp Spawn
.done:
    rts

FreeEnemy:                      ; Y = a free enemy slot ($FF, N set, if none)
    SUBROUTINE
    ldy #NENEMY-1
.loop:
    lda R_eType,y
    beq .found
    dey
    bpl .loop
.found:
    rts

; Spawn: enemy kind A into slot Y on shelf lt0, at the right edge
Spawn:
    SUBROUTINE
    sta W_eType,y
    jsr MaxHP
    sta W_eHP,y
    lsr                         ; half its full health, kept in its state's low
    cmp #16                     ; bits for Damage's hurt marks (at most 15)
    bcc .half
    lda #15
.half:
    sta W_eState,y
    lda #151
    sta W_eX,y
    lda lt0
    sta W_eLane,y
    ldx #NENEMY-1
.jets:                          ; a flying jet hasn't hit the newcomer: clear
    lda R_eType,x               ; its slot's bit in every jet's hit mask
    cmp #EN_JET
    bne .notJet
    lda KindBit,y
    eor #$FF
    and R_eHP,x
    sta W_eHP,x
.notJet:
    dex
    bpl .jets
    tya
    tax
    jmp EnemyRow

;-------------------------------------------------------------------------------
; Enemies: half of them each frame (even slots on even frames, odd slots on
; odd frames), so each moves in steps of two frames. Each walks left at its
; kind's pace; a toy in its way stops it and gets chewed, except: the
; helicopter hops over the first toy, the pogo frog jumps to the next shelf
; once, the balloon clown floats over every toy, the T-Rex crushes a toy in
; one bite. A jack-in-the-box springs on whatever reaches it; reaching the
; toy box is a breach.
Enemies:
    SUBROUTINE
    lda frame
    and #1
    tax
.loop:
    lda R_eType,x
    beq .next
    cmp #EN_JET
    beq .jet
    jsr EnemyAct                ; (it updates the rows when the enemy moves)
    lda eTop,x
    cmp #$FF
    bne .next
    jsr EnemyRow                ; (rows never worked out: a living enemy's
    jmp .next                   ; eTop is never $FF otherwise)
.jet:
    jsr JetAct
.next:
    inx
    inx
    cpx #NENEMY
    bcc .loop
    rts

EnemyAct:                       ; enemy X (kept)
    SUBROUTINE
    sta lt5                     ; kind
    lda lt5
    cmp #EN_BALLOON
    beq .walk                   ; floats over every toy
    lda R_eX,x
    cmp #121
    bcs .walk                   ; right of every toy
    sec                         ; the toys stand at x 48, 80, 112 (ColX): a
    sbc #48                     ; toy blocks an enemy at its x to x + 8
    bcc .walk                   ; left of every toy
    tay
    and #31
    cmp #9
    bcs .walk                   ; between two columns
    tya
    lsr
    lsr
    lsr
    lsr
    lsr
    sta lt2                     ; column
    ldy R_eLane,x
    clc
    adc Lane3,y
    sta lt1                     ; slot
    tay
    lda R_slotType,y
    beq .walk                   ; (empty)
    ldy lt2
    jmp .blocked
.walk:
    lda R_eState,x              ; walking: not chewing
    and #$7F
    sta W_eState,x
    ; pace: move on updates where (frame/2) & mask = 0, by step pixels
    ldy lt5
    bit fast
    bpl .lap1
    tya                         ; second lap: the fast table
    clc
    adc #NKINDS
    tay
.lap1:
    lda lt5
    cmp #EN_KNIGHT
    bne .pace
    lda R_eState,x
    and #$40
    beq .pace
    tya                         ; a knight without its shield charges
    clc
    adc #2*NKINDS
    tay
.pace:
    lda frame
    lsr
    and EnMask,y
    bne .done
    lda R_eX,x
    sec
    sbc EnStep,y
    cmp #BREACH_X
    bcc .reach
    sta W_eX,x
    jmp EnemyRow
.reach:
    ldy KILLED
    bne .done                   ; an enemy died this frame: the box next update
    sta W_eX,x
.breach:
    jsr EnemyRow                ; (the game may end with it in view)
    jmp Breach
.done:
    rts
.blocked:
    ldy lt1
    lda R_slotType,y
    cmp #TOY_JACK
    bne .notJack
    lda R_splashN
    bne .waitJack               ; a burst is still being swept: wait for it
    jmp JackSpring
.waitJack:
    rts
.notJack:
    ldy lt2
    lda lt5
    cmp #EN_HELI
    beq .hop
    cmp #EN_POGO
    bne .chew
    ; pogo frog: once, jump to the next shelf
    lda R_eState,x
    and #$40
    bne .chew
    lda R_eState,x
    ora #$40
    sta W_eState,x
    ldy R_eLane,x
    lda NextLane,y
    sta W_eLane,x
    jmp EnemyRow
.hop:
    lda R_eState,x
    and #$40
    bne .chew
    lda R_eState,x              ; helicopter: hop over the toy, once
    ora #$40
    sta W_eState,x
    ldy lt2
    lda ColX,y
    sec
    sbc #9
    sta W_eX,x
    cmp #BREACH_X
    bcc .breach
    jmp EnemyRow
.chew:
    lda R_eState,x
    ora #$80
    sta W_eState,x
    stx lt0
    lda frame
    lsr
    clc
    adc lt0                     ; (staggered by slot: bites don't pile up
    and #7                      ; on one frame) one bite every 16 frames
    bne .done
    SOUND SND_CHEW
    ldy lt1
    lda lt5
    cmp #EN_TREX
    beq .crush
    lda R_slotHP,y
    sec
    sbc #1
    sta W_slotHP,y
    beq .crush
    rts
.crush:
    lda #0
    sta W_slotType,y
    rts

; JackSpring (X = the enemy that reached it, lt1 = its slot): the
; jack-in-the-box springs, hitting every enemy within JACK_REACH of that one
; (the burst sweep: one a frame), and is gone
JackSpring:
    SUBROUTINE
    lda R_eX,x
    sta W_splashX               ; (centred on the enemy that sprang it)
    lda R_eLane,x
    sta W_splashL
    lda #$70|NENEMY             ; (monster hit 7: a jack's burst)
    sta W_splashN
    ldy lt1
    lda #0
    sta W_slotType,y
    SOUND SND_SPRING
    rts

; EnemyRow (X = enemy, kept): its feet row and event row for the kernel's
; scheduler (SelectEnemies, VBLANK), $FF when there is none. Kept up to date
; wherever an enemy moves, changes shelf, arrives or goes.
EnemyRow:
    SUBROUTINE
    lda R_eType,x
    beq .none
    ldy R_eX,x
    lda FeetX2,y
    ldy R_eLane,x
    clc
    adc LaneBase2,y
    sta eFeet,x
    sec
    sbc #11                     ; top - 1: the latest row for its event
    tay
.findE:
    lda RowBad2,y
    beq .gotE
    dey
    bne .findE
.gotE:
    tya
    sta eTop,x                  ; eTop = the event row (0: none usable)
    rts
.none:
    lda #$FF
    sta eTop,x
    rts

; Breach (X = enemy at the box): the shelf's lid slams and clears it, once;
; the second breach on a shelf ends the game
Breach:
    SUBROUTINE
    lda #1
    sta KILLED                  ; (the spawner waits a frame)
    ldy R_eLane,x
    lda Bit,y
    and R_lids
    bne .over
    lda Bit,y
    ora R_lids
    sta W_lids
    sty lt0
    ldy #NENEMY-1
.clear:
    lda R_eType,y
    beq .next
    lda R_eLane,y
    cmp lt0
    bne .next
    lda #0
    sta W_eType,y
    lda #$FF
    sta eTop,y
    sta W_eLane,y
.next:
    dey
    bpl .clear
    lda #40
    sta W_flash
    SOUND SND_SLAM
    rts
.over:
    SOUND SND_OVER
    lda #ST_OVER
    sta W_state
    lda #120
    sta W_overTimer
    rts

;-------------------------------------------------------------------------------
; Toys (odd frames, one shelf at a time, so each toy acts every sixth
; frame): when ready, army men, tanks and cannons fire along their shelf (one
; shot in flight per shelf) at an enemy ahead; teddies and jack-in-the-boxes
; just stand
Toys:
    SUBROUTINE
    lda R_toyShelf
    clc
    adc #1
    cmp #3
    bcc .shelf
    lda #0
.shelf:
    sta W_toyShelf
    tay
    lda Lane3,y
    sta lt4                     ; first slot of the shelf
    clc
    adc #2
    tax
.loop:
    jsr ToyAct
    dex
    bmi .done
    cpx lt4
    bcs .loop
.done:
    rts

ToyAct:                         ; slot X (kept)
    SUBROUTINE
    lda R_slotType,x
    bne .some
    rts
.some:
    cmp #TOY_TEDDY
    beq .stands
    cmp #TOY_JACK
    bne .acts
.stands:
    rts
.acts:
    sta lt5
    lda R_slotCool,x
    beq .ready
    sec
    sbc #1
    sta W_slotCool,x
    jmp .next
.ready:
    ldy SlotCol,x
    lda ColX,y
    sta lt0
    lda SlotLane,x
    sta lt1
    jsr FindAhead
    bmi .next
    ldy lt1
    lda R_shotDmg,y
    bne .next
    ldy lt5
    lda ToyDmg,y
    ldy lt1
    sta W_shotDmg,y
    ldy lt5
    lda ToyShot,y
    ldy lt1
    sta W_shotKind,y
    lda ShotStart,x
    sta shotPtr,y
    ldy lt5
    lda ToyPeriod,y
    sta W_slotCool,x
    lda ToySound,y
    jsr SndPlay
.next:
    rts

; FindAhead: Y = the nearest enemy on shelf lt1 right of x lt0 ($FF, N set,
; if none)
FindAhead:
    SUBROUTINE
    lda #$FF
    sta lt2
    sta lt3
    ldy #NENEMY-1
.loop:
    lda R_eLane,y               ; (an empty slot's shelf is $FF)
    cmp lt1
    bne .next
    lda R_eX,y
    cmp lt0
    bcc .next
    beq .next
    cmp lt2
    bcs .next
    sta lt2
    sty lt3
.next:
    dey
    bpl .loop
    ldy lt3
    rts

;-------------------------------------------------------------------------------
; Shots (even frames): each checks for a hit where it is, then moves one step
; (six pixels) right along its shelf's diagonal; past x 149 it is gone
Shots:
    SUBROUTINE
    ldx #2
.loop:
    lda R_shotDmg,x
    beq .next
    lda shotPtr,x
    sec
    sbc LaneR0,x
    tay
    lda ShotX,y
    sta lt0                     ; the shot's x
    stx lt1
    jsr ShotHit
    bcs .next
    lda shotPtr,x
    sec
    sbc #1
    cmp LaneR0,x
    bcc .gone
    sta shotPtr,x
    jmp .next
.gone:
    lda #80
    sta shotPtr,x
    lda #0
    sta W_shotDmg,x
.next:
    dex
    bpl .loop
    rts

; ShotHit (X = shelf, lt0 = shot x): carry set if it hit an enemy
ShotHit:
    SUBROUTINE
    lda lt0
    clc
    adc #3
    sta lt3                     ; the shot's right end
    ldy #NENEMY-1
.loop:
    lda R_eLane,y               ; (an empty slot's shelf is $FF)
    cmp lt1
    bne .next
    lda lt3
    cmp R_eX,y
    bcc .next                   ; shot ends left of the enemy
    lda R_eX,y
    clc
    adc #7
    cmp lt0
    bcc .next                   ; enemy ends left of the shot
    lda R_shotKind,x
    cmp #SHOT_TANK
    bne .notShell
    lda R_eType,y
    cmp #EN_BALLOON
    beq .next                   ; tank shells can't hit the balloon clown
    bne .hit
.notShell:
    cmp #SHOT_ARMY
    bne .hit
    lda R_eType,y
    cmp #EN_CRAWL
    bne .hit
    lda R_eState,y
    bmi .next                   ; bullets pass over a crawler that is chewing
.hit:
    lda R_shotKind,x
    cmp #SHOT_CANNON
    bne .direct
    lda R_splashN
    bne .direct                 ; (one burst at a time)
    lda R_eX,y
    sta W_splashX
    stx W_splashL
    tya
    asl
    asl
    asl
    asl
    ora #NENEMY
    sta W_splashN
.direct:
    lda R_shotDmg,x
    sty lt2
    ldx lt2
    jsr Damage
    ldx lt1
    lda #80
    sta shotPtr,x
    lda #0
    sta W_shotDmg,x
    sec
    rts
.next:
    dey
    bpl .loop
    clc
    rts


; Splash (odd frames): a cannonball's burst also hits every other monster on
; its shelf within SPLASH pixels of the one it hit; a jet's burst (bit 7 of
; splashN; no monster hit first) hits every monster on its shelf. One monster
; is checked a frame (five frames a burst), which keeps the frame time bounded
Splash:
    SUBROUTINE
    lda R_splashN
    beq .done
    sta lt0
    and #$0F
    tax
    dex                         ; X = the monster to check
    bne .more
    lda #0                      ; the last one: the burst is over
    beq .store
.more:
    lda lt0
    sec
    sbc #1
.store:
    sta W_splashN
    lda lt0
    lsr
    lsr
    lsr
    lsr
    sta lt0                     ; the monster hit (8-15: a jet's burst)
    cpx lt0
    beq .done                   ; (it took its hit already)
    lda R_eType,x
    beq .done
    lda R_eLane,x
    cmp R_splashL
    bne .done                   ; (a flying jet's shelf is 4-6)
    lda lt0
    and #8
    bne .jet
    lda R_eX,x
    sec
    sbc R_splashX
    bcs .right
    eor #$FF                    ; (carry clear: + 1 makes it positive)
    adc #1
.right:
    ldy lt0
    cpy #7
    beq .jack
    cmp #SPLASH+1
    bcs .done
    lda #CANNON_DMG
    jmp Damage
.jack:
    cmp #JACK_REACH+1
    bcs .done
    lda #JACK_DMG
    jsr Damage
    lda R_eType,x
    beq .done                   ; (that was the end of it)
    lda R_eX,x                  ; the spring throws it back up the shelf
    clc
    adc #JACK_THROW
    cmp #152
    bcc .thrown
    lda #151
.thrown:
    sta W_eX,x
    jmp EnemyRow
.jet:
    lda #JET_DMG
    jmp Damage
.done:
    rts

;-------------------------------------------------------------------------------
Flash:                          ; shelves flash white after a lid slam or air strike
    SUBROUTINE
    lda R_flash
    beq .gold
    sec
    sbc #1
    sta W_flash
    and #4
    beq .gold
    lda #COL_WHITE
    sta pfColor
    rts
.gold:
    lda #COL_GOLD
    sta pfColor
    rts

; SlotPointers: the kernel's defender pointers, one shelf per frame plus the
; cursor's slot. The cursor's slot shows the chosen toy as a blinking ghost
; when empty, or blinks its toy.
SlotPointers:
    SUBROUTINE
    ldx R_cursor
    jsr SlotPointer
    ldx R_toyShelf              ; (the shelf the toys just took their turn on)
    lda Lane3,x
    tax
    jsr SlotPointer
    inx
    jsr SlotPointer
    inx
SlotPointer:                    ; slot X
    SUBROUTINE
    lda R_slotType,x
    sta lt0
    cpx R_cursor
    bne .show
    lda R_state
    cmp #ST_PLAY
    bne .show
    lda lt0
    bne .occupied
    lda frame
    and #16
    beq .show
    lda R_toy
    sta lt0
    jmp .show
.occupied:
    lda frame
    and #24
    bne .show
    lda #0
    sta lt0
.show:
    ldy lt0
    beq .empty
    lda ToyLo,y
    clc
    adc SlotOfs,x
    sta slotPtr,x
    jmp .next
.empty:
    lda EmptyLo,x
    sta slotPtr,x
.next:
    rts

;-------------------------------------------------------------------------------
; JetAct (X = a launched jet): four pixels right per update; every enemy on
; its shelf takes 10 damage once the nose has passed its middle. The jet's
; health byte (unused for a jet) marks the enemy slots it has hit, so each is
; hit exactly once; at most two an update (the rest the next one), so a pack
; bunched together never dies all in one frame.
JetAct:
    SUBROUTINE
    stx lt3
    lda R_eX,x
    clc
    adc #12
    sta lt0                     ; the nose after this step
    lda R_eLane,x
    and #3
    sta lt1
    lda #2
    ldy KILLED
    beq .hits
    lda #1                      ; an enemy died this frame already: one hit
.hits:
    sta lt5                     ; hits left this update
    ldy #NENEMY-1
.loop:
    lda R_eLane,y               ; (an empty slot's shelf is $FF, a jet's 4-6)
    cmp lt1
    bne .next
    lda R_eX,y
    clc
    adc #4
    cmp lt0
    bcs .next                   ; its middle is still ahead of the nose
    ldx lt3
    lda R_eHP,x
    and KindBit,y               ; (bits 0-4: enemy slots 0-4)
    bne .next                   ; hit already
    lda lt5
    beq .next                   ; two this update: the next one gets it
    dec lt5
    lda R_eHP,x
    ora KindBit,y
    sta W_eHP,x
    sty lt2
    ldx lt2
    lda #JET_DMG
    jsr Damage
    ldy lt2
.next:
    dey
    bpl .loop
    ldx lt3
    lda R_eX,x
    clc
    adc #4
    cmp #152
    bcs .gone
    sta W_eX,x
    jmp EnemyRow
.gone:
    lda #0
    sta W_eType,x
    lda #$FF
    sta eTop,x
    sta W_eLane,x               ; (no shelf: shots skip the empty slot)
    rts

;-------------------------------------------------------------------------------

;-------------------------------------------------------------------------------
; Sound: channel 0 plays the player's actions and jingles, channel 1 combat.
; A sound is a list of steps (ticks of two frames, AUDC*16+AUDV, AUDF) ending
; in a zero; a new sound replaces the one playing on its channel unless that
; one matters more (SndPri).
SndPlay:                        ; A = sound id; keeps X and Y
    SUBROUTINE
    stx sndX
    sty sndY
    tay
    ldx SndChan,y
    lda SndPri,y
    cmp R_sndPri,x
    bcc .done                   ; something more important is playing
    sta W_sndPri,x
    lda SndStart,y
    sta W_sndPos,x
    lda #0
    sta W_sndTimer,x
.done:
    ldx sndX
    ldy sndY
    rts

SndStart:   .byte SdCursor-SndData, SdSelect-SndData, SdPlace-SndData, SdPick-SndData
            .byte SdNoBatt-SndData, SdWave-SndData, SdOver-SndData, SdPop-SndData
            .byte SdBoom-SndData, SdThump-SndData, SdSpring-SndData, SdHit-SndData
            .byte SdKill-SndData, SdChew-SndData, SdSlam-SndData, SdJet-SndData
SndChan:    .byte 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1
SndPri:     .byte 1, 2, 3, 3, 3, 4, 5, 1, 3, 3, 2, 2, 3, 1, 5, 5
ToySound:   .byte 0, SND_POP, 0, SND_BOOM, 0, SND_THUMP, 0

;-------------------------------------------------------------------------------
; tables (toy and enemy types index from 1)
ToyCost:    .byte 0, 10, 5, 25, 15, 20, 30
ToyHP:      .byte 0, 8, 40, 12, 8, 10, 1         ; (the jack's 8 is never bitten: walkers spring it or wait)
ToyPeriod:  .byte 0, 7, 0, 50, 0, 33, 0         ; visits (6 frames) between shots
ToyDmg:     .byte 0, 1, 0, 8, 0, CANNON_DMG, 0
; enemy kinds:        -  dino heli crawl mouse knight balloon pogo trex
EnHP:       .byte 0,   6,   5,   3,    1,    6,     2,     3,  20
EnReward:   .byte 0,   2,   2,   1,    1,    2,     2,     2,   5   ; batteries
EnScore:    .byte 0, $10, $15, $10,  $05,  $20,   $15,   $15, $50   ; BCD points
; pace (updates are two frames): move when (frame/2) & mask = 0, by step
; pixels; four blocks: first lap, second lap, knight charging (first lap,
; second lap)
EnMask:     .byte 0,   1,   0,   0,    0,    1,     1,     0,   3
            .byte 0,   0,   0,   0,    0,    0,     1,     0,   1   ; (balloon: its first-lap pace)
            .byte 0,   0,   0,   0,    0,    0,     0,     0,   0
            .byte 0,   0,   0,   0,    0,    0,     0,     0,   0
EnStep:     .byte 0,   1,   1,   1,    2,    1,     1,     1,   1
            .byte 0,   1,   2,   2,    3,    1,     1,     2,   1
            .byte 0,   1,   1,   1,    1,    2,     1,     1,   1
            .byte 0,   1,   1,   1,    1,    3,     1,     1,   1
KindBit:    .byte 1, 2, 4, 8, 16, 32, 64                ; kinds 1-7 (the T-Rex only as a boss)
NextLane:   .byte 1, 2, 0                               ; the pogo frog's jump
ToyShot:    .byte 0, SHOT_ARMY, 0, SHOT_TANK, 0, SHOT_CANNON, 0
; waves 1-12 (later waves repeat them)
WaveCount:  .byte 5, 7, 9, 10, 12, 7, 12, 14, 15, 18, 20, 12
WaveBoss:   .byte 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2   ; T-Rexes first
WaveGap:    .byte 180, 150, 150, 135, 120, 120, 120, 105, 105, 90, 90, 90
WaveMax:    .byte 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5
WaveKinds:  .byte 1, 1, 9, 13, 29, 29, 31, 63, 127, 127, 127, 127
WaveUnlock: .byte 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 6, 6
Lane3:      .byte 0, 3, 6
Bit:        .byte 1, 2, 4
BagMask:    .byte $03, $0C, $30                     ; a shelf's two bits in the bag
BagTwo:     .byte $02, $08, $20
BagOne:     .byte $01, $04, $10
Mod7:       .byte 0,1,2,3,4,5,6,0,1,2,3,4,5,6,0,1,2,3,4,5,6,0,1,2,3,4,5,6,0,1,2,3
