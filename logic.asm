; TOY WARS game logic (bank 2), included by toywars.asm.
;
; LogicInit runs once at power-on, Logic once per frame in overscan. Game
; state is in Super Chip RAM: read at R_name, written at W_name, so every
; change is load / modify / store (no INC/DEC on it). Toys and shots take
; turns: shots move on even frames, toys act on odd ones.

TOY_ARMY    = 1
TOY_TEDDY   = 2
TOY_TANK    = 3
TOY_COWBOY  = 4
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
ST_ATTRACT  = 0
ST_PLAY     = 1
ST_OVER     = 2
COL_WHITE   = $0E
BREACH_X    = 41                ; an enemy left of this is at the toy box

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
SND_LASSO   = 10
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
    ; second-lap pace from wave 13, or from the start with the left difficulty on A
    lda #0
    sta fast
    lda R_wave
    cmp #13
    bcs .fast
    lda SWCHB
    and #$40
    beq .paced
.fast:
    lda #$80
    sta fast
.paced:
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
    jsr Cursor
    jsr Batteries
    jsr Spawner
    jsr Enemies
    lda frame
    lsr
    bcs .odd
    jsr Shots
    jmp .finish
.odd:
    jsr Toys
    jsr Splash
.finish:
Finish:
    jsr Flash
    lda frame                   ; even frames (with the shots): sound, its
    lsr                         ; steps are two frames long; odd frames (with
    bcs .oddFinish              ; the toys): the kernel's toy pointers and
    jmp SndUpdate               ; the music
.oddFinish:
    jsr Music
    jmp SlotPointers

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
; for it) or pick up the toy there (half its cost back)
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
    lda R_batt
    cmp ToyCost,y
    bcc .cant
    sbc ToyCost,y
    jsr SetBatt
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

; JetStrike (X = slot): ten damage to every enemy on the slot's shelf; the
; jet is spent
; JetStrike (X = slot): the jet takes off and flies its shelf (JetAct); if
; every enemy slot is taken, it strikes the whole shelf at once
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
    lda SlotCol,x
    tax
    lda ColX,x
    sta W_eX,y
    lda #0
    sta W_eState,y
    sta W_eHP,y
    tya
    tax
    jmp EnemyRow
.instant:
    ldx #NENEMY-1
.enemy:
    lda R_eType,x
    beq .next
    cmp #EN_JET
    beq .next
    lda R_eLane,x
    cmp lt0
    bne .next
    lda #10
    jsr Damage
.next:
    dex
    bpl .enemy
    rts

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
    SOUND SND_HIT
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
    jsr SetBatt
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
    lda R_dirty
    ora #1
    sta W_dirty
    rts

;-------------------------------------------------------------------------------
Batteries:                      ; one more every 90 frames
    SUBROUTINE
    lda R_battTimer
    clc
    adc #1
    cmp #90
    bcc .store
    lda R_batt
    clc
    adc #1
    jsr SetBatt
    lda #0
.store:
    sta W_battTimer
    rts

CountAlive:                     ; A = enemies on the shelves (Z if none)
    SUBROUTINE
    ldy #0
    ldx #NENEMY-1
.loop:
    lda R_eType,x
    beq .next
    cmp #EN_JET
    beq .next
    iny
.next:
    dex
    bpl .loop
    tya
    rts

; Spawner (even frames): the wave's enemies arrive one by one at the right
; edge of a random shelf (a boss wave starts with its T-Rexes; wind-up mice
; come in packs of three); when all have come and gone, the next wave starts
Spawner:
    SUBROUTINE
    lda frame
    lsr
    bcs .done
    jsr Pack
    lda R_spawnLeft
    bne .spawning
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
    lda R_rand
    lsr
    lsr
    lsr
    and #31
    tax
    lda Mod3,x
    sta lt0                     ; shelf
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
    bpl .gap
    lsr                         ; second lap (or difficulty A): three quarters of the gap
    lsr
    sta lt0
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
    tax
    lda R_wave                  ; one more health every fourth wave
    lsr
    lsr
    clc
    adc EnHP,x
    sta W_eHP,y
    lda #151
    sta W_eX,y
    lda #0
    sta W_eState,y
    lda lt0
    sta W_eLane,y
    tya
    tax
    jmp EnemyRow

;-------------------------------------------------------------------------------
; Enemies: half of them each frame (even slots on even frames, odd slots on
; odd frames), so each moves in steps of two frames. Each walks left at its
; kind's pace; a toy in its way stops it and gets chewed, except: the
; helicopter hops over the first toy, the pogo frog jumps to the next shelf
; once, the balloon clown floats over every toy, the T-Rex crushes a toy in
; one bite. A lasso holds it; reaching the toy box is a breach.
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
    jsr EnemyAct
    jsr EnemyRow
    jmp .next
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
    lda R_eState,x
    and #$3F
    beq .free
    lda R_eState,x              ; lassoed: count down, stand still
    sec
    sbc #1
    sta W_eState,x
    rts
.free:
    lda lt5
    cmp #EN_BALLOON
    beq .walk                   ; floats over every toy
    lda R_eX,x
    cmp #121
    bcs .walk                   ; right of every toy
    ldy R_eLane,x
    lda Lane3,y
    sta lt0                     ; first slot of the shelf
    ldy #2
.block:
    lda R_eX,x
    cmp ColX,y
    bcc .noBlock                ; already left of this column
    lda ColX,y
    clc
    adc #8
    cmp R_eX,x
    bcc .noBlock                ; still right of the toy
    sty lt2
    tya
    clc
    adc lt0
    sta lt1                     ; slot
    tay
    lda R_slotType,y
    ldy lt2
    cmp #0
    beq .noBlock
    jmp .blocked
.noBlock:
    dey
    bpl .block
.walk:
    lda R_eState,x              ; walking: not chewing
    and #$7F
    sta W_eState,x
    ; pace: move on updates where (frame/2) & mask = 0, by step pixels
    ldy lt5
    bit fast
    bpl .lap1
    tya                         ; second lap (or difficulty A): the fast table
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
    sta W_eX,x
    cmp #BREACH_X
    bcs .done
    jmp Breach
.done:
    rts
.blocked:
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
    rts
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
    bcs .done
    jmp Breach
.chew:
    lda R_eState,x
    ora #$80
    sta W_eState,x
    lda frame
    lsr
    and #7                      ; one bite every 16 frames
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
    bne .done
.crush:
    lda #0
    sta W_slotType,y
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
; shot in flight per shelf) at an enemy ahead; cowboys lasso an enemy within
; 40 pixels; teddies just stand
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
    bne .acts
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
    lda lt5
    cmp #TOY_COWBOY
    bne .shoot
    lda R_eX,y
    sec
    sbc lt0
    cmp #40
    bcs .next
    lda R_eState,y
    and #$C0
    ora #30                     ; held for 30 updates (60 frames)
    sta W_eState,y
    SOUND SND_LASSO
    lda #20                     ; next lasso after 2 seconds
    sta W_slotCool,x
    jmp .next
.shoot:
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
; its shelf within SPLASH pixels of the one it hit; one monster is checked a
; frame (five frames a burst), which keeps the frame time bounded
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
    sta lt0
    cpx lt0
    beq .done                   ; (it took its hit already)
    lda R_eType,x
    beq .done
    lda R_eLane,x
    cmp R_splashL
    bne .done                   ; (a flying jet's shelf is 4-6)
    lda R_eX,x
    sec
    sbc R_splashX
    bcs .right
    eor #$FF                    ; (carry clear: + 1 makes it positive)
    adc #1
.right:
    cmp #SPLASH+1
    bcs .done
    lda #CANNON_DMG
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
    lda frame
    and #31
    tay
    ldx Mod3,y
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
; its shelf takes 10 damage as the nose passes its middle. Nose and middle
; close by at most 7 pixels an update, so each enemy is hit exactly once.
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
    ldy #NENEMY-1
.loop:
    lda R_eType,y
    beq .next
    lda R_eLane,y
    cmp lt1
    bne .next
    lda R_eX,y
    clc
    adc #4
    sec
    sbc lt0                     ; enemy middle - nose: passed when -7..-1
    cmp #$F9
    bcc .next
    sty lt2
    ldx lt2
    lda #10
    jsr Damage
    ldy lt2
    ldx lt3
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
; Music (odd frames): an 8-bar toy march, eighth notes of 12 frames. Before a
; game and at game over: melody on channel 0 and bass on channel 1; during
; play: the melody alone, softly. A sound effect on a channel always wins;
; the music picks up again at its next note.
Music:
    SUBROUTINE
    lda R_musTimer
    clc
    adc #2
    cmp #12
    bcc .same
    lda R_musPos
    clc
    adc #1
    and #63
    sta W_musPos
    lda #0
.same:
    sta W_musTimer
    ; melody, channel 0
    lda R_sndPri
    bne .bass                   ; a sound effect has the channel
    ldx R_musPos
    lda R_musTimer
    bne .melEnd
    ldy MelNote,x               ; start of an eighth
    cpy #7
    beq .bass                   ; a tie: keep sounding
    lda #0
    cpy #0
    beq .melVol                 ; a rest
    lda #4
    sta AUDC0
    lda MelF,y
    sta AUDF0
    lda #6
    ldy R_state
    cpy #ST_PLAY
    bne .melVol
    lda #3                      ; softer under the game
.melVol:
    sta AUDV0
    jmp .bass
.melEnd:
    cmp #10                     ; the last two frames: a short gap before the next note
    bne .bass
    lda MelNote+1,x             ; (MelNote has a 65th byte: the first again)
    cmp #7
    beq .bass
    lda #0
    sta AUDV0
.bass:
    ; bass, channel 1: only before a game and at game over
    lda R_sndPri+1
    bne .done
    lda R_state
    cmp #ST_PLAY
    bne .bassOn
    lda #0
    sta AUDV1
.done:
    rts
.bassOn:
    lda R_musPos
    lsr
    tax                         ; quarter note 0-31
    bcs .second                 ; the second eighth of the quarter
    lda R_musTimer
    bne .done
    ldy BassNote,x
    lda #0
    cpy #0
    beq .bassVol
    lda #12
    sta AUDC1
    lda BassF,y
    sta AUDF1
    lda #5
.bassVol:
    sta AUDV1
    rts
.second:
    lda R_musTimer
    cmp #6
    bne .done
    lda #0                      ; bass notes last an eighth and a half
    sta AUDV1
    rts

; the theme (original): melody in eighths, 1-6 = C5 D5 E5 G5 A5 C6, 7 = tie,
; 0 = rest; bass in quarters, 1-5 = F3 G3 A3 C4 E3
MelNote:    .byte 1,1,3,4,3,1,4,7, 5,5,4,3,2,3,1,7
            .byte 1,1,3,4,5,4,3,7, 2,3,2,1,2,7,7,0
            .byte 3,3,4,5,6,5,4,7, 5,4,3,2,3,4,3,7
            .byte 1,1,3,4,5,6,5,4, 3,2,3,2,1,7,7,0
            .byte 1
MelF:       .byte 0, 29, 26, 23, 19, 17, 14          ; AUDC 4: C5 D5 E5 G5 A5 C6
BassNote:   .byte 4,2,4,2, 1,4,2,4, 4,2,3,5, 2,2,2,2
            .byte 4,3,1,2, 1,4,2,4, 4,3,1,2, 2,2,4,0
BassF:      .byte 0, 29, 26, 23, 19, 31             ; AUDC 12: F3 G3 A3 C4 E3

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

SndUpdate:                      ; even frames: next step when a step's time is up
    SUBROUTINE
    ldx #1
.chan:
    lda R_sndTimer,x
    beq .step
    sec
    sbc #1
    sta W_sndTimer,x
    jmp .next
.step:
    ldy R_sndPos,x
    lda SndData,y
    beq .quiet
    sec
    sbc #1                      ; this tick is the step's first
    sta W_sndTimer,x
    lda SndData+1,y
    lsr
    lsr
    lsr
    lsr
    sta AUDC0,x
    lda SndData+1,y
    and #$0F
    sta AUDV0,x
    lda SndData+2,y
    sta AUDF0,x
    tya
    clc
    adc #3
    sta W_sndPos,x
    jmp .next
.quiet:
    lda #0
    sta AUDV0,x
    sta W_sndPri,x
.next:
    dex
    bpl .chan
    rts

    MAC STEP                    ; ticks, AUDC, AUDV, AUDF
    .byte {1}, [{2} << 4] | {3}, {4}
    ENDM
SndData:
    .byte 0                     ; offset 0: silence
SdCursor:   STEP 1, 4, 4, 12
    .byte 0
SdSelect:   STEP 1, 12, 6, 8
            STEP 1, 12, 6, 6
    .byte 0
SdPlace:    STEP 2, 4, 7, 15
            STEP 2, 4, 7, 11
            STEP 3, 4, 6, 8
    .byte 0
SdPick:     STEP 2, 4, 6, 8
            STEP 3, 4, 6, 14
    .byte 0
SdNoBatt:   STEP 6, 6, 6, 28
    .byte 0
SdWave:     STEP 4, 4, 8, 17
            STEP 4, 4, 8, 14
            STEP 4, 4, 8, 11
            STEP 8, 4, 8, 8
    .byte 0
SdOver:     STEP 8, 12, 8, 10
            STEP 8, 12, 8, 13
            STEP 8, 12, 8, 17
            STEP 16, 12, 7, 23
    .byte 0
SdPop:      STEP 1, 8, 5, 3
            STEP 1, 8, 3, 5
    .byte 0
SdBoom:     STEP 2, 8, 12, 18
            STEP 3, 8, 9, 22
            STEP 4, 8, 5, 26
    .byte 0
SdThump:    STEP 2, 15, 10, 20
            STEP 3, 15, 6, 24
    .byte 0
SdLasso:    STEP 1, 4, 6, 20
            STEP 1, 4, 6, 15
            STEP 1, 4, 6, 10
            STEP 2, 4, 5, 6
    .byte 0
SdHit:      STEP 1, 8, 7, 6
    .byte 0
SdKill:     STEP 2, 12, 8, 8
            STEP 2, 12, 7, 12
            STEP 2, 12, 6, 16
            STEP 3, 12, 4, 22
    .byte 0
SdChew:     STEP 1, 3, 4, 28
    .byte 0
SdSlam:     STEP 3, 8, 15, 30
            STEP 4, 8, 12, 31
            STEP 6, 8, 8, 31
            STEP 8, 8, 4, 31
    .byte 0
SdJet:      STEP 2, 8, 12, 4
            STEP 2, 8, 12, 8
            STEP 2, 8, 12, 12
            STEP 2, 8, 12, 16
            STEP 2, 8, 10, 20
            STEP 3, 8, 8, 24
            STEP 4, 8, 5, 28
    .byte 0
SND_END = .
    IF SND_END - SndData > 255
        ERR                     ; positions are one byte
    ENDIF
SndStart:   .byte SdCursor-SndData, SdSelect-SndData, SdPlace-SndData, SdPick-SndData
            .byte SdNoBatt-SndData, SdWave-SndData, SdOver-SndData, SdPop-SndData
            .byte SdBoom-SndData, SdThump-SndData, SdLasso-SndData, SdHit-SndData
            .byte SdKill-SndData, SdChew-SndData, SdSlam-SndData, SdJet-SndData
SndChan:    .byte 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1
SndPri:     .byte 1, 2, 3, 3, 3, 4, 5, 1, 3, 3, 2, 2, 3, 1, 5, 5
ToySound:   .byte 0, SND_POP, 0, SND_BOOM, 0, SND_THUMP, 0

;-------------------------------------------------------------------------------
; tables (toy and enemy types index from 1)
ToyCost:    .byte 0, 10, 5, 25, 15, 20, 30
ToyHP:      .byte 0, 8, 40, 12, 8, 10, 1
ToyPeriod:  .byte 0, 7, 0, 50, 20, 33, 0        ; visits (6 frames) between shots
ToyDmg:     .byte 0, 1, 0, 8, 0, CANNON_DMG, 0
; enemy kinds:        -  dino heli crawl mouse knight balloon pogo trex
EnHP:       .byte 0,   6,   5,   3,    1,    6,     2,     3,  20
EnReward:   .byte 0,   3,   3,   2,    1,    4,     3,     3,  10   ; batteries
EnScore:    .byte 0, $10, $15, $10,  $05,  $20,   $15,   $15, $50   ; BCD points
; pace (updates are two frames): move when (frame/2) & mask = 0, by step
; pixels; four blocks: first lap, second lap, knight charging (first lap,
; second lap)
EnMask:     .byte 0,   1,   0,   0,    0,    1,     1,     0,   3
            .byte 0,   0,   0,   0,    0,    0,     0,     0,   1
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
Mod3:       .byte 0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1
Mod7:       .byte 0,1,2,3,4,5,6,0,1,2,3,4,5,6,0,1,2,3,4,5,6,0,1,2,3,4,5,6,0,1,2,3
