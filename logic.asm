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
ST_ATTRACT  = 0
ST_PLAY     = 1
ST_OVER     = 2
COL_WHITE   = $0E
BREACH_X    = 41                ; an enemy left of this is at the toy box

;-------------------------------------------------------------------------------
LogicInit:
    SUBROUTINE
    lda #1
    sta W_rand
    lda #ST_ATTRACT
    sta W_state
    jsr ClearBoard
    lda #7
    sta W_dirty
    jmp Finish

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
.finish:
Finish:
    jsr Flash
    jmp SlotPointers

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
    ldx #2
.shots:
    lda #0
    sta W_shotDmg,x
    lda #80                     ; 80 = no shot (the pointer reads zeros)
    sta shotPtr,x
    dex
    bpl .shots
    lda #0
    sta W_flash
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
    lda #30
    sta W_batt
    lda #1
    sta W_wave
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
.cant:
    rts

; JetStrike (X = slot): ten damage to every enemy on the slot's shelf; the
; jet is spent
JetStrike:
    SUBROUTINE
    lda SlotLane,x
    sta lt0
    lda #24
    sta W_flash
    ldx #NENEMY-1
.enemy:
    lda R_eType,x
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
    rts

Kill:                           ; enemy X destroyed: batteries and score
    SUBROUTINE
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
    iny
.next:
    dex
    bpl .loop
    tya
    rts

; Spawner (even frames): the wave's enemies arrive one by one at the right
; edge of a random shelf; when all have come and gone, the next wave starts
Spawner:
    SUBROUTINE
    lda frame
    lsr
    bcs .done
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
    ldy #NENEMY-1
.free:
    lda R_eType,y
    beq .found
    dey
    bpl .free
    rts
.found:
    ; kind: start from a random one of the three and take the first the wave allows
    lda R_rand
    and #31
    sty lt1
    tay
    lda Mod3,y
    ldy lt1
    sta lt2                     ; 0-2
    lda #3
    sta lt3                     ; tries
.kind:
    stx lt4
    ldx lt2
    lda KindBit,x
    ldx lt4
    and WaveKinds,x
    bne .kindOk
    inc lt2
    lda lt2
    cmp #3
    bcc .kindNext
    lda #0
    sta lt2
.kindNext:
    dec lt3
    bne .kind
.kindOk:
    ldx lt2
    inx                         ; type = 1-3
    txa
    sta W_eType,y
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
    lda R_rand
    lsr
    lsr
    lsr
    and #31
    tax
    lda Mod3,x
    sta W_eLane,y
    lda R_spawnLeft
    sec
    sbc #1
    sta W_spawnLeft
    jsr WaveIndex
    lda WaveGap,x
    ldy R_wave
    cpy #13
    bcc .gap
    lsr                         ; second lap and later: three quarters of the gap
    lsr
    sta lt0
    lda WaveGap,x
    sec
    sbc lt0
.gap:
    sta W_spawnTimer
    rts

;-------------------------------------------------------------------------------
; Enemies: each walks left at its kind's pace; a toy in its way stops it and
; gets chewed (the helicopter hops over the first one instead); a lasso
; holds it; reaching the toy box is a breach
Enemies:
    SUBROUTINE
    ldx #NENEMY-1
.loop:
    lda R_eType,x
    bne .live
    jmp .next
.live:
    sta lt5
    lda R_eState,x
    and #$3F
    beq .free
    lda R_eState,x              ; lassoed: count down, stand still
    sec
    sbc #1
    sta W_eState,x
    jmp .next
.free:
    lda R_eX,x
    cmp #121
    bcs .noBlockAll             ; right of every toy
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
    bne .blocked
.noBlock:
    dey
    bpl .block
.noBlockAll:
    lda R_eState,x              ; walking: not chewing
    and #$7F
    sta W_eState,x
    ldy lt5
    lda R_wave
    cmp #13
    lda EnMask,y
    bcc .pace
    lda EnMaskFast,y            ; second lap: twice the speed
.pace:
    and frame
    bne .next
    lda R_eX,x
    sec
    sbc #1
    sta W_eX,x
    cmp #BREACH_X
    bcs .next
    jsr Breach
    jmp .next
.blocked:
    lda lt5
    cmp #EN_HELI
    bne .chew
    lda R_eState,x
    and #$40
    bne .chew
    ora R_eState,x              ; hop over the toy, once
    ora #$40
    sta W_eState,x
    ldy lt2
    lda ColX,y
    sec
    sbc #9
    sta W_eX,x
    cmp #BREACH_X
    bcs .next
    jsr Breach
    jmp .next
.chew:
    lda R_eState,x
    ora #$80
    sta W_eState,x
    lda frame
    and #15                     ; one bite every 16 frames
    bne .next
    ldy lt1
    lda R_slotHP,y
    sec
    sbc #1
    sta W_slotHP,y
    bne .next
    lda #0
    sta W_slotType,y
.next:
    dex
    bmi .done
    jmp .loop
.done:
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
.next:
    dey
    bpl .clear
    lda #40
    sta W_flash
    rts
.over:
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
    lda R_slotType,x
    beq .next
    cmp #TOY_TEDDY
    beq .next
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
    ora #60
    sta W_eState,y
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
    lda #0
    ldy lt5
    cpy #TOY_ARMY
    bne .kind
    lda #1
.kind:
    ldy lt1
    sta W_shotKind,y
    lda ShotStart,x
    sta shotPtr,y
    ldy lt5
    lda ToyPeriod,y
    sta W_slotCool,x
.next:
    dex
    bmi .done
    cpx lt4
    bcc .done
    jmp .loop
.done:
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
    lda R_eType,y
    beq .next
    lda R_eLane,y
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
    ldy #NENEMY-1
.loop:
    lda R_eType,y
    beq .next
    lda R_eLane,y
    cmp lt1
    bne .next
    lda lt0
    clc
    adc #3
    cmp R_eX,y
    bcc .next                   ; shot ends left of the enemy
    lda R_eX,y
    clc
    adc #7
    cmp lt0
    bcc .next                   ; enemy ends left of the shot
    lda R_shotKind,x
    beq .hit
    lda R_eType,y
    cmp #EN_CRAWL
    bne .hit
    lda R_eState,y
    bmi .next                   ; bullets pass over a crawler that is chewing
.hit:
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
; tables (toy and enemy types index from 1)
ToyCost:    .byte 0, 10, 5, 25, 15, 20, 30
ToyHP:      .byte 0, 8, 40, 12, 8, 10, 1
ToyPeriod:  .byte 0, 7, 0, 50, 20, 33, 0        ; visits (6 frames) between shots
ToyDmg:     .byte 0, 1, 0, 8, 0, 3, 0
EnHP:       .byte 0, 6, 5, 3
EnMask:     .byte 0, 3, 1, 1                    ; moves on frames where frame & mask = 0
EnMaskFast: .byte 0, 1, 0, 0
EnReward:   .byte 0, 3, 3, 2                    ; batteries
EnScore:    .byte 0, $10, $15, $10              ; BCD points
KindBit:    .byte 1, 2, 4                       ; dino, helicopter, crawler
; waves 1-12 (later waves repeat them)
WaveCount:  .byte 5, 7, 9, 10, 12, 12, 12, 14, 15, 18, 20, 22
WaveGap:    .byte 180, 150, 150, 135, 120, 120, 120, 105, 105, 90, 90, 90
WaveMax:    .byte 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5
WaveKinds:  .byte 1, 1, 1, 5, 5, 5, 7, 7, 7, 7, 7, 7
WaveUnlock: .byte 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 6, 6
Lane3:      .byte 0, 3, 6
Bit:        .byte 1, 2, 4
Mod3:       .byte 0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0,1
