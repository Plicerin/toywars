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
; Bank 2: game logic (logic.asm). Bank 3: sound steps and music (sound.asm).
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
COL_ORANGE  = $38
COL_RED_DK  = $42                ; enemies' bottom rows
COL_ORANGE_DK = $34
COL_HEADER  = $A0                ; dark navy behind the title and status line
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
pfColor     ds 1        ; shelves and box (flashes white on a lid slam or air strike)
; scheduler scratch: SelectEnemies (overscan) fills it, Schedule (VBLANK) reads it
eTop        ds NENEMY   ; event row
eFeet       ds NENEMY   ; feet row
eOrder      ds NENEMY   ; sorted order, bit 7 = drawn this frame
temp        ds 4
lt0         ds 1        ; game logic scratch (bank 2)
lt1         ds 1
lt2         ds 1
lt3         ds 1
lt4         ds 1
lt5         ds 1
sndX        ds 1        ; SndPlay keeps X and Y here
sndY        ds 1
fast        ds 1        ; bit 7: second-lap pace (wave 13+); bit 6: shorter spawn gaps (wave 13+ or left difficulty A); bit 5: difficulty A
QUEUE       ds 48       ; event records, 8 bytes: return lo, hi, gfx lo, hi, color lo, hi, HMP1, next y
STACKTOP    = $FF

lineCnt     = temp+3    ; header loops
evPrevF     = temp+2    ; scheduler

    echo "RAM used: ", (QUEUE + 48 - $80)d, " bytes (stack above)"

; Super Chip RAM (cartridge, 128 bytes): write at W_name, read at R_name
; ($80 higher). Game state that the kernel doesn't need lives here.
    SEG.U scram
    ORG $F000
W_eX        ds NENEMY   ; enemies: left x
W_eLane     ds NENEMY   ;   shelf 0-2
W_eType     ds NENEMY   ;   0 none, 1 dino, 2 helicopter, 3 crawler
W_eHP       ds NENEMY   ;   health
W_eState    ds NENEMY   ;   bit 7 chewing, bit 6 hopped (knight: shield broken; pogo: jumped),
                        ;   bit 5 hurt (half its health or less), bit 4 a quarter or less,
                        ;   bits 0-3 half its full health (at most 15)
W_slotType  ds 9        ; toys per slot (shelf*3+column): 0 none, 1-6 (TOY_*)
W_slotHP    ds 9
W_slotCool  ds 9        ; visits (6 frames) until the toy acts again
W_toyShelf  ds 1        ; the shelf whose toys act next
W_sndPos    ds 2        ; per channel: position in SndData
W_sndTimer  ds 2        ;   ticks left in the step
W_sndPri    ds 2        ;   priority of what's playing (0 = quiet)
W_bossLeft  ds 1        ; T-Rexes still to come this wave
W_packLeft  ds 1        ; wind-up mice still to come in the pack
W_packTimer ds 1
W_packLane  ds 1
W_game      ds 1        ; game 1-3 (Game Select): starts at wave 1, 5 or 9
W_selPrev   ds 1        ; Game Select held last frame
W_musPos    ds 1        ; music: eighth note 0-63 of the theme
W_musTimer  ds 1        ;   frames into it (0-11)
W_shotDmg   ds 3        ; per shelf: damage of the shot in flight, 0 = none
W_shotKind  ds 3        ;   1 = an army man's bullet (passes over a chewing crawler)
W_splashX   ds 1        ; a cannonball's burst being swept (odd frames): x of the monster hit,
W_splashL   ds 1        ;   its shelf,
W_splashN   ds 1        ;   that monster << 4 | monsters left to check (0 = none)
W_bag       ds 1        ; spawn shelves drawn this bag (2 bits a shelf; six to a bag)
W_score     ds 3        ; BCD, most significant first
W_wave      ds 1        ; binary, from 1
W_batt      ds 1        ; batteries, binary 0-99
W_battTimer ds 1
W_cursor    ds 1        ; slot 0-8
W_toy       ds 1        ; toy type chosen for placing
W_unlock    ds 1        ; highest toy type unlocked
W_input     ds 1        ; last frame's joystick (bits 3-0 right left down up) and fire (bit 7)
W_repeat    ds 1        ; cursor auto-repeat countdown
W_fireState ds 1        ; 1 = fire pressed (act on release), 2 = used to change toy
W_swPrev    ds 1        ; Game Reset held last frame
W_lids      ds 1        ; bits 0-2: shelf's lid slam used
W_state     ds 1        ; 0 attract, 1 playing, 2 game over
W_overTimer ds 1
W_spawnLeft ds 1
W_spawnTimer ds 1
W_rand      ds 1
W_flash     ds 1
W_dirty     ds 1        ; status line parts to rebuild: 1/8/16 score cells, 2 batteries, 4 wave,
                        ; 32 the whole line as GAME n (game selection)
W_cells     ds 30       ; status line, 6 cells x 5 rows (bottom row first)
SC_END      = .
R_eX         = W_eX + $80
R_eLane      = W_eLane + $80
R_eType      = W_eType + $80
R_eHP        = W_eHP + $80
R_eState     = W_eState + $80
R_slotType   = W_slotType + $80
R_slotHP     = W_slotHP + $80
R_slotCool   = W_slotCool + $80
R_shotDmg    = W_shotDmg + $80
R_shotKind   = W_shotKind + $80
R_splashX    = W_splashX + $80
R_splashL    = W_splashL + $80
R_splashN    = W_splashN + $80
R_bag        = W_bag + $80
R_score      = W_score + $80
R_wave       = W_wave + $80
R_batt       = W_batt + $80
R_battTimer  = W_battTimer + $80
R_cursor     = W_cursor + $80
R_toy        = W_toy + $80
R_unlock     = W_unlock + $80
R_input      = W_input + $80
R_repeat     = W_repeat + $80
R_fireState  = W_fireState + $80
R_swPrev     = W_swPrev + $80
R_lids       = W_lids + $80
R_state      = W_state + $80
R_overTimer  = W_overTimer + $80
R_spawnLeft  = W_spawnLeft + $80
R_spawnTimer = W_spawnTimer + $80
R_rand       = W_rand + $80
R_flash      = W_flash + $80
R_dirty      = W_dirty + $80
R_toyShelf   = W_toyShelf + $80
R_sndPos     = W_sndPos + $80
R_sndTimer   = W_sndTimer + $80
R_sndPri     = W_sndPri + $80
R_bossLeft   = W_bossLeft + $80
R_packLeft   = W_packLeft + $80
R_packTimer  = W_packTimer + $80
R_packLane   = W_packLane + $80
R_game       = W_game + $80
R_selPrev    = W_selPrev + $80
R_musPos     = W_musPos + $80
R_musTimer   = W_musTimer + $80
R_cells      = W_cells + $80
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
    ldx #NENEMY-1               ; the enemy sort order persists from frame to frame
.order:
    txa
    sta eOrder,x
    dex
    bpl .order
    jsr CallInit                ; bank 2: power-on state (attract mode)

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
    jsr SelectEnemies
    jsr Schedule
    jsr BuildStatus
    jsr CallSound               ; bank 2: sound steps or music
    lda #161                    ; defenders: rows 0-16 read the page's zero tail
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
    sta WSYNC                   ; RESPx lands on its last cycle w: x = 3w - 60
    lda #$10                    ; 0-1
    sta HMP1                    ; 2-4    player 1: 63 - 1 = 62 at the HMOVE
    lda #0                      ; 5-6
    sta HMP0                    ; 7-9
    REPEAT 13
    nop                         ; 10-35
    REPEND
    sta RESP0                   ; 36-38  player 0 at 54
    sta RESP1                   ; 39-41  player 1 at 63
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
    lda #COL_HEADER             ; the header panel (s0-s28)
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
    lda R_state
    cmp #2
    bne .title
    jmp .over

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
    jmp .header2

.over:                          ; the same with GAME OVER
    sta WSYNC
    lda Over0,y
    sta GRP0
    lda Over1,y
    sta GRP1
    lda Over2,y
    sta GRP0
    lda Over4,y
    tax
    lda Over5,y
    sta temp
    lda Over3,y
    ldy temp
    sta GRP1
    stx GRP0
    sty GRP1
    sta GRP0
    dec lineCnt
    bmi .header2
    lda lineCnt
    lsr
    tay
    jmp .over

.header2:
    sta WSYNC                   ; s15
    lda #0
    sta GRP0
    sta GRP1
    sta GRP0
    lda #COL_GOLD
    sta COLUP0
    sta COLUP1
    lda #1                      ; player 1: two copies (the text is 40 pixels)
    sta NUSIZ1
    lda #COL_GREEN
    sta COLUPF
    ldy #0

    ; s16-25: the status line, five font rows of two lines (unrolled): the
    ; score and wave are 40-pixel text (player 0 three copies, player 1 two,
    ; x 54-93); the batteries are PF1 blocks in green, x 96-123. PF1 is cleared
    ; as each line starts, so the left half stays blank, and set after the
    ; text, before the beam reaches x 96 (cycle 54).
    MAC STATUSLINE              ; {1} = font row (bottom first)
    sta WSYNC
    sty PF1                     ; 0-2    (Y = 0)
    bit $80                     ; 3-5
    lda R_cells+{1}             ; 6-9
    sta GRP0                    ; 10-12
    lda R_cells+5+{1}           ; 13-16
    sta GRP1                    ; 17-19
    lda R_cells+10+{1}          ; 20-23
    sta GRP0                    ; 24-26
    lda R_cells+15+{1}          ; 27-30  cell 3
    ldx R_cells+20+{1}          ; 31-34  cell 4
    ldy R_cells+25+{1}          ; 35-38  PF1: the batteries
    nop                         ; 39-40
    sta GRP1                    ; 41-43  cell 2 shows, cell 3 waits
    stx GRP0                    ; 44-46  cell 3 shows, cell 4 waits
    sty GRP1                    ; 47-49  cell 4 shows (player 1 has no third copy)
    sty PF1                     ; 50-52
    ldy #0                      ; 53-54
    ENDM
    STATUSLINE 4
    STATUSLINE 4
    STATUSLINE 3
    STATUSLINE 3
    STATUSLINE 2
    STATUSLINE 2
    STATUSLINE 1
    STATUSLINE 1
    STATUSLINE 0
    STATUSLINE 0

    sta WSYNC                   ; s26
    sty PF1                     ; (Y = 0)
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
    jsr CallLogic               ; bank 2: the game
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
; BuildStatus: rebuild the parts of the status line that changed (W_dirty).
; Cells (narrow 3x5 font, two characters per 8-pixel cell): 0-2 the score's
; last five digits (cell 2 holds one), 3 "W" + the wave's tens, 4 its ones;
; the sixth cell's bytes hold PF1: the batteries' two digits, in green.
BuildStatus:                    ; (one part per frame, to keep VBLANK short)
    SUBROUTINE
    lda R_dirty                 ; game selection: the line reads GAME n
    and #$20
    beq .notGame
    ldx R_game
    lda GameTextAt,x
    tax
    ldy #0
.game:
    lda GameText,x
    sta W_cells,y
    inx
    iny
    cpy #30
    bne .game
    lda R_dirty
    and #$DF
    sta W_dirty
    rts
.notGame:
    ; the score's three cells one per frame: dirty bit 0, then 3, then 4
    lda R_dirty
    and #$19
    beq .noScore
    ldx #0
    lsr
    bcs .cell
    inx
    lsr
    lsr
    lsr
    bcs .cell
    inx
.cell:                          ; cell X: the low digit of score byte X, then
    stx temp+3                  ; the high digit of byte X+1 (cell 2: a blank)
    lda R_score,x
    and #$0F
    sta temp
    asl
    asl
    adc temp
    sta temp                    ; first digit * 5
    lda #50                     ; (DigitLo + 50 is blank)
    cpx #2
    beq .last
    lda R_score+1,x
    lsr
    lsr
    lsr
    lsr
    sta temp+1
    asl
    asl
    adc temp+1
.last:
    sta temp+1                  ; second digit * 5
    lda temp+3
    asl
    asl
    adc temp+3
    sta temp+2                  ; destination: cell * 5
    ldy #4
.row:
    ldx temp
    lda DigitHi,x
    ldx temp+1
    ora DigitLo,x
    ldx temp+2
    sta W_cells,x
    inc temp
    inc temp+1
    inc temp+2
    dey
    bpl .row
    ldx temp+3
    lda R_dirty
    and ScoreDone,x
    ora ScoreNext,x
    sta W_dirty
    rts
ScoreDone:  .byte $FE, $F7, $EF  ; clear this cell's bit ...
ScoreNext:  .byte $08, $10, $00  ; ... and ask for the next
.noScore:
    lda R_dirty
    and #2
    beq .noBatt
    ldx R_batt
    jsr TwoDigits               ; temp = tens*5, temp+1 = ones*5
    ldy #0
.batt:
    ldx temp
    lda DigitHi,x
    ldx temp+1
    ora DigitLo,x
    sta W_cells+25,y            ; PF1
    inc temp
    inc temp+1
    iny
    cpy #5
    bne .batt
    lda R_dirty
    and #$FD
    sta W_dirty
    rts
.noBatt:
    lda R_dirty
    and #4
    beq .done
    ldx R_wave
    cpx #100
    bcc .w
    ldx #99
.w:
    jsr TwoDigits
    ldy #0
.wave:
    ldx temp
    lda DigitLo,x
    ora WHi,y
    sta W_cells+15,y
    ldx temp+1
    lda DigitHi,x
    sta W_cells+20,y
    inc temp
    inc temp+1
    iny
    cpy #5
    bne .wave
.done:
    lda #0
    sta W_dirty
    rts

TwoDigits:                      ; X = 0-99 -> temp = tens*5, temp+1 = ones*5
    lda Bin2BCD,x
    lsr
    lsr
    lsr
    lsr
    sta temp
    asl
    asl
    adc temp
    sta temp
    lda Bin2BCD,x
    and #$0F
    sta temp+1
    asl
    asl
    adc temp+1
    sta temp+1
    rts

;-------------------------------------------------------------------------------
; SelectEnemies (VBLANK): decide which enemies player 1 draws this frame. Each enemy needs rows E-1 .. feet, where E is its event row (the
; first row at or above top-1 that the kernel allows) and E-1 is blank. They
; are sorted by E; one that overlaps an enemy already taken waits.
SelectEnemies:
    SUBROUTINE
    ldx #NENEMY-1               ; (eFeet/eTop come from EnemyRows in bank 2)
.clear:
    lda eOrder,x                ; forget last frame's choice, keep the order
    and #$7F
    sta eOrder,x
    dex
    bpl .clear
    ; insertion sort of eOrder by eTop (nearly sorted already: cheap)
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
    bne .shift
    cpx temp                    ; same event row: the lower enemy number first
    bcc .place
.shift:
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
    ; choose: walk the sorted list from position (frame & 7) mod n, wrapping,
    ; and take each enemy whose rows (event row - 1 .. feet) miss every enemy
    ; taken so far. The start moves every frame, so overlapping ones take turns.
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
    and #7                      ; start: (frame & 7) mod n, so it visits every position
    sec
.mod:
    sbc temp+3
    bcs .mod
    adc temp+3
    sta temp+2
;   The list is sorted by event row, so within each run (start..n-1, then
;   0..start-1) a candidate can only overlap the last enemy taken in that
;   run; in the second run it must also end above the first enemy taken in
;   the first. QUEUE+0..3 (free until Schedule): last taken feet, any taken
;   in this run, first run's first event row, in the second run.
    lda #0
    sta QUEUE+1
    sta QUEUE+3
    lda #$FF
    sta QUEUE+2
.cand:
    ldx temp+2
    ldy eOrder,x
    lda eTop,y
    beq .reject                 ; no usable event row
    sec
    sbc #1
    sta temp                    ; candidate event row - 1
    lda QUEUE+1
    beq .noPrev
    lda QUEUE
    cmp temp
    bcs .reject                 ; the last one taken ends at or below it
.noPrev:
    lda QUEUE+3
    beq .take
    lda eFeet,y
    clc
    adc #1
    cmp QUEUE+2
    bcs .reject                 ; second run: must end above the first run's first
.take:
    lda eFeet,y
    sta QUEUE
    lda #1
    sta QUEUE+1
    lda QUEUE+3
    bne .mark
    lda QUEUE+2
    cmp #$FF
    bne .mark
    lda eTop,y
    sta QUEUE+2
.mark:
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
    sta QUEUE+1
    lda #1
    sta QUEUE+3
.noWrap:
    dec temp+1
    bne .cand
.selDone:
    rts

;-------------------------------------------------------------------------------
; Schedule (VBLANK): the event queue for the enemies SelectEnemies took, one
; 8-byte record per enemy in row order. Each enemy's graphics are padded with
; only 40 zeros, so its pointer must be replaced within 40 rows of it: an
; event row comes at most 41 rows after the previous enemy's feet, and after
; the last enemy a park record points player 1 at zeros.
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
    sta temp                    ; the latest usable event row
    cpx #0
    beq .qRow                   ; the first enemy: no limit
    lda evPrevF
    clc
    adc #41
    cmp temp
    bcs .qRow
    sta temp                    ; at most 41 rows after the previous feet ...
    inc temp
.qDec:
    dec temp                    ; ... on a row the kernel allows ...
    lda eFeet,y
    sec
    sbc #51
    bcc .qBad
    cmp temp
    beq .qBad
    bcs .qSkip                  ; ... and at most 41 rows above its top
.qBad:
    sty temp+1
    ldy temp
    lda RowBad,y
    ldy temp+1
    cmp #0
    bne .qDec
.qRow:
    lda evPrevF
    clc
    adc #1
    cmp temp
    bcc .qOk
.qSkip:
    jmp .qNext                  ; needs event row > previous feet + 1
.qOk:
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
    sta QUEUE+6,x
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
    lda R_eState,y              ; color page for this kind of enemy; hurt (half
    and #$30                    ; or less), the other one (red <-> orange); a
    beq .plainCol               ; quarter or less, flickering between them
    and #$10
    beq .otherCol
    lda frame
    lsr
    bcc .plainCol
.otherCol:
    lda R_eType,y
    tay
    lda EnColHi,y
    eor #>ColArr ^ >ColOrange
    jmp .col
.plainCol:
    lda R_eType,y
    tay
    lda EnColHi,y
.col:
    sta QUEUE+5,x
    ldy temp+1
    lda R_eX,y                  ; walking frame: (x >> 2) & 1
    lsr
    lsr
    and #1
    sta QUEUE+7,x               ; (scratch until the next record links here)
    lda R_eType,y
    asl
    ora QUEUE+7,x
    sta QUEUE+7,x
    lda R_eType,y
    cmp #5                      ; a knight without its shield: the charge frame
    bne .frame
    lda R_eState,y
    and #$40
    beq .frame
    lda #20                     ; (index 20 of EBase: the charge frame)
    sta QUEUE+7,x
.frame:
    ldy QUEUE+7,x
    lda QUEUE+4,x
    clc
    adc EBaseLo,y
    sta QUEUE+2,x
    lda EBaseHi,y
    adc #0
    sta QUEUE+3,x
    lda #$FF
    sta QUEUE+7,x
    txa
    clc
    adc #8
    tax
    cpx #40
    bcs .park
.qNext:
    inc temp+3
    lda temp+3
    cmp #NENEMY
    beq .park
    jmp .q
.park:                          ; after the last enemy: point player 1 at zeros
    cpx #0
    beq .done
    lda evPrevF
    cmp #39
    bcs .done                   ; rows below it to the end: 40 at most
    clc
    adc #41
    cmp #78
    bcc .pRow
    lda #77
.pRow:
    sta temp
.pDec:
    ldy temp
    lda RowBad,y
    beq .pOk
    dec temp
    jmp .pDec
.pOk:
    lda #79
    sec
    sbc temp
    sta QUEUE-1,x
    lda VarLo
    sta QUEUE,x
    lda VarHi
    sta QUEUE+1,x
    lda #<Zeros
    sta QUEUE+2,x
    lda #>Zeros
    sta QUEUE+3,x
    lda #0
    sta QUEUE+4,x
    sta QUEUE+6,x
    lda #>ColArr
    sta QUEUE+5,x
    lda #$FF
    sta QUEUE+7,x
.done:
    rts

    include "gen/bank0.inc"

;-------------------------------------------------------------------------------
; F6 hotspots: an access to $FFF6/$FFF7/$FFF8/$FFF9 selects bank 0/1/2/3.
; A switch takes effect on the next fetch, at the same address in the new bank.
; Calls into bank 2: bank 0 switches, bank 2 (at the next address) does the
; JSR and switches back, and bank 0 returns.
    ORG $0FB0
    RORG $FFB0
CallSound:
    lda $FFF9                   ; bank 3 runs $FFB3-$FFB8: jsr Sound, lda $FFF6
    ds 6, $EA
    rts                         ; $FFB9
    ORG $0FC0
    RORG $FFC0
CallInit:
    lda $FFF8                   ; bank 2 runs $FFC3-$FFC8: jsr LogicInit, lda $FFF6
    ds 6, $EA
    rts                         ; $FFC9
    ORG $0FD0
    RORG $FFD0
CallLogic:
    lda $FFF8                   ; bank 2 runs $FFD3-$FFD8: jsr Logic, lda $FFF6
    ds 6, $EA
    rts                         ; $FFD9

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
    sta HMOVE                   ; 0-2: here, so its 8-pixel black comb falls on
    lda #COL_BG                 ; a black line, not the rule; the panel ends
    sta COLUBK
    sta WSYNC                   ; s30: rule
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2                     ; by cycle 15
    lda pfColor
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
; the kernel rows (a branch that crosses a page costs a cycle; every branch
; here is taken only where the line has cycles to spare)

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
; BANKS 2 and 3: game logic (logic.asm); sound steps and music (sound.asm)
;===============================================================================
    SEG bank2
    ORG $2000
    RORG $F000
    ds 256, 0                   ; Super Chip RAM window
    include "logic.asm"
    include "gen/bank2.inc"

    ORG $2FC3
    RORG $FFC3
    jsr LogicInit
    lda $FFF6                   ; back to bank 0, which returns at $FFC9
    ORG $2FD3
    RORG $FFD3
    jsr Logic
    lda $FFF6                   ; back to bank 0, which returns at $FFD9
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
    include "sound.asm"

    ORG $3FB3
    RORG $FFB3
    jsr Sound
    lda $FFF6                   ; back to bank 0, which returns at $FFB9
    ORG $3FF0
    RORG $FFF0
Reset3:
    lda $FFF6
    ORG $3FFA
    RORG $FFFA
    .word Reset3, Reset3, Reset3
