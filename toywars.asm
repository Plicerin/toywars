; TOY WARS -- lane defense on the toy shelves (Atari 2600, 16K F6, NTSC)
;
; Milestone 1: the still screen. Three slanted shelves (the ball, moved six
; pixels left every row by HMOVE), the toy box (playfield 1, cleared mid-line
; so its reflected copy never shows), green toy defenders on a 3 x 3 grid
; (player 0 as three copies 32 pixels apart, graphics rewritten between the
; copies), red enemies (player 1, moved from enemy to enemy down the screen),
; and the defenders' shots (missile 1).
;
; Bank 0: frame loop, game logic, the event scheduler, the header (title and
; status line, 48-pixel text). Bank 1: the play kernel and its graphics.
; Banks 2-3: free (reset stubs only).
;
; Frame: 3 VSYNC + 37 VBLANK + 192 visible + 30 overscan = 262 lines.
; Visible: s0 blank, s1-14 title, s15 setup, s16-25 status, s26-28
; positioning, s29 blank, s30 rule, s31 setup, s32-191 play area (80 x 2).
;
; Play kernel: rows y = 79..0 (top to bottom), two lines each. Line A: HMOVE,
; box, shelf, shot, the three defender copies. Line B: box, defenders, enemy
; graphics and color, and the checks for the next special row:
;  - event rows (from a queue built in bank 0, pulled with PLA; RTS jumps to
;    one of eight variants that strobe RESP1 at a fixed cycle) move player 1
;    to the next enemy;
;  - static rows (fixed, via JMP (stVec)) swap the defender pointers to the
;    next lane, restart the ball and the shot missile on the next shelf, and
;    end the kernel.

    processor 6502
    include vcs.h

COL_GOLD    = $F8
COL_RED     = $46
COL_GREEN   = $C8
COL_BG      = $00

VBLANK_TIME   = 44
OVERSCAN_TIME = 35
NENEMY      = 5

;===============================================================================
    SEG.U vars
    ORG $80
pc0         ds 2        ; defender copy pointers (columns 0-2)
pc1         ds 2
pc2         ds 2
m1ptr       ds 2        ; shot (ENAM1) pointer
p1ptr       ds 2        ; enemy graphics pointer
p1col       ds 2        ; enemy color pointer (ColArr + feet row)
stVec       ds 2        ; next static row routine
nextEv      ds 1        ; y of the next event row
nextSt      ds 1        ; y of the next static row
slotPtr     ds 9        ; defender pointer (low byte) per lane*3+column
shotPtr     ds 3        ; shot pointer (low byte) per lane
frame       ds 1
; Shared scratch. SelectEnemies (overscan) fills eTop/eFeet/eOrder and
; Schedule (VBLANK) reads them; BuildStatus (VBLANK, after Schedule) then
; reuses the same bytes for the status line, which the header draws.
eTop        ds NENEMY   ; scheduler: event row, feet row, sorted order
eFeet       ds NENEMY
eOrder      ds NENEMY
cellS5      ds 5
cellS0      = eTop      ; status line cells (bottom row first), 5 bytes each
cellS1      = eFeet
cellS2      = eOrder
temp        ds 4
QUEUE       ds 35       ; event records, 7 bytes: return lo, hi, gfx lo, hi, feet, HMP1, next y
STACKTOP    = $FF

lineCnt     = temp+3    ; header loops
evPrevF     = temp+2    ; scheduler

    echo "RAM used: ", (QUEUE + 35 - $80)d, " bytes (stack above)"

; Super Chip RAM (cartridge, 128 bytes): write at W_name, read at R_name
; ($80 higher). Game state that the kernel doesn't need lives here.
    SEG.U scram
    ORG $F000
W_eX        ds NENEMY   ; enemies: left x, lane, type (0 none, 1 dino, 2 heli, 3 crouch)
W_eLane     ds NENEMY
W_eType     ds NENEMY
W_score     ds 3        ; BCD, most significant first
W_wave      ds 1
SC_END      = .
R_eX        = W_eX + $80
R_eLane     = W_eLane + $80
R_eType     = W_eType + $80
R_score     = W_score + $80
R_wave      = W_wave + $80
    echo "Super Chip RAM used: ", (SC_END - $F000)d, " bytes"

;===============================================================================
; BANK 0
;===============================================================================
    SEG bank0
    ORG $0000
    RORG $F000
    ds 256, 0                   ; Super Chip RAM window

Start0:
    sei
    cld
    ldx #0
    txa
.clear:
    dex
    txs
    pha
    bne .clear
    ldx #127
    lda #0
.clearSC:
    sta W_eX,x                  ; W_eX = $F000: the whole write port
    dex
    bpl .clearSC
    jsr InitScene
    jsr SelectEnemies

MainLoop:
    lda #2
    sta VBLANK
    sta WSYNC
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC
    lda #VBLANK_TIME
    sta TIM64T

    inc frame
    jsr Schedule                ; reads eTop/eFeet/eOrder ...
    jsr BuildStatus             ; ... then overwrites them with the status line
    lda #<(D_EMPTY - 79)        ; defenders: zeros until the lane 0 swaps
    sta pc0
    sta pc1
    sta pc2
    lda #>DefPage
    sta pc0+1
    sta pc1+1
    sta pc2+1
    lda #<Zeros
    sta p1ptr
    lda #>Zeros
    sta p1ptr+1
    lda #0
    sta p1col
    lda #>ColArr
    sta p1col+1
    lda shotPtr
    sta m1ptr
    lda #>ShotArr
    sta m1ptr+1
    lda #72                     ; first static row: row 7
    sta nextSt
    lda #<St7
    sta stVec
    lda #>St7
    sta stVec+1

    ; header: 48-pixel text, player 0 at x 54 and player 1 at x 62
    lda #54-3                   ; PosObject puts players 3 pixels right
    ldx #0
    jsr PosObject
    lda #62-3
    ldx #1
    jsr PosObject
    sta WSYNC
    sta HMOVE
    lda #3                      ; three copies, close
    sta NUSIZ0
    sta NUSIZ1
    lda #1
    sta VDELP0
    sta VDELP1
    lda #COL_RED
    sta COLUP0
    sta COLUP1
    lda #COL_BG
    sta COLUBK
    lda #0
    sta GRP0
    sta GRP1
    sta GRP0
    sta PF0
    sta PF1
    sta PF2
    sta ENABL
    sta ENAM0
    sta ENAM1
    sta CTRLPF

.vbWait:
    lda INTIM
    bne .vbWait
    sta WSYNC                   ; s0 starts
    sta HMCLR
    lda #0
    sta VBLANK
    lda #13
    sta lineCnt
    ldy #6

    ; s1-14: title, seven font rows of two lines
.title:
    sta WSYNC
    lda Title0,y
    sta GRP0
    lda Title1,y
    sta GRP1
    lda Title2,y
    sta GRP0
    lda Title4,y
    tax
    lda Title5,y
    sta temp
    lda Title3,y
    ldy temp
    sta GRP1                    ; lands on cycle 43
    stx GRP0
    sty GRP1
    sta GRP0
    dec lineCnt
    bmi .titleDone
    lda lineCnt
    lsr
    tay
    jmp .title
.titleDone:

    sta WSYNC                   ; s15
    lda #0
    sta GRP0
    sta GRP1
    sta GRP0
    lda #COL_GOLD
    sta COLUP0
    sta COLUP1
    lda #9
    sta lineCnt
    ldy #4

    ; s16-25: status line, five font rows of two lines
.status:
    sta WSYNC
    lda cellS0,y
    sta GRP0
    lda cellS1,y
    sta GRP1
    lda cellS2,y
    sta GRP0
    lda Status4,y
    tax
    lda cellS5,y
    sta temp
    lda Status3,y
    ldy temp
    sta GRP1
    stx GRP0
    sty GRP1
    sta GRP0
    dec lineCnt
    bmi .statusDone
    lda lineCnt
    lsr
    tay
    jmp .status
.statusDone:                    ; still s25, past the text
    lda #0
    sta GRP0
    sta GRP1
    sta GRP0
    sta VDELP0
    sta VDELP1
    jmp ToBank1

;-------------------------------------------------------------------------------
Overscan:                       ; from bank 1, the line after s191
    lda #OVERSCAN_TIME
    sta TIM64T
    jsr Motion
    jsr SelectEnemies
.osWait:
    lda INTIM
    bne .osWait
    jmp MainLoop

;-------------------------------------------------------------------------------
PosObject:                      ; A = x, X = object (0 P0, 1 P1, 2 M0, 3 M1, 4 BL)
    SUBROUTINE
    sta WSYNC
    sec
.divide:
    sbc #15
    bcs .divide
    eor #7
    asl
    asl
    asl
    asl
    sta HMP0,x
    sta RESP0,x
    rts

;-------------------------------------------------------------------------------
; status cells: score digits two per cell, "E" plus the wave digit
BuildStatus:
    SUBROUTINE
    lda #0
    sta temp+2                  ; destination offset from cellS0 (0-14)
    tax
.cell:
    stx temp+3
    lda R_score,x
    lsr
    lsr
    lsr
    lsr
    sta temp
    asl
    asl
    adc temp
    sta temp                    ; high digit * 5
    lda R_score,x
    and #$0F
    sta temp+1
    asl
    asl
    adc temp+1
    sta temp+1                  ; low digit * 5
    ldy #4
.row:
    ldx temp
    lda DigitHi,x
    ldx temp+1
    ora DigitLo,x
    ldx temp+2
    sta cellS0,x
    inc temp
    inc temp+1
    inc temp+2
    dey
    bpl .row
    ldx temp+3
    inx
    cpx #3
    bne .cell
    lda R_wave
    sta temp
    asl
    asl
    adc temp
    tax
    ldy #0
.wave:
    lda Status5E,y
    ora DigitR,x
    sta cellS5,y
    inx
    iny
    cpy #5
    bne .wave
    rts

;-------------------------------------------------------------------------------
; Demo motion (until there is gameplay): enemies walk left one pixel every
; fourth frame and come back on the right; shots fly right one row (six
; pixels) every fourth frame and restart at the first column. The TV type
; switch on B/W holds everything still.
Motion:
    SUBROUTINE
    lda SWCHB
    and #$08
    beq .done
    lda frame
    and #3
    bne .done
    ldx #NENEMY-1
.enemy:
    lda R_eType,x
    beq .nextEnemy
    lda R_eX,x
    sec
    sbc #1
    cmp #52
    bcs .stepped
    lda #151
.stepped:
    sta W_eX,x
.nextEnemy:
    dex
    bpl .enemy
    ldx #2
.shot:
    lda shotPtr,x
    cmp #80
    beq .nextShot                ; no shot in this lane
    sec
    sbc #1                      ; one row up the diagonal = six pixels right
    cmp ShotFirst,x
    bcs .store
    lda ShotLast,x
.store:
    sta shotPtr,x
.nextShot:
    dex
    bpl .shot
.done:
    rts
ShotFirst:                      ; shot rows of each lane: x 149 ... x 59
    .byte 11, 31, 51
ShotLast:
    .byte 26, 46, 66

;-------------------------------------------------------------------------------
InitScene:
    SUBROUTINE
    lda #$01
    sta W_score+1
    lda #$20
    sta W_score+2               ; 000120
    lda #1
    sta W_wave
    ldx #8
.slots:
    lda SceneSlot,x
    clc
    adc SlotOfs,x
    sta slotPtr,x
    dex
    bpl .slots
    ldx #NENEMY-1
.enemies:
    lda SceneEX,x
    sta W_eX,x
    lda SceneELane,x
    sta W_eLane,x
    lda SceneEType,x
    sta W_eType,x
    dex
    bpl .enemies
    ldx #2
.shots:
    lda SceneShot,x
    sta shotPtr,x
    dex
    bpl .shots
    rts

;-------------------------------------------------------------------------------
; SelectEnemies (overscan, after Motion): decide which enemies player 1 draws
; next frame. Each enemy needs rows E-1 .. feet, where E is its event row (the
; first row at or above top-1 that the kernel allows) and E-1 is blank. They
; are sorted by E; one that overlaps an enemy already taken waits.
SelectEnemies:
    SUBROUTINE
    ldx #NENEMY-1
.tf:
    txa
    sta eOrder,x
    lda R_eType,x
    beq .none
    ldy R_eX,x
    lda FeetX,y
    ldy R_eLane,x
    clc
    adc LaneBase,y
    sta eFeet,x
    sec
    sbc #11                     ; top - 1: the latest row for its event
    tay
.findE:
    lda RowBad,y
    beq .gotE
    dey
    bne .findE
.gotE:
    tya
    sta eTop,x                  ; eTop = the event row (0: none usable)
    jmp .next
.none:
    lda #$FF
    sta eTop,x
.next:
    dex
    bpl .tf
    ; insertion sort of eOrder by eTop
    ldx #1
.so:
    stx temp+3
    lda eOrder,x
    sta temp
    tay
    lda eTop,y
    sta temp+1
    ldy temp+3
.si:
    ldx eOrder-1,y
    lda eTop,x
    cmp temp+1
    bcc .place
    beq .place
    txa
    sta eOrder,y
    dey
    bne .si
.place:
    lda temp
    sta eOrder,y
    ldx temp+3
    inx
    cpx #NENEMY
    bne .so
    ; choose: walk the sorted list from position frame mod n, wrapping, and
    ; take each enemy whose rows (top-2 .. feet) miss every enemy taken so far.
    ; The start moves every frame, so enemies that overlap take turns.
    ldx #0
.count:
    ldy eOrder,x
    lda eTop,y
    cmp #$FF
    beq .counted
    inx
    cpx #NENEMY
    bne .count
.counted:
    stx temp+3                  ; n
    txa
    beq .selDone
    sta temp+1                  ; candidates left
    lda frame
    sec
.mod:
    sbc temp+3
    bcs .mod
    adc temp+3
    sta temp+2                  ; position: frame mod n
.cand:
    ldx temp+2
    ldy eOrder,x
    lda eTop,y
    sec
    sbc #1
    bcc .reject                 ; no usable event row
    sta temp                    ; candidate event row - 1
    lda eFeet,y
    sta QUEUE                   ; candidate feet (the queue is free until VBLANK)
    ldx #0
.vs:
    lda eOrder,x
    bpl .vsNext                 ; not taken
    and #$7F
    tay
    lda eFeet,y
    cmp temp
    bcc .vsNext                 ; taken one ends above the candidate
    lda eTop,y
    sec
    sbc #1
    cmp QUEUE
    beq .reject
    bcc .reject                 ; overlap
.vsNext:
    inx
    cpx temp+3
    bne .vs
    ldx temp+2
    lda eOrder,x
    ora #$80
    sta eOrder,x
.reject:
    inc temp+2
    lda temp+2
    cmp temp+3
    bne .noWrap
    lda #0
    sta temp+2
.noWrap:
    dec temp+1
    bne .cand
.selDone:
    rts

;-------------------------------------------------------------------------------
; Schedule (VBLANK): the event queue for the enemies SelectEnemies took, one
; 7-byte record per enemy in row order.
Schedule:
    SUBROUTINE
    lda #0
    sta evPrevF
    sta temp+3
    lda #$FF
    sta nextEv
    ldx #0
.q:
    ldy temp+3
    lda eOrder,y
    bmi .qTaken
    jmp .qNext
.qTaken:
    and #$7F
    tay
    lda eTop,y
    clc
    adc #1
    sta temp                    ; event row + 1
.qDec:
    dec temp
    lda evPrevF
    clc
    adc #1
    cmp temp
    bcs .qNext                  ; needs event row > previous feet + 1
    sty temp+1
    ldy temp
    lda RowBad,y
    ldy temp+1
    cmp #0
    bne .qDec
    lda #79
    sec
    sbc temp                    ; y of the event row
    cpx #0
    bne .link
    sta nextEv
    jmp .rec
.link:
    sta QUEUE-1,x
.rec:
    lda R_eX,y
    sty temp+1
    tay
    lda XHm,y
    sta QUEUE+5,x
    lda XVar,y
    tay
    lda VarLo,y
    sta QUEUE,x
    lda VarHi,y
    sta QUEUE+1,x
    ldy temp+1
    lda eFeet,y
    sta QUEUE+4,x
    sta evPrevF
    lda R_eX,y                  ; walking frame: (x >> 2) & 1
    lsr
    lsr
    and #1
    sta QUEUE+6,x               ; (scratch until the next record links here)
    lda R_eType,y
    asl
    ora QUEUE+6,x
    tay
    lda QUEUE+4,x
    clc
    adc EBaseLo,y
    sta QUEUE+2,x
    lda EBaseHi,y
    adc #0
    sta QUEUE+3,x
    lda #$FF
    sta QUEUE+6,x
    txa
    clc
    adc #7
    tax
    cpx #35
    bcs .done
.qNext:
    inc temp+3
    lda temp+3
    cmp #NENEMY
    beq .done
    jmp .q
.done:
    rts

    include "gen/bank0.inc"

;-------------------------------------------------------------------------------
; F6 hotspots: an access to $FFF6/$FFF7/$FFF8/$FFF9 selects bank 0/1/2/3.
; A switch takes effect on the next fetch, at the same address in the new bank.
    ORG $0FE0
    RORG $FFE0
ToBank1:
    lda $FFF7                   ; bank 1 continues at $FFE3: jmp PreKernel
    nop
    nop
    nop
    lda $FFF6                   ; ($FFE6) bank 1 switches here
    jmp Overscan                ; ($FFE9)

    ORG $0FF0
    RORG $FFF0
Reset0:
    lda $FFF6                   ; every bank's reset stub: the cartridge can
    jmp Start0                  ; power up in any bank
    ORG $0FFA
    RORG $FFFA
    .word Reset0, Reset0, Reset0

;===============================================================================
; BANK 1
;===============================================================================
    SEG bank1
    ORG $1000
    RORG $F000
    ds 256, 0                   ; Super Chip RAM window

    include "gen/bank1.inc"

;-------------------------------------------------------------------------------
PreKernel:                      ; arrives early in s26
    sta WSYNC                   ; s27: fixed positions. A RESPx write lands on
    lda #0                      ; 0-1    its last cycle w: players at 3w-60,
    sta VDELP0                  ; 2-4    missiles and the ball at 3w-61
    sta VDELP1                  ; 5-7
    sta GRP0                    ; 8-10
    sta GRP1                    ; 11-13
    sta HMP0                    ; 14-16
    sta HMBL                    ; 17-19
    lda #$B0                    ; 20-21
    sta HMM1                    ; 22-24  missile 1: 56 + 5 = 61 at the s30 HMOVE
    nop                         ; 25-26
    nop                         ; 27-28
    nop                         ; 29-30
    bit $80                     ; 31-33
    sta RESP0                   ; 34-36  player 0 at 48
    sta RESM1                   ; 37-39  missile 1 at 56
    REPEAT 15
    nop                         ; 40-69
    REPEND
    sta RESBL                   ; 70-72  ball at 155
    sta WSYNC                   ; s28
    sta WSYNC                   ; s29
    sta WSYNC                   ; s30: rule
    sta HMOVE                   ; 0-2
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2                     ; by cycle 15
    lda #COL_GOLD
    sta COLUPF
    lda #COL_GREEN
    sta COLUP0
    lda #COL_GOLD
    sta COLUP1
    lda #6                      ; player 0: three copies 32 apart
    sta NUSIZ0
    lda #$20                    ; missile 1: 4 pixels wide
    sta NUSIZ1
    lda #$21                    ; ball 4 wide, reflected playfield
    sta CTRLPF
    lda #0
    sta GRP0
    sta GRP1
    sta HMP0
    sta HMP1
    sta HMM0
    lda #$60                    ; ball and shot move 6 left per HMOVE
    sta HMBL
    sta HMM1
    sta WSYNC                   ; s31
    lda #0
    sta PF0
    sta PF1
    sta PF2
    ldx #QUEUE-1
    txs
    ldx #0
    ldy #79
    jmp RowA

PosObject1:
    SUBROUTINE
    sta WSYNC
    sec
.divide:
    sbc #15
    bcs .divide
    eor #7
    asl
    asl
    asl
    asl
    sta HMP0,x
    sta RESP0,x
    rts

;-------------------------------------------------------------------------------
; the kernel rows: keep in one page so branches take fixed time
    ALIGN 256

    MAC LINE_A                  ; cycles 0-51 of a line A
    sta HMOVE                   ; 0-2
    lda BoxTab,y                ; 3-6
    sta PF1                     ; 7-9
    lda BallTab,y               ; 10-13
    sta ENABL                   ; 14-16
    lda (m1ptr),y               ; 17-21
    sta ENAM1                   ; 22-24
    lda (pc0),y                 ; 25-29
    sta GRP0                    ; 30-32  copy 0 (x 48)
    lda (pc1),y                 ; 33-37
    stx PF1                     ; 38-40  clear before the reflected copy (x 112)
    sta GRP0                    ; 41-43  copy 1 (x 80)
    lda (pc2),y                 ; 44-48
    sta GRP0                    ; 49-51  copy 2 (x 112)
    ENDM

    MAC LINE_B                  ; cycles 0-54 of a line B, ends after dey
    lda BoxTab,y                ; 0-3
    sta PF1                     ; 4-6
    lda (pc0),y                 ; 7-11
    sta GRP0                    ; 12-14
    stx HMP1                    ; 15-17
    lda (p1ptr),y               ; 18-22 (+1 on a page cross)
    sta GRP1                    ; 23-25
    lda (p1col),y               ; 26-30
    sta COLUP1                  ; 31-33
    lda (pc1),y                 ; 34-38
    stx PF1                     ; 39-41
    sta GRP0                    ; 42-44
    lda (pc2),y                 ; 45-49
    sta GRP0                    ; 50-52
    dey                         ; 53-54
    ENDM

RowA:
    sta WSYNC
RowAH:
    LINE_A
    sta WSYNC
RowB:
    LINE_B
    cpy nextEv                  ; 55-57
    beq EvRowA                  ; 58-59
    cpy nextSt                  ; 60-62
    beq StRowA                  ; 63-64
    jmp RowA                    ; 65-67

EvRowA:
    sta WSYNC
    LINE_A
    rts                         ; 52-57: into the event variant (EvA*)

StRowA:
    sta WSYNC
    LINE_A
    jmp (stVec)                 ; 52-56: into the static row routine

;-------------------------------------------------------------------------------
; static rows. Line A tails start on cycle 57.
    ALIGN 256

    MAC ST_SWAP                 ; {1} slot, {2} pointer, {3} next y, {4} next routine
    lda slotPtr+{1}             ; 57-59
    sta {2}                     ; 60-62
    lda #{3}                    ; 63-64
    sta nextSt                  ; 65-67
    lda #>{4}                   ; 68-69
    sta stVec+1                 ; 70-72
    sta WSYNC                   ; 73-75
    LINE_B
    lda #<{4}                   ; 55-56
    sta stVec                   ; 57-59
    cpy nextEv                  ; 60-62
    beq .ev                     ; 63-64
    jmp RowA                    ; 65-67
.ev jmp EvRowA
    ENDM

    MAC ST_BALL                 ; {1} next y, {2} next routine
    lda #{1}                    ; 57-58
    sta nextSt                  ; 59-61
    lda #>{2}                   ; 62-63
    sta stVec+1                 ; 64-66
    bit $80                     ; 67-69
    sta RESBL                   ; 70-72: x 155, 149 after the next HMOVE
    sta WSYNC                   ; 73-75
    LINE_B
    lda #<{2}
    sta stVec
    cpy nextEv
    beq .ev
    jmp RowA
.ev jmp EvRowA
    ENDM

    MAC ST_SHOT                 ; {1} lane, {2} next y, {3} next routine
    lda #{2}                    ; 57-58
    sta nextSt                  ; 59-61
    lda #>{3}                   ; 62-63
    sta stVec+1                 ; 64-66
    bit $80                     ; 67-69
    sta RESM1                   ; 70-72
    sta WSYNC                   ; 73-75
    LINE_B
    lda shotPtr+{1}             ; 55-57
    sta m1ptr                   ; 58-60
    lda #<{3}                   ; 61-62
    sta stVec                   ; 63-65
    jmp RowA                    ; 66-68 (no event right after a shot row)
    ENDM

St7     SUBROUTINE
    ST_SWAP 2, pc2, 67, St12    ; row 7: column 2 -> lane 0
St12    SUBROUTINE
    ST_SWAP 1, pc1, 62, St17
St17    SUBROUTINE
    ST_SWAP 0, pc0, 60, St19
St19    SUBROUTINE
    ST_BALL 51, St28            ; row 19: shelf 1
St28    SUBROUTINE
    ST_SWAP 5, pc2, 49, St30    ; row 28: column 2 -> lane 1
St30    SUBROUTINE
    ST_SHOT 1, 46, St33         ; row 30: shots of lane 1
St33    SUBROUTINE
    ST_SWAP 4, pc1, 42, St37
St37    SUBROUTINE
    ST_SWAP 3, pc0, 40, St39
St39    SUBROUTINE
    ST_BALL 31, St48
St48    SUBROUTINE
    ST_SWAP 8, pc2, 29, St50
St50    SUBROUTINE
    ST_SHOT 2, 26, St53
St53    SUBROUTINE
    ST_SWAP 7, pc1, 22, St57
St57    SUBROUTINE
    ST_SWAP 6, pc0, 20, St59
St59    SUBROUTINE
    ST_BALL 0, StEnd
StEnd   SUBROUTINE              ; row 79 (y 0): the last line B, then overscan
    sta WSYNC
    LINE_B
    sta WSYNC
    lda #2
    sta VBLANK
    lda #0
    sta GRP0
    sta GRP1
    sta ENABL
    sta ENAM1
    sta PF1
    ldx #STACKTOP
    txs
    jmp ToBank0

;-------------------------------------------------------------------------------
    include "gen/variants.inc"

;-------------------------------------------------------------------------------
    ORG $1FE0
    RORG $FFE0
    lda $FFF6                   ; (bank 0 switches to 1 here)
    jmp PreKernel               ; $FFE3
ToBank0:
    lda $FFF6                   ; $FFE6: bank 0 continues at $FFE9
    ORG $1FF0
    RORG $FFF0
Reset1:
    lda $FFF6
    ORG $1FFA
    RORG $FFFA
    .word Reset1, Reset1, Reset1

;===============================================================================
; BANKS 2 and 3: free for now (game logic and sound will move here)
;===============================================================================
    SEG bank2
    ORG $2000
    RORG $F000
    ds 256, 0                   ; Super Chip RAM window
    ORG $2FF0
    RORG $FFF0
Reset2:
    lda $FFF6
    ORG $2FFA
    RORG $FFFA
    .word Reset2, Reset2, Reset2

    SEG bank3
    ORG $3000
    RORG $F000
    ds 256, 0                   ; Super Chip RAM window
    ORG $3FF0
    RORG $FFF0
Reset3:
    lda $FFF6
    ORG $3FFA
    RORG $FFFA
    .word Reset3, Reset3, Reset3
