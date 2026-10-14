// Original soundtrack for Forest of Dread, written for this project in a C64/SID style.
// It is NOT a transcription of the 1983 Forbidden Forest score.
//
// D minor with a harmonic-minor A major for tension. Three voices like the SID chip:
// a filtered pulse bass, a fast chord-arpeggio voice and a detuned pulse lead with
// delayed vibrato, plus a noise channel for percussion.
// Lead tokens are eighth notes: a note name, '-' to hold, '.' for rest.

export const CHORDS = {
  Dm: ['D', 'F', 'A'],
  Bb: ['Bb', 'D', 'F'],
  A: ['A', 'C#', 'E'],
  Gm: ['G', 'Bb', 'D'],
  F: ['F', 'A', 'C'],
  C: ['C', 'E', 'G'],
  Eb: ['Eb', 'G', 'Bb'],
};

// R = root, O = octave, F = fifth, . = rest (one token per sixteenth)
export const BASS = 'R . R . O . R . F . R . O . F R'.split(' ');

export const SONG = {
  bpm: 108,
  sections: {
    intro: {
      chords: ['Dm', 'Dm', 'Bb', 'A'],
      lead: null,
    },
    A: {
      chords: ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Gm', 'A', 'A'],
      lead: [
        'D5 - - - A4 - - -',
        'F5 - E5 D5 E5 - - -',
        'D5 - - - F5 - D5 -',
        'C#5 - - - - - . .',
        'A4 - D5 - F5 - A5 -',
        'G5 - F5 E5 D5 - Bb4 -',
        'A4 - C#5 - E5 - G5 -',
        'F5 - E5 - C#5 - . .',
      ],
    },
    B: {
      chords: ['F', 'C', 'Dm', 'A', 'Bb', 'Gm', 'A', 'Dm'],
      lead: [
        'A5 - - - G5 F5 - -',
        'G5 - - - E5 C5 - -',
        'F5 - E5 - D5 - A4 -',
        'C#5 - - - E5 - - -',
        'D5 - F5 - Bb5 - A5 -',
        'G5 - - - D5 - Bb4 -',
        'A4 - - - C#5 - E5 -',
        'D5 - - - . . . .',
      ],
    },
    // Darker bridge, used from the second loop onwards
    C: {
      chords: ['Eb', 'Dm', 'Eb', 'A'],
      lead: [
        'G5 - - - - - Eb5 -',
        'F5 - - - D5 - - -',
        'Bb4 - Eb5 - G5 - Bb5 -',
        'A5 - - - - - . .',
      ],
    },
  },
  order: ['intro', 'A', 'A', 'B', 'A', 'C', 'B'],
  loopTo: 1,
};

// Short one-shot tunes: [note or null, length in steps]
export const JINGLES = {
  start: {
    step: 0.085, wave: 'pulse25',
    notes: [['D4', 1], ['F4', 1], ['A4', 1], ['D5', 1], ['F5', 1], ['A5', 1], ['D6', 8]],
  },
  clear: {
    step: 0.12, wave: 'pulse25',
    notes: [['A4', 1], ['C#5', 1], ['E5', 1], ['G5', 1], ['F#5', 2], ['A5', 2], ['D6', 8]],
  },
  death: {
    step: 0.13, wave: 'saw',
    notes: [['E5', 1], ['D#5', 1], ['D5', 1], ['C#5', 1], ['C5', 1], ['B4', 1], ['Bb4', 2], ['A4', 8]],
  },
  gameover: {
    step: 0.28, wave: 'pulse50',
    notes: [['D5', 2], ['C5', 1], ['Bb4', 1], ['A4', 2], ['G4', 1], ['F4', 1], ['E4', 2], ['D4', 8]],
  },
};
