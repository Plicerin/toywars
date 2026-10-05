; Toy Wars, bank 3: sound steps and music, called from VBLANK (CallSound).
; They read and write RAM and their own tables only; SndPlay (bank 2) starts
; a sound through SndStart, offsets into SndData here.

;-------------------------------------------------------------------------------
; Sound (VBLANK, after the frame counter steps): after an even frame (the
; shots) the sound effects' next steps, which are two frames long; after an
; odd frame (the toys) the music. Here, not in the overscan, to keep the
; game logic's frames short.
Sound:
    SUBROUTINE
    lda frame
    lsr
    bcc .music
    jmp SndUpdate
.music:
    jmp Music

;-------------------------------------------------------------------------------
; Music (every other frame): an 8-bar toy march, eighth notes of 12 frames. Before a
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
SndUpdate:                      ; every other frame: next step when a step's time is up
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
