

import { Caption, CustomizationOptions, ExportOptions } from './types';

export const FONTS = [
  { name: 'Cairo', value: 'Cairo, sans-serif' },
  { name: 'Tajawal', value: 'Tajawal, sans-serif' },
  { name: 'El Messiri', value: '"El Messiri", sans-serif' },
  { name: 'Amiri', value: 'Amiri, serif' },
  { name: 'Noto Sans Arabic', value: '"Noto Sans Arabic", sans-serif' },
  { name: 'Lateef', value: 'Lateef, serif' },
  { name: 'Markazi Text', value: '"Markazi Text", serif' },
  { name: '--- English ---', value: '', disabled: true },
  { name: 'Roboto', value: 'Roboto, sans-serif' },
  { name: 'Montserrat', value: 'Montserrat, sans-serif' },
  { name: 'Poppins', value: 'Poppins, sans-serif' },
  { name: 'Oswald', value: 'Oswald, sans-serif' },
  { name: 'Playfair Display', value: '"Playfair Display", serif' },
  { name: 'Arial', value: 'Arial, sans-serif' },
];

export const INITIAL_CUSTOMIZATION_OPTIONS: CustomizationOptions = {
    textStyle: {
        fontFamily: 'Cairo, sans-serif',
        fontSize: 51,
        fontWeight: '700', // bold
        textColor: '#FFFFFF',
        lineHeight: 1.5,
        typewriterSound: false,
    },
    boxStyle: {
        backgroundColor: '#000000',
        backgroundOpacity: 0.6,
        padding: 10, // Represents a relative value
        verticalMargin: 85, // 85% from top
        horizontalMargin: 0, // 0% offset from center
        border: {
            width: 2,
            color: '#FFFFFF',
            radius: 20,
        }
    },
    animationStyle: 'none',
};

export const INITIAL_EXPORT_OPTIONS: ExportOptions = {
    resolution: 'original',
    frameRate: 30,
    format: 'video/mp4',
    captionFormat: 'srt',
    includeAudio: true,
    greenScreen: true,
    embedOnOriginal: false,
    applySilenceSkip: false,
    silenceThreshold: -20,
};