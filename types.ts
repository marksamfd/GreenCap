

export interface Caption {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TextStyleOptions {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    textColor: string;
    lineHeight: number;
    typewriterSound: boolean;
}

export interface BoxStyleOptions {
    backgroundColor: string;
    backgroundOpacity: number;
    padding: number;
    verticalMargin: number;
    horizontalMargin: number;
    border: {
        width: number;
        color: string;
        radius: number;
    }
}

export type AnimationStyle = 'none' | 'fade' | 'slide' | 'pop' | 'typewriter' | 'glow';

export interface CustomizationOptions {
  textStyle: TextStyleOptions;
  boxStyle: BoxStyleOptions;
  animationStyle: AnimationStyle;
}

export interface Preset {
    name: string;
    options: CustomizationOptions;
}

export interface ExportOptions {
    resolution: string;
    frameRate: number;
    format: string;
    captionFormat: 'srt' | 'vtt';
    includeAudio: boolean;
    greenScreen: boolean;
    embedOnOriginal: boolean;
    applySilenceSkip: boolean;
    silenceThreshold: number;
}

export enum ProcessingState {
  IDLE,
  TRANSCRIBING,
  TRANSCRIPTION_DONE,
  GENERATING,
  GENERATE_DONE,
  ERROR,
}

export type AppMode = 'HOME' | 'SINGLE_VIDEO' | 'BATCH' | 'LIVE' | 'SILENCE_SKIP';