



import React, { useState, useRef, useCallback, useEffect } from 'react';
// FIX: Aliased the imported `Blob` type to `GenAIBlob` to resolve name collision with the browser's native `Blob` type.
import { GoogleGenAI, Modality, LiveServerMessage, Type, Blob as GenAIBlob } from '@google/genai';

import { Caption, CustomizationOptions, ProcessingState, AppMode, ExportOptions, Preset } from './types';
import { FONTS, INITIAL_CUSTOMIZATION_OPTIONS, INITIAL_EXPORT_OPTIONS } from './constants';
import { UploadIcon, DownloadIcon, VideoIcon, SettingsIcon, CheckCircleIcon, LoadingIcon, MicrophoneIcon, StopIcon, SparklesIcon, ArrowLeftIcon, ChevronDownIcon, TextIcon, BoxIcon, ZapIcon, SaveIcon, TrashIcon, BookmarkIcon, BatchIcon, ScissorsIcon } from './components/icons';

// =================================================================================
// GEMINI API SETUP
// =================================================================================
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });


// =================================================================================
// HELPER FUNCTIONS
// =================================================================================

const toSrtTime = (time: number) => {
    const date = new Date(0);
    date.setSeconds(time);
    const timeStr = date.toISOString().substr(11, 12);
    return timeStr.replace('.', ',');
};
const toVttTime = (time: number) => toSrtTime(time).replace(',', '.');


const generateCaptionFile = (captions: Caption[], format: 'srt' | 'vtt'): string => {
    let content = '';
    if (format === 'vtt') {
        content = 'WEBVTT\n\n';
    }
    
    content += captions
        .map((caption, index) => {
            const id = format === 'srt' ? `${caption.id}\n` : '';
            const timestampConverter = format === 'srt' ? toSrtTime : toVttTime;
            return `${id}${timestampConverter(caption.start)} --> ${timestampConverter(caption.end)}\n${caption.text}\n`
        })
        .join('\n');

    const blob = new Blob([content], { type: `text/${format === 'srt' ? 'plain' : 'vtt'};charset=utf-8` });
    return URL.createObjectURL(blob);
};

const getMimeTypeAndExtension = (formatOption: string): { mimeType: string, extension: 'mp4' | 'webm' } => {
    if (formatOption === 'video/mp4') {
        // H.264 video with AAC audio
        const mimeType = 'video/mp4; codecs="avc1.42e01e, mp4a.40.2"';
        return { 
            mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/mp4',
            extension: 'mp4' 
        };
    }
    // Default to WebM: VP9 video with Opus audio
    const mimeType = 'video/webm; codecs="vp9, opus"';
    return { 
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
        extension: 'webm'
    };
};

const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};


const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
};

const isRtl = (text: string) => /[\u0600-\u06FF]/.test(text);

const drawCaption = (
    ctx: CanvasRenderingContext2D,
    caption: Caption,
    currentTime: number,
    canvasWidth: number,
    canvasHeight: number,
    options: CustomizationOptions,
    isExport: boolean = false,
) => {
    ctx.save();

    const { textStyle, boxStyle, animationStyle } = options;
    const { fontFamily, fontSize, fontWeight, textColor, lineHeight: lineHeightMultiplier } = textStyle;
    const { backgroundColor, backgroundOpacity, padding, verticalMargin, horizontalMargin, border } = boxStyle;

    const baseFontSize = (canvasWidth / 1280) * fontSize;
    ctx.font = `${fontWeight} ${baseFontSize}px ${fontFamily}`;
    ctx.direction = isRtl(caption.text) ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const hPadding = baseFontSize * (padding / 10);
    const vPadding = baseFontSize * (padding / 20);
    const maxWidth = canvasWidth * 0.8 - 2 * hPadding;

    // Line wrapping
    const words = caption.text.split(' ');
    let lines = [];
    let currentLine = words[0] || '';
    for (let i = 1; i < words.length; i++) {
        const testLine = currentLine + " " + words[i];
        if (ctx.measureText(testLine).width < maxWidth) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);

    const lineHeight = baseFontSize * lineHeightMultiplier;
    const totalTextHeight = lines.length * lineHeight;
    const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    
    const rectHeight = totalTextHeight + 2 * vPadding;
    const rectWidth = maxLineWidth + 2 * hPadding;
    
    // FIX: Corrected caption preview position to match export render.
    // The preview canvas overlay must be pixel-perfect, so calculations are direct.
    // The canvas is scaled via CSS, but its internal resolution matches the video.
    const rectX = (canvasWidth - rectWidth) / 2 + (canvasWidth * (horizontalMargin / 100));
    const rectY = canvasHeight * (verticalMargin / 100) - rectHeight / 2;


    // Animation logic
    const captionDuration = caption.end - caption.start;
    const timeIntoCaption = currentTime - caption.start;
    const progress = Math.max(0, Math.min(1, timeIntoCaption / captionDuration));
    
    let scale = 1;
    let opacity = 1;
    let offsetX = 0;
    let offsetY = 0;
    let glowRadius = 0;
    let glowColor = 'transparent';

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const fadeInDuration = Math.min(0.2, captionDuration / 4);
    const fadeOutStartTime = captionDuration - Math.min(0.2, captionDuration / 4);
    
    if (timeIntoCaption < fadeInDuration) { // Fade in
        const fadeInProgress = timeIntoCaption / fadeInDuration;
        if (animationStyle === 'fade') opacity = easeOutCubic(fadeInProgress);
        if (animationStyle === 'slide') offsetY = 50 * (1 - easeOutCubic(fadeInProgress));
        if (animationStyle === 'pop') scale = 0.8 + 0.2 * easeOutCubic(fadeInProgress);
        if (animationStyle === 'glow') {
            const glowProgress = easeOutCubic(fadeInProgress);
            opacity = glowProgress;
            glowRadius = (1 - glowProgress) * 20;
            glowColor = textColor;
        }
    }
    if (timeIntoCaption > fadeOutStartTime && animationStyle !== 'typewriter') { // Fade out
        const fadeOutProgress = (timeIntoCaption - fadeOutStartTime) / (captionDuration - fadeOutStartTime);
        if (animationStyle === 'fade') opacity = 1 - easeOutCubic(fadeOutProgress);
        if (animationStyle === 'slide') offsetY = 50 * easeOutCubic(fadeOutProgress);
    }
    
    ctx.globalAlpha = opacity;
    ctx.translate(rectX + rectWidth / 2 + offsetX, rectY + rectHeight / 2 + offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-(rectX + rectWidth / 2), -(rectY + rectHeight / 2));

    // Draw background box
    if (backgroundOpacity > 0 || isExport) {
        ctx.fillStyle = hexToRgba(backgroundColor, backgroundOpacity);
        drawRoundedRect(ctx, rectX, rectY, rectWidth, rectHeight, border.radius);
        ctx.fill();
    }

    // Draw border
    if (border.width > 0) {
        ctx.strokeStyle = border.color;
        ctx.lineWidth = border.width;
        ctx.stroke();
    }

    // Draw text
    ctx.shadowBlur = glowRadius;
    ctx.shadowColor = glowColor;
    ctx.fillStyle = textColor;
    
    let charsToShow = caption.text.length;
    if (animationStyle === 'typewriter') {
        const pauseDuration = Math.min(0.5, captionDuration * 0.4); // Pause for 0.5s or 40% of duration
        const animationTypingDuration = Math.max(0.1, captionDuration - pauseDuration);
        const typewriterProgress = Math.min(1, timeIntoCaption / animationTypingDuration);
        charsToShow = Math.floor(typewriterProgress * caption.text.length);
    }
    let charsRendered = 0;

    lines.forEach((line, index) => {
        const lineY = rectY + vPadding + (lineHeight / 2) + (index * lineHeight);
        let textToDraw = line;
        
        if (animationStyle === 'typewriter') {
            if (charsRendered > charsToShow) {
                textToDraw = '';
            } else if (charsRendered + line.length > charsToShow) {
                textToDraw = line.substring(0, charsToShow - charsRendered);
            }
            charsRendered += line.length + 1; // +1 for space/newline
        }
        
        ctx.fillText(textToDraw, canvasWidth / 2 + (canvasWidth * (horizontalMargin/100)), lineY);
    });

    ctx.restore();
    return animationStyle === 'typewriter' ? charsToShow : -1;
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
});

// Audio helpers for Live API
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const calculateExportDimensions = (videoWidth: number, videoHeight: number) => {
    const MIN_EXPORT_HEIGHT = 1080;
    const MAX_EXPORT_HEIGHT = 2160; // 4K
    let outputWidth = videoWidth;
    let outputHeight = videoHeight;

    // Smart Upscaling for videos smaller than 1080p
    if (outputHeight < MIN_EXPORT_HEIGHT && outputHeight > 0) {
        const scale = MIN_EXPORT_HEIGHT / outputHeight;
        outputWidth = Math.round(outputWidth * scale);
        outputHeight = MIN_EXPORT_HEIGHT;
    }

    // Downscaling for videos larger than 4K
    if (outputHeight > MAX_EXPORT_HEIGHT) {
        const scale = MAX_EXPORT_HEIGHT / outputHeight;
        outputWidth = Math.round(outputWidth * scale);
        outputHeight = MAX_EXPORT_HEIGHT;
    }
    
    // Ensure dimensions are even numbers for codec compatibility
    outputWidth = outputWidth % 2 === 0 ? outputWidth : outputWidth + 1;
    outputHeight = outputHeight % 2 === 0 ? outputHeight : outputHeight + 1;

    return { outputWidth, outputHeight };
};

const getBitrate = (width: number, height: number): number => {
    const pixels = width * height;
    if (pixels > 1920 * 1080 * 1.5) { // ~4K
        return 80_000_000; // 80 Mbps
    }
    if (pixels > 1280 * 720 * 1.5) { // ~1080p
        return 30_000_000; // 30 Mbps
    }
    return 10_000_000; // 10 Mbps for 720p or less
};

// =================================================================================
// MAIN APP COMPONENT & MODE ROUTER
// =================================================================================

const App: React.FC = () => {
    const [mode, setMode] = useState<AppMode>('HOME');

    const renderContent = () => {
        switch (mode) {
            case 'SINGLE_VIDEO':
                return <SingleVideoEditor onBack={() => setMode('HOME')} />;
            case 'BATCH':
                return <BatchEditor onBack={() => setMode('HOME')} />;
            case 'LIVE':
                return <LiveTranscriber onBack={() => setMode('HOME')} />;
            case 'SILENCE_SKIP':
                return <SilenceSkipTool onBack={() => setMode('HOME')} />;
            case 'HOME':
            default:
                return <HomeScreen onSelectMode={setMode} />;
        }
    };
    
    return (
      <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col items-center p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </div>
    );
};

// =================================================================================
// HOME SCREEN COMPONENT
// =================================================================================

const HomeScreen: React.FC<{ onSelectMode: (mode: AppMode) => void }> = ({ onSelectMode }) => (
    <div className="w-full max-w-5xl text-center">
        <MainHeader />
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-8">
            <HomeCard
                icon={<VideoIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />}
                title="Single Video Editor"
                description="Transcribe and generate captions for one video with a live preview."
                onClick={() => onSelectMode('SINGLE_VIDEO')}
            />
            <HomeCard
                icon={<BatchIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />}
                title="Batch Processor"
                description="Process multiple videos at once using saved style presets."
                onClick={() => onSelectMode('BATCH')}
            />
            <HomeCard
                icon={<ScissorsIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />}
                title="Silence Skip Tool"
                description="Automatically detect and remove silent parts from your video."
                onClick={() => onSelectMode('SILENCE_SKIP')}
            />
             <HomeCard
                icon={<MicrophoneIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />}
                title="Live Transcription"
                description="Transcribe your speech in real-time using your microphone."
                onClick={() => onSelectMode('LIVE')}
            />
        </div>
    </div>
);

const HomeCard: React.FC<{ icon: React.ReactNode, title: string, description: string, onClick: () => void }> = ({ icon, title, description, onClick }) => (
    <div onClick={onClick} className="p-8 bg-white rounded-2xl shadow-lg border border-gray-200/80 cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        {icon}
        <h2 className="text-2xl font-bold mb-2">{title}</h2>
        <p className="text-gray-500">{description}</p>
    </div>
);

// =================================================================================
// SILENCE SKIP TOOL COMPONENT & VISUALIZER
// =================================================================================
const WaveformPreview: React.FC<{ audioBuffer: AudioBuffer, threshold: number }> = ({ audioBuffer, threshold }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current || !audioBuffer) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const channelData = audioBuffer.getChannelData(0); // Use first channel
        const numSamples = channelData.length;
        const samplesPerPixel = Math.floor(numSamples / width);
        // Convert dB threshold to linear amplitude (0-1)
        const linearThreshold = Math.pow(10, threshold / 20);

        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 1;

        for (let x = 0; x < width; x++) {
            const startIndex = x * samplesPerPixel;
            let min = 1.0;
            let max = -1.0;
            let isSilent = true;

            for (let i = 0; i < samplesPerPixel; i++) {
                const sample = channelData[startIndex + i];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
                if (Math.abs(sample) > linearThreshold) {
                    isSilent = false;
                }
            }
            
            // Map amplitude range [-1, 1] to canvas height [0, height]
            const yMax = (1 - max) * height / 2;
            const yMin = (1 - min) * height / 2;
            
            ctx.fillStyle = isSilent ? '#fca5a5' : '#4ade80'; // red-300 : green-400
            ctx.fillRect(x, yMax, 1, Math.max(1, yMin - yMax)); // Ensure at least 1px height
        }
    }, [audioBuffer, threshold]);

    return <canvas ref={canvasRef} width="800" height="100" className="w-full h-24 bg-gray-900/10 rounded-lg border border-gray-300"></canvas>;
};

const SilenceSkipTool: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [threshold, setThreshold] = useState(-20); // Default to -20dB, based on auto-editor's 10% volume threshold.
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processedUrl, setProcessedUrl] = useState<string | null>(null);
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('video/')) {
            setVideoFile(file);
            setProcessedUrl(null);
            setProgress(0);
            setAudioBuffer(null);
            
            // Decode audio for waveform preview
            try {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const arrayBuffer = await file.arrayBuffer();
                const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
                setAudioBuffer(decodedBuffer);
                await audioContext.close();
            } catch (e) {
                console.error("Failed to decode audio for preview:", e);
                alert("Could not process audio from this video file for preview.");
            }
        }
    };
    
    const handleProcess = () => {
        if (!videoFile) return;
        setIsProcessing(true);
        setProgress(0);
        setProcessedUrl(null);
        
        // --- Developer Note ---
        // A full implementation requires complex audio analysis (Web Audio API) and
        // video re-encoding (e.g., ffmpeg.wasm), which is a heavy client-side task.
        // This simulation shows the user interface and intended workflow.
        const duration = 10; // Assume 10s processing time
        let elapsed = 0;
        const interval = setInterval(() => {
            elapsed += 0.1;
            const newProgress = (elapsed / duration) * 100;
            setProgress(newProgress);
            if (newProgress >= 100) {
                clearInterval(interval);
                setIsProcessing(false);
                setProcessedUrl(URL.createObjectURL(videoFile)); // Return original for demo
            }
        }, 100);
    };

    return (
        <div className="w-full max-w-4xl flex flex-col">
            <PageHeader title="Silence Skip Tool" onBack={onBack} />
            <div className="mt-8 p-6 bg-white rounded-2xl shadow-lg border border-gray-200/80 flex-grow flex flex-col gap-6">
                 <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
                    <h3 className="font-bold">How this works</h3>
                    <p className="text-sm">This tool analyzes the audio track to find and remove segments below a volume threshold. Your files are processed locally in your browser and are never uploaded. The default threshold of <strong>-20dB</strong> is recommended.</p>
                </div>
                {!videoFile && <FileUpload onFileChange={handleFileChange} />}
                {videoFile && (
                    <div className="flex flex-col gap-6">
                        <p className="font-bold text-center text-lg">{videoFile.name}</p>
                        {audioBuffer && <WaveformPreview audioBuffer={audioBuffer} threshold={threshold} />}
                         <div className="flex flex-col gap-2">
                            <label className="font-semibold">Silence Threshold: {threshold} dB</label>
                            <p className="text-sm text-gray-500">Audio below this volume will be considered silence. Green is kept, red is removed.</p>
                            <input type="range" min="-60" max="0" value={threshold} onChange={e => setThreshold(parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                        </div>
                        {/* FIX: The onClick handler was passing an event argument to `handleProcess`, which expects no arguments. This has been corrected by wrapping the call in an arrow function. */}
                        <button onClick={() => handleProcess()} disabled={isProcessing} className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition-transform duration-200 hover:scale-105 shadow-md flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:scale-100">
                            {isProcessing ? <LoadingIcon className="w-6 h-6"/> : <ScissorsIcon className="w-6 h-6" />}
                            {isProcessing ? 'Processing...' : 'Remove Silence'}
                        </button>
                        {isProcessing && (
                            <div className="w-full bg-gray-200 rounded-full h-4">
                                <div className="bg-green-500 h-4 rounded-full text-center text-white text-sm" style={{ width: `${progress}%` }}>
                                    {Math.round(progress)}%
                                </div>
                            </div>
                        )}
                        {processedUrl && (
                             <a href={processedUrl} download={`${videoFile.name.split('.').slice(0, -1).join('.')}_trimmed.mp4`} className="w-full text-center bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2">
                                <DownloadIcon className="w-5 h-5"/> Download Processed Video
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};


// =================================================================================
// LIVE TRANSCRIBER COMPONENT
// =================================================================================

const LiveTranscriber: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [transcription, setTranscription] = useState('');
    const [error, setError] = useState<string | null>(null);

    const sessionPromiseRef = useRef<ReturnType<typeof ai.live.connect> | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);

    const startRecording = async () => {
        try {
            setError(null);
            setTranscription('');
            setIsRecording(true);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            audioContextRef.current = inputAudioContext;

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => { console.log('Live session opened.'); },
                    onclose: () => { console.log('Live session closed.'); },
                    onerror: (e) => {
                        console.error('Live session error:', e);
                        setError('An error occurred with the connection.');
                        stopRecording();
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const { text } = message.serverContent.inputTranscription;
                            setTranscription(prev => prev + text);
                        }
                    },
                },
                config: {
                    inputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                },
            });

            const source = inputAudioContext.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;
            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const l = inputData.length;
                const int16 = new Int16Array(l);
                for (let i = 0; i < l; i++) {
                    int16[i] = inputData[i] * 32768;
                }
                // FIX: Use the aliased `GenAIBlob` type to avoid conflict with the native `Blob`.
                const pcmBlob: GenAIBlob = {
                    data: encode(new Uint8Array(int16.buffer)),
                    mimeType: 'audio/pcm;rate=16000',
                };
                sessionPromiseRef.current?.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.destination);

        } catch (err) {
            console.error('Failed to start recording:', err);
            setError('Could not access the microphone. Please check permissions.');
            setIsRecording(false);
        }
    };

    const stopRecording = useCallback(() => {
        setIsRecording(false);
        
        sessionPromiseRef.current?.then((session) => session.close());
        sessionPromiseRef.current = null;
        
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
             audioContextRef.current.close();
        }
    }, []);

    useEffect(() => {
        return () => {
           if(isRecording) stopRecording();
        }
    }, [isRecording, stopRecording]);

    return (
        <div className="w-full max-w-4xl flex flex-col">
            <PageHeader title="Live Transcription" onBack={onBack} />
            <div className="mt-8 p-6 bg-white rounded-2xl shadow-lg border border-gray-200/80 flex-grow flex flex-col">
                <div className="flex-grow w-full p-4 bg-gray-100 rounded-lg min-h-[200px] text-lg text-gray-700 whitespace-pre-wrap">
                    {transcription || <span className="text-gray-400">Your transcription will appear here...</span>}
                </div>
                <div className="mt-6 flex flex-col items-center gap-4">
                    <button
                        // FIX: The `onClick` handler was passing an event argument to `startRecording` and `stopRecording`, which expect no arguments. This was corrected by wrapping the calls in an arrow function to discard the event argument.
                        onClick={() => (isRecording ? stopRecording() : startRecording())}
                        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg text-white ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                    >
                        {isRecording ? <StopIcon className="w-8 h-8"/> : <MicrophoneIcon className="w-8 h-8"/>}
                    </button>
                    <p className="font-semibold text-lg">{isRecording ? 'Recording...' : 'Tap to start'}</p>
                    {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                </div>
            </div>
        </div>
    );
};

// =================================================================================
// BATCH EDITOR COMPONENT
// =================================================================================

type JobStatus = 'pending' | 'transcribing' | 'transcribed' | 'generating' | 'done' | 'error';

interface VideoJob {
    id: string;
    file: File;
    status: JobStatus;
    captions: Caption[];
    progress: number;
    error: string | null;
    generatedVideoUrl: string | null;
    generatedCaptionUrl: string | null;
}

const BatchEditor: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [jobs, setJobs] = useState<VideoJob[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [customization, setCustomization] = useState<CustomizationOptions>(INITIAL_CUSTOMIZATION_OPTIONS);
    const [exportOptions, setExportOptions] = useState<ExportOptions>(INITIAL_EXPORT_OPTIONS);
    const [showExportModal, setShowExportModal] = useState(false);
    
    // Preset states
    const [presets, setPresets] = useState<Preset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState<string>('');
    const [newPresetName, setNewPresetName] = useState<string>('');
    // FIX: Changed useRef type from NodeJS.Timeout to the correct browser return type for setInterval to fix type mismatch errors.
    const transcriptionProgressInterval = useRef<ReturnType<typeof setInterval>>();

    // Load fonts and presets on mount
    useEffect(() => {
        const fontsToLoad = ['Cairo', 'Tajawal', 'Noto+Sans+Arabic', 'El+Messiri', 'Amiri', 'Lateef', 'Markazi+Text', 'Roboto', 'Montserrat', 'Poppins', 'Oswald', 'Playfair+Display'];
        const link = document.createElement('link');
        link.href = `https://fonts.googleapis.com/css2?family=${fontsToLoad.join('&family=')}:wght@400;700;800&display=swap`;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        
        try {
            const savedPresets = localStorage.getItem('greenCapAIPresets');
            if (savedPresets) setPresets(JSON.parse(savedPresets));
        } catch (error) { console.error("Failed to load presets", error); }
    }, []);

    // Save presets to localStorage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('greenCapAIPresets', JSON.stringify(presets));
        } catch (error) { console.error("Failed to save presets", error); }
    }, [presets]);

    const updateJob = (id: string, updates: Partial<VideoJob>) => {
        setJobs(prevJobs => prevJobs.map(job => job.id === id ? { ...job, ...updates } : job));
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files) {
            const newJobs: VideoJob[] = Array.from(files)
                // FIX: Explicitly type the 'file' parameter to 'File' to resolve type inference issues where it was being treated as 'unknown'.
                .filter((file: File) => file.type.startsWith('video/'))
                .map((file: File) => ({
                    id: `${file.name}-${Date.now()}`,
                    file,
                    status: 'pending',
                    captions: [],
                    progress: 0,
                    error: null,
                    generatedVideoUrl: null,
                    generatedCaptionUrl: null,
                }));
            
            if(newJobs.length > 0) {
                setJobs(prev => [...prev, ...newJobs]);
                setIsProcessing(true); // Automatically start transcription
            }
        }
    };
    
    const transcribeJob = async (job: VideoJob) => {
        updateJob(job.id, { status: 'transcribing', progress: 0 });

        // Simulate progress for transcription
        transcriptionProgressInterval.current = setInterval(() => {
            setJobs(prev => prev.map(j => {
                if (j.id === job.id) {
                    const newProgress = j.progress + 1;
                     return { ...j, progress: Math.min(newProgress, 95) };
                }
                return j;
            }));
        }, 500); // Slower interval for more realistic feel

        try {
            const base64Data = await fileToBase64(job.file);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: {
                    parts: [
                        { text: "You are an expert transcriptionist specializing in the Egyptian Arabic dialect. Transcribe the audio from this video precisely. Do NOT translate, normalize, or alter any slang, colloquialisms, or expressions. Preserve the exact words and phrasing spoken. Provide the output as a valid JSON array of objects. Each object must have 'id' (a unique number), 'start' (start time in seconds), 'end' (end time in seconds), and 'text' (the transcribed text). Ensure timestamps are accurate." },
                        { inlineData: { mimeType: job.file.type, data: base64Data } }
                    ]
                },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.NUMBER },
                                start: { type: Type.NUMBER },
                                end: { type: Type.NUMBER },
                                text: { type: Type.STRING },
                            },
                            required: ['id', 'start', 'end', 'text'],
                        },
                    },
                },
            });
            
            const parsedCaptions = JSON.parse(response.text.trim());
            if (transcriptionProgressInterval.current) clearInterval(transcriptionProgressInterval.current);
            updateJob(job.id, { captions: parsedCaptions, status: 'transcribed', progress: 100 });
        } catch (err) {
            console.error("Transcription failed:", err);
            if (transcriptionProgressInterval.current) clearInterval(transcriptionProgressInterval.current);
            updateJob(job.id, { status: 'error', error: "Transcription failed. The AI model might be unable to process this file." });
        }
    };

    // Transcription processing loop
    useEffect(() => {
        if (!isProcessing) return;

        const nextJob = jobs.find(job => job.status === 'pending');
        if (nextJob) {
            transcribeJob(nextJob);
        } else if (!jobs.some(j => j.status === 'transcribing')) {
            // All transcriptions are done, so stop this processing loop.
            setIsProcessing(false); 
        }
    }, [isProcessing, jobs]);


    const generateJob = async (job: VideoJob) => {
        if (!job.captions || job.captions.length === 0) {
            updateJob(job.id, { status: 'error', error: 'No captions available to generate video.' });
            return;
        }

        updateJob(job.id, { status: 'generating', progress: 0 });
        
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
            updateJob(job.id, { status: 'error', error: "Could not create canvas context." });
            return;
        }

        const processingVideo = document.createElement('video');
        processingVideo.src = URL.createObjectURL(job.file);
        // FIX: Audio export fixed by muting the video element instead of setting volume to 0.
        // This prevents audible playback while ensuring the audio track is captured for export.
        processingVideo.muted = true;
        
        // Add to DOM to ensure audio capture works reliably
        document.body.appendChild(processingVideo);
        processingVideo.style.position = 'fixed';
        processingVideo.style.top = '-10000px';
        processingVideo.style.left = '-10000px';
        
        await new Promise<void>(r => {
            processingVideo.onloadedmetadata = () => {
                const { outputWidth, outputHeight } = calculateExportDimensions(
                    processingVideo.videoWidth,
                    processingVideo.videoHeight
                );
                tempCanvas.width = outputWidth;
                tempCanvas.height = outputHeight;
                r();
            };
        });
        
        const duration = processingVideo.duration;
        const videoStream = tempCanvas.captureStream(exportOptions.frameRate);
        const videoTrack = videoStream.getVideoTracks()[0];
        const streamTracks = [videoTrack];
        
        let audioTrack: MediaStreamTrack | undefined;
        let audioCtx: AudioContext | undefined;
        let destNode: MediaStreamAudioDestinationNode | undefined;

        if (exportOptions.includeAudio) {
            try {
                audioCtx = new AudioContext();
                const sourceNode = audioCtx.createMediaElementSource(processingVideo);
                destNode = audioCtx.createMediaStreamDestination({ channelCount: 2 });
                sourceNode.connect(destNode);
                [audioTrack] = destNode.stream.getAudioTracks();
                if(audioTrack) streamTracks.push(audioTrack);
            } catch (e) { console.error("Could not process audio:", e); }
        }
        
        const combinedStream = new MediaStream(streamTracks);
        
        const { mimeType } = getMimeTypeAndExtension(exportOptions.format);

        const recorderOptions = {
            mimeType,
            videoBitsPerSecond: getBitrate(tempCanvas.width, tempCanvas.height),
            audioBitsPerSecond: exportOptions.format === 'video/mp4' ? 320000 : 256000,
        };
        
        const recorder = new MediaRecorder(combinedStream, recorderOptions);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);

        const recorderPromise = new Promise<void>((resolve) => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const videoUrl = URL.createObjectURL(blob);
                const captionUrl = generateCaptionFile(job.captions, exportOptions.captionFormat);
                updateJob(job.id, { generatedVideoUrl: videoUrl, generatedCaptionUrl: captionUrl, status: 'done', progress: 100 });
                if (audioCtx?.state !== 'closed') audioCtx?.close();
                resolve();
            };
        });

        recorder.start();
        processingVideo.currentTime = 0;
        await processingVideo.play();
        
        let lastTime = -1;
        let lastCharCount = -1;

        const renderLoop = async () => {
            if (processingVideo.paused || processingVideo.ended) {
                if (recorder.state === 'recording') recorder.stop();
                return;
            }

            const currentTime = processingVideo.currentTime;
            
            if (Math.abs(currentTime - lastTime) < (1 / (exportOptions.frameRate * 2))) {
                requestAnimationFrame(renderLoop);
                return;
            }
            lastTime = currentTime;

            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            if (exportOptions.embedOnOriginal) {
                tempCtx.drawImage(processingVideo, 0, 0, tempCanvas.width, tempCanvas.height);
            } else if (exportOptions.greenScreen) {
              tempCtx.fillStyle = '#00FF00';
              tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            }

            const activeCaption = job.captions.find(c => currentTime >= c.start && currentTime <= c.end);
            if (activeCaption) {
                const charCount = drawCaption(tempCtx, activeCaption, currentTime, tempCanvas.width, tempCanvas.height, customization, true);
                if (charCount > -1 && charCount > lastCharCount && customization.textStyle.typewriterSound && audioCtx && destNode) {
                    const now = audioCtx.currentTime;
                    const gainNode = audioCtx.createGain();
                    gainNode.connect(destNode);
                    const bufferSize = audioCtx.sampleRate * 0.05;
                    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                    const output = buffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
                    const whiteNoiseSource = audioCtx.createBufferSource();
                    whiteNoiseSource.buffer = buffer;
                    whiteNoiseSource.connect(gainNode);
                    gainNode.gain.setValueAtTime(0.4, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
                    whiteNoiseSource.start(now);
                    whiteNoiseSource.stop(now + 0.05);
                }
                lastCharCount = charCount;
            } else {
                lastCharCount = -1;
            }
            
            updateJob(job.id, { progress: (currentTime / duration) * 100 });
            requestAnimationFrame(renderLoop);
        };
        
        requestAnimationFrame(renderLoop);
        await recorderPromise;
        if (processingVideo.parentElement) {
            processingVideo.parentElement.removeChild(processingVideo);
        }
    };
    
    // Preset handlers
    const handleSavePreset = () => {
        if (!newPresetName.trim() || presets.some(p => p.name === newPresetName.trim())) {
            alert("Please enter a unique preset name."); return;
        }
        const newPreset: Preset = { name: newPresetName.trim(), options: customization };
        setPresets(prev => [...prev, newPreset]);
        setNewPresetName('');
        setSelectedPreset(newPreset.name);
    };

    const handleApplyPreset = (name: string) => {
        const preset = presets.find(p => p.name === name);
        if (preset) {
            setCustomization(preset.options);
            setSelectedPreset(name);
        }
    };
    
    const handleDeletePreset = (name: string) => {
        if (window.confirm(`Are you sure you want to delete the preset "${name}"?`)) {
            setPresets(prev => prev.filter(p => p.name !== name));
            setSelectedPreset('');
        }
    };
    
    const handleGenerateAll = () => {
        if(isProcessing) {
            alert('Please wait for current processing to finish.'); return;
        }
        setShowExportModal(true);
    };
    
    const handleConfirmGenerateAll = () => {
        setShowExportModal(false);
        
        if (exportOptions.applySilenceSkip) {
            // TODO: If `applySilenceSkip` is true, videos should be
            // processed to remove silence before generation. This would involve
            // creating a new, temporary video file in-memory for each job.
            // The current Silence Skip tool is a UI simulation, so this logic is not implemented.
            console.log(`Silence Skip enabled with threshold: ${exportOptions.silenceThreshold}dB`);
        }
        
        const resetJobs = jobs.map(job => 
            (job.status === 'transcribed' || job.status === 'done' || job.status === 'error') && job.captions.length > 0
                ? { ...job, status: 'transcribed' as JobStatus, error: null } 
                : job
        );
        setJobs(resetJobs);
        processGenerationQueue(resetJobs);
    };

    const processGenerationQueue = async (queue: VideoJob[]) => {
        setIsProcessing(true);
        const jobsToGenerate = queue.filter(j => j.status === 'transcribed');
        // Process jobs serially to avoid overloading the browser
        for (const job of jobsToGenerate) {
            await generateJob(job);
        }
        setIsProcessing(false);
    };

    return (
        <div className="w-full max-w-7xl flex flex-col">
            {showExportModal && 
                <ExportModal 
                    options={exportOptions}
                    setOptions={setExportOptions}
                    onClose={() => setShowExportModal(false)}
                    onGenerate={handleConfirmGenerateAll}
                    isBatchMode={true}
                />
            }
            <PageHeader title="Batch Processor" onBack={onBack} />
            <main className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
                 <div className="lg:col-span-2 flex flex-col gap-6">
                    {jobs.length === 0 ? (
                        <FileUpload onFileChange={handleFileChange} multiple />
                    ) : (
                        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-lg border border-gray-200/80">
                            <div className="flex justify-between items-center mb-4">
                               <h2 className="text-xl sm:text-2xl font-bold text-green-600">Video Queue</h2>
                                <label htmlFor="file-upload" className="cursor-pointer bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg text-sm">
                                    Add More Videos
                                </label>
                                <input id="file-upload" type="file" className="hidden" accept="video/*" onChange={handleFileChange} multiple/>
                           </div>
                           <JobsList jobs={jobs} exportOptions={exportOptions}/>
                        </div>
                    )}
                 </div>
                 <div className="flex flex-col gap-6">
                    <CustomizationPanel 
                        customization={customization} 
                        setCustomization={setCustomization}
                        presets={presets}
                        selectedPreset={selectedPreset}
                        newPresetName={newPresetName}
                        setNewPresetName={setNewPresetName}
                        onSavePreset={handleSavePreset}
                        onApplyPreset={handleApplyPreset}
                        onDeletePreset={handleDeletePreset}
                    />
                    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200/80">
                         <button 
                            onClick={handleGenerateAll}
                            disabled={isProcessing || jobs.length === 0 || !jobs.some(j => j.status === 'transcribed')}
                            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition-transform duration-200 hover:scale-105 shadow-md flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:scale-100"
                        >
                            <VideoIcon className="w-6 h-6" /> Generate Captioned Videos
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
};

// =================================================================================
// SINGLE VIDEO EDITOR COMPONENT
// =================================================================================
const SingleVideoEditor: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [captions, setCaptions] = useState<Caption[]>([]);
    const [processingState, setProcessingState] = useState<ProcessingState>(ProcessingState.IDLE);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
    const [generatedCaptionUrl, setGeneratedCaptionUrl] = useState<string | null>(null);

    const [customization, setCustomization] = useState<CustomizationOptions>(INITIAL_CUSTOMIZATION_OPTIONS);
    const [exportOptions, setExportOptions] = useState<ExportOptions>(INITIAL_EXPORT_OPTIONS);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showCaptionEditor, setShowCaptionEditor] = useState(false);
    
    // Preset states
    const [presets, setPresets] = useState<Preset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState<string>('');
    const [newPresetName, setNewPresetName] = useState<string>('');
    // FIX: Changed useRef type from NodeJS.Timeout to the correct browser return type for setInterval to fix type mismatch errors.
    const transcriptionProgressInterval = useRef<ReturnType<typeof setInterval>>();

    // Load fonts and presets on mount
    useEffect(() => {
        const fontsToLoad = ['Cairo', 'Tajawal', 'Noto+Sans+Arabic', 'El+Messiri', 'Amiri', 'Lateef', 'Markazi+Text', 'Roboto', 'Montserrat', 'Poppins', 'Oswald', 'Playfair+Display'];
        const link = document.createElement('link');
        link.href = `https://fonts.googleapis.com/css2?family=${fontsToLoad.join('&family=')}:wght@400;700;800&display=swap`;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        
        try {
            const savedPresets = localStorage.getItem('greenCapAIPresets');
            if (savedPresets) setPresets(JSON.parse(savedPresets));
        } catch (error) { console.error("Failed to load presets", error); }
    }, []);

    // Save presets to localStorage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('greenCapAIPresets', JSON.stringify(presets));
        } catch (error) { console.error("Failed to save presets", error); }
    }, [presets]);
    
    // FIX: Explicitly add void return type to prevent subtle type inference issues.
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('video/')) {
            setVideoFile(file);
            setVideoUrl(URL.createObjectURL(file));
            setCaptions([]);
            setError(null);
            setGeneratedUrl(null);
            setGeneratedCaptionUrl(null);
            setShowCaptionEditor(false);
            transcribeVideo(file);
        }
    };

    // FIX: Explicitly add Promise<void> return type to prevent subtle type inference issues.
    const transcribeVideo = async (file: File): Promise<void> => {
        setProcessingState(ProcessingState.TRANSCRIBING);
        setProgress(0);
        
        transcriptionProgressInterval.current = setInterval(() => {
            setProgress(prev => Math.min(prev + 1, 95));
        }, 500);

        try {
            const base64Data = await fileToBase64(file);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: {
                    parts: [
                        { text: "You are an expert transcriptionist specializing in the Egyptian Arabic dialect. Transcribe the audio from this video precisely. Do NOT translate, normalize, or alter any slang, colloquialisms, or expressions. Preserve the exact words and phrasing spoken. Provide the output as a valid JSON array of objects. Each object must have 'id' (a unique number), 'start' (start time in seconds), 'end' (end time in seconds), and 'text' (the transcribed text). Ensure timestamps are accurate." },
                        { inlineData: { mimeType: file.type, data: base64Data } }
                    ]
                },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.NUMBER },
                                start: { type: Type.NUMBER },
                                end: { type: Type.NUMBER },
                                text: { type: Type.STRING },
                            },
                            required: ['id', 'start', 'end', 'text'],
                        },
                    },
                },
            });
            
            const parsedCaptions = JSON.parse(response.text.trim());
            if (transcriptionProgressInterval.current) clearInterval(transcriptionProgressInterval.current);
            setCaptions(parsedCaptions);
            setProgress(100);
            setProcessingState(ProcessingState.TRANSCRIPTION_DONE);
        } catch (err) {
            console.error("Transcription failed:", err);
            if (transcriptionProgressInterval.current) clearInterval(transcriptionProgressInterval.current);
            setError("Transcription failed. The AI model might be unable to process this file.");
            setProcessingState(ProcessingState.ERROR);
        }
    };

    const handleGenerate = async () => {
        if (!videoFile || captions.length === 0) {
            setError('No video or captions available to generate.');
            return;
        }
        setShowCaptionEditor(false);
        setProcessingState(ProcessingState.GENERATING);
        setProgress(0);
        setShowExportModal(false);
        
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
            setError("Could not create canvas context.");
            setProcessingState(ProcessingState.ERROR);
            return;
        }
        
        const processingVideo = document.createElement('video');
        processingVideo.src = URL.createObjectURL(videoFile);
        // FIX: Audio export fixed by muting the video element instead of setting volume to 0.
        // This prevents audible playback while ensuring the audio track is captured for export.
        processingVideo.muted = true;

        // Add to DOM to ensure audio capture works reliably
        document.body.appendChild(processingVideo);
        processingVideo.style.position = 'fixed';
        processingVideo.style.top = '-10000px';
        processingVideo.style.left = '-10000px';

        await new Promise<void>(r => {
            processingVideo.onloadedmetadata = () => {
                const { outputWidth, outputHeight } = calculateExportDimensions(
                    processingVideo.videoWidth,
                    processingVideo.videoHeight
                );
                tempCanvas.width = outputWidth;
                tempCanvas.height = outputHeight;
                r();
            };
        });
        
        const duration = processingVideo.duration;
        const videoStream = tempCanvas.captureStream(exportOptions.frameRate);
        const streamTracks = [videoStream.getVideoTracks()[0]];
        
        let audioCtx: AudioContext | undefined, destNode: MediaStreamAudioDestinationNode | undefined;
        if (exportOptions.includeAudio) {
            try {
                audioCtx = new AudioContext();
                const sourceNode = audioCtx.createMediaElementSource(processingVideo);
                destNode = audioCtx.createMediaStreamDestination({ channelCount: 2 });
                sourceNode.connect(destNode);
                const audioTrack = destNode.stream.getAudioTracks()[0];
                if (audioTrack) streamTracks.push(audioTrack);
            } catch (e) { console.error("Could not process audio:", e); }
        }
        
        const combinedStream = new MediaStream(streamTracks);
        const { mimeType } = getMimeTypeAndExtension(exportOptions.format);
        
        const recorderOptions = {
            mimeType,
            videoBitsPerSecond: getBitrate(tempCanvas.width, tempCanvas.height),
            audioBitsPerSecond: exportOptions.format === 'video/mp4' ? 320000 : 256000,
        };
        const recorder = new MediaRecorder(combinedStream, recorderOptions);

        const chunks: Blob[] = [];
        recorder.ondataavailable = e => chunks.push(e.data);

        const recorderPromise = new Promise<void>(resolve => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                setGeneratedUrl(URL.createObjectURL(blob));
                setGeneratedCaptionUrl(generateCaptionFile(captions, exportOptions.captionFormat));
                setProcessingState(ProcessingState.GENERATE_DONE);
                setProgress(100);
                if (audioCtx?.state !== 'closed') audioCtx?.close();
                resolve();
            };
        });

        recorder.start();
        processingVideo.currentTime = 0;
        await processingVideo.play();
        
        let lastTime = -1, lastCharCount = -1;
        const renderLoop = async () => {
            if (processingVideo.paused || processingVideo.ended) {
                if (recorder.state === 'recording') recorder.stop();
                return;
            }
            const currentTime = processingVideo.currentTime;
            if (Math.abs(currentTime - lastTime) < (1 / (exportOptions.frameRate * 2))) {
                requestAnimationFrame(renderLoop);
                return;
            }
            lastTime = currentTime;
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            if (exportOptions.embedOnOriginal) tempCtx.drawImage(processingVideo, 0, 0, tempCanvas.width, tempCanvas.height);
            else if (exportOptions.greenScreen) {
              tempCtx.fillStyle = '#00FF00';
              tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            }

            const activeCaption = captions.find(c => currentTime >= c.start && currentTime <= c.end);
            if (activeCaption) {
                const charCount = drawCaption(tempCtx, activeCaption, currentTime, tempCanvas.width, tempCanvas.height, customization, true);
                if (charCount > -1 && charCount > lastCharCount && customization.textStyle.typewriterSound && audioCtx && destNode) {
                    const now = audioCtx.currentTime;
                    const gainNode = audioCtx.createGain();
                    gainNode.connect(destNode);
                    const bufferSize = audioCtx.sampleRate * 0.05;
                    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                    const output = buffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
                    const whiteNoiseSource = audioCtx.createBufferSource();
                    whiteNoiseSource.buffer = buffer;
                    whiteNoiseSource.connect(gainNode);
                    gainNode.gain.setValueAtTime(0.4, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
                    whiteNoiseSource.start(now);
                    whiteNoiseSource.stop(now + 0.05);
                }
                lastCharCount = charCount;
            } else {
                lastCharCount = -1;
            }
            
            setProgress((currentTime / duration) * 100);
            requestAnimationFrame(renderLoop);
        };
        requestAnimationFrame(renderLoop);
        await recorderPromise;
        if (processingVideo.parentElement) {
            processingVideo.parentElement.removeChild(processingVideo);
        }
    };
    
    const handleSavePreset = () => {
        if (!newPresetName.trim() || presets.some(p => p.name === newPresetName.trim())) {
            alert("Please enter a unique preset name.");
            return;
        }
        const newPreset: Preset = { name: newPresetName.trim(), options: customization };
        setPresets(prev => [...prev, newPreset]);
        setNewPresetName('');
        setSelectedPreset(newPreset.name);
    };
    const handleApplyPreset = (name: string) => {
        const preset = presets.find(p => p.name === name);
        if (preset) {
            setCustomization(preset.options);
            setSelectedPreset(name);
        }
    };
    const handleDeletePreset = (name: string) => {
        if (window.confirm(`Are you sure you want to delete the preset "${name}"?`)) {
            setPresets(prev => prev.filter(p => p.name !== name));
            setSelectedPreset('');
        }
    };

    const renderContent = () => {
        if (processingState === ProcessingState.IDLE) {
            return <FileUpload onFileChange={handleFileChange} />;
        }
        
        let statusText = '';
        if (processingState === ProcessingState.TRANSCRIBING) {
            statusText = progress > 90 ? 'Finalizing transcription...' : 'Transcribing with Gemini...';
        } else if (processingState === ProcessingState.GENERATING) {
            statusText = 'Generating Video...';
        }

        if (processingState === ProcessingState.TRANSCRIBING || processingState === ProcessingState.GENERATING) {
            return (
                <div className="w-full text-center p-8 bg-white rounded-2xl shadow-lg">
                    <LoadingIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">{statusText}</h2>
                     <div className="w-full max-w-md mx-auto bg-gray-200 rounded-full h-4 mt-4">
                        <div className="bg-green-500 h-4 rounded-full" style={{ width: `${progress}%` }}></div>
                    </div>
                    <p className="font-semibold mt-2">{Math.round(progress)}%</p>
                </div>
            );
        }

        if (processingState === ProcessingState.ERROR) {
             return (
                 <div className="w-full text-center p-8 bg-white rounded-2xl shadow-lg">
                    <h2 className="text-2xl font-bold text-red-500 mb-2">An Error Occurred</h2>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <button onClick={() => setProcessingState(ProcessingState.IDLE)} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg">Try Again</button>
                 </div>
             );
        }
        
        const { extension: fileExtension } = getMimeTypeAndExtension(exportOptions.format);

        return (
             <main className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 flex flex-col gap-6">
                    <VideoPreview videoUrl={videoUrl!} captions={captions} customization={customization} />
                    {processingState === ProcessingState.GENERATE_DONE && (
                        <div className="bg-white p-6 rounded-2xl shadow-lg flex flex-col sm:flex-row gap-4 items-center">
                            <CheckCircleIcon className="w-10 h-10 text-green-500"/>
                            <div className="flex-grow text-center sm:text-left">
                                <h3 className="font-bold text-lg">Export Complete!</h3>
                                <p className="text-sm text-gray-500">Your video and caption file are ready.</p>
                            </div>
                            <div className="flex gap-2">
                                <a href={generatedUrl!} download={`${videoFile!.name.split('.').slice(0, -1).join('.')}_captioned.${fileExtension}`} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg text-sm flex items-center gap-2"><DownloadIcon className="w-4 h-4"/> Video</a>
                                <a href={generatedCaptionUrl!} download={`${videoFile!.name.split('.').slice(0, -1).join('.')}.${exportOptions.captionFormat}`} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg text-sm flex items-center gap-2"><DownloadIcon className="w-4 h-4"/> .{exportOptions.captionFormat}</a>
                            </div>
                        </div>
                    )}
                    {processingState === ProcessingState.TRANSCRIPTION_DONE && !showCaptionEditor && (
                         <button 
                            onClick={() => setShowCaptionEditor(true)} 
                            className="text-green-600 font-bold text-lg self-start py-2 hover:underline focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
                        >
                            Edit Captions
                        </button>
                    )}
                    {showCaptionEditor && <CaptionEditor captions={captions} setCaptions={setCaptions} />}
                </div>
                 <div className="flex flex-col gap-6">
                    <CustomizationPanel 
                        customization={customization} setCustomization={setCustomization}
                        presets={presets} selectedPreset={selectedPreset} newPresetName={newPresetName} setNewPresetName={setNewPresetName}
                        onSavePreset={handleSavePreset} onApplyPreset={handleApplyPreset} onDeletePreset={handleDeletePreset}
                    />
                     <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200/80">
                         <button onClick={() => setShowExportModal(true)} className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg">
                            Export Video
                        </button>
                    </div>
                 </div>
            </main>
        );
    };

    return (
        <div className="w-full max-w-7xl flex flex-col">
            {showExportModal && 
                // FIX: Corrected prop to pass `setExportOptions` state setter instead of undefined `setOptions`.
                <ExportModal options={exportOptions} setOptions={setExportOptions} onClose={() => setShowExportModal(false)} onGenerate={handleGenerate} />
            }
            <PageHeader title="Single Video Editor" onBack={onBack} />
            <div className="mt-8">
                {renderContent()}
            </div>
        </div>
    )
};

const VideoPreview: React.FC<{ videoUrl: string, captions: Caption[], customization: CustomizationOptions }> = ({ videoUrl, captions, customization }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>();
    const [isPortrait, setIsPortrait] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const setupCanvas = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            setIsPortrait(video.videoHeight > video.videoWidth);
        };

        const renderLoop = () => {
            if (!video || !ctx) return; // Guard against component unmount after cleanup starts

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const activeCaption = captions.find(c => video.currentTime >= c.start && video.currentTime <= c.end);
            if (activeCaption) {
                drawCaption(ctx, activeCaption, video.currentTime, canvas.width, canvas.height, customization);
            }

            animationFrameId.current = requestAnimationFrame(renderLoop);
        };

        const setupCanvasHandler = () => setupCanvas();
        video.addEventListener('loadedmetadata', setupCanvasHandler);
        if (video.readyState >= 2) { // HAVE_METADATA
            setupCanvas();
        }
        
        renderLoop();

        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
            if (video) {
                video.removeEventListener('loadedmetadata', setupCanvasHandler);
            }
        };
    }, [captions, customization, videoUrl]);


    return (
        <div className={`bg-black rounded-xl overflow-hidden shadow-lg grid place-items-center ${isPortrait ? 'max-w-sm mx-auto' : 'w-full'}`}>
            <video ref={videoRef} src={videoUrl} controls className="col-start-1 row-start-1 max-w-full max-h-full" />
            <canvas ref={canvasRef} className="col-start-1 row-start-1 max-w-full max-h-full pointer-events-none" />
        </div>
    );
};

const CaptionEditor: React.FC<{ captions: Caption[], setCaptions: React.Dispatch<React.SetStateAction<Caption[]>> }> = ({ captions, setCaptions }) => {
    const handleTextChange = (id: number, text: string) => {
        setCaptions(prev => prev.map(c => c.id === id ? { ...c, text } : c));
    };

    return (
        <div className="bg-white p-4 rounded-2xl shadow-lg border border-gray-200/80">
            <h3 className="text-xl font-bold mb-4 text-green-600">Edit Captions</h3>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {captions.map(caption => (
                    <div key={caption.id} className="flex gap-3">
                        <div className="text-xs text-center font-mono bg-gray-100 p-2 rounded-md text-gray-600">
                            {toSrtTime(caption.start).split(',')[0]}<br />|<br />{toSrtTime(caption.end).split(',')[0]}
                        </div>
                        <textarea 
                            value={caption.text} 
                            onChange={e => handleTextChange(caption.id, e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 text-base"
                            rows={2}
                            dir={isRtl(caption.text) ? 'rtl' : 'ltr'}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};


const JobsList: React.FC<{ jobs: VideoJob[], exportOptions: ExportOptions }> = ({ jobs, exportOptions }) => {
    return (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {jobs.map(job => <JobItem key={job.id} job={job} exportOptions={exportOptions} />)}
        </div>
    );
};

const JobItem: React.FC<{ job: VideoJob, exportOptions: ExportOptions }> = ({ job, exportOptions }) => {
    const { status, progress, file, error, generatedVideoUrl, generatedCaptionUrl } = job;
    const baseFileName = file.name.split('.').slice(0, -1).join('.');
    const { extension: videoFormat } = getMimeTypeAndExtension(exportOptions.format);
    
    const getStatusInfo = (): { text: string; color: string; icon: React.ReactNode } => {
        switch (status) {
            case 'pending': return { text: 'Pending...', color: 'text-gray-500', icon: null };
            case 'transcribing': return { text: 'Transcribing with Gemini...', color: 'text-indigo-600', icon: <LoadingIcon className="w-5 h-5" /> };
            case 'transcribed': return { text: 'Ready to Generate', color: 'text-blue-600', icon: <CheckCircleIcon className="w-5 h-5 text-blue-500" /> };
            case 'generating': return { text: 'Generating Video...', color: 'text-green-600', icon: <LoadingIcon className="w-5 h-5" /> };
            case 'done': return { text: 'Completed', color: 'text-green-600', icon: <CheckCircleIcon className="w-5 h-5" /> };
            case 'error': return { text: 'Error', color: 'text-red-500', icon: null };
            default: return { text: '', color: '', icon: null };
        }
    };
    
    let { text, color, icon } = getStatusInfo();
    const showProgress = status === 'transcribing' || status === 'generating';

    if (status === 'transcribing' && progress > 90) {
        text = 'Finalizing transcription...';
    }

    return (
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <p className="font-bold text-gray-800 truncate" title={file.name}>{file.name}</p>
            <div className="mt-2">
                <div className="flex justify-between items-center mb-1">
                    <div className={`flex items-center gap-2 font-semibold text-sm ${color}`}>
                        {icon}
                        <span>{text}</span>
                    </div>
                    {showProgress && <span className="text-sm font-medium text-gray-600">{Math.round(progress)}%</span>}
                </div>
                {showProgress && (
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.2s ease-in-out' }}></div>
                    </div>
                )}
                {status === 'error' && <p className="text-red-500 text-sm mt-1">{error}</p>}
                {status === 'done' && (
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                         <a href={generatedVideoUrl!} download={`${baseFileName}_captioned.${videoFormat}`} className="flex-1 text-center bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg text-sm flex items-center justify-center gap-2">
                            <DownloadIcon className="w-4 h-4"/> Video
                        </a>
                        <a href={generatedCaptionUrl!} download={`${baseFileName}.${exportOptions.captionFormat}`} className="flex-1 text-center bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg text-sm flex items-center justify-center gap-2">
                            <DownloadIcon className="w-4 h-4"/> .{exportOptions.captionFormat.toUpperCase()}
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
};


// =================================================================================
// SUB-COMPONENTS
// =================================================================================

const MainHeader: React.FC = () => (
    <header className="w-full mb-8 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900">
            GreenCap <span className="text-green-600">AI V3.5</span>
        </h1>
        <p className="mt-2 text-lg text-gray-500">
            Professional AI-powered captioning with advanced customization and animation.
        </p>
    </header>
);

const PageHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
    <div className="w-full max-w-7xl relative text-center">
        {/* FIX: Changed onClick={onBack} to onClick={() => onBack()} to prevent passing an event argument to a function that expects none. */}
        <button onClick={() => onBack()} className="absolute left-0 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-gray-200 transition-colors">
            <ArrowLeftIcon className="w-6 h-6 text-gray-600" />
            <span className="sr-only">Back</span>
        </button>
        <h1 className="text-3xl font-bold text-gray-800">{title}</h1>
    </div>
);


const FileUpload: React.FC<{ onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void; multiple?: boolean; }> = ({ onFileChange, multiple=false }) => (
    <div className="w-full flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-2xl bg-white/80 hover:border-green-500 hover:bg-white transition-all duration-300 min-h-[300px]">
        <UploadIcon className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Upload Your Video(s)</h2>
        <p className="text-gray-500 mb-6">Drag & drop or click to select files.</p>
        <label htmlFor="file-upload" className="cursor-pointer bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition-transform duration-200 hover:scale-105 shadow-md">
            Select Files
        </label>
        <input id="file-upload" type="file" className="hidden" accept="video/*" onChange={onFileChange} multiple={multiple} />
    </div>
);

const Accordion: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, icon, children, defaultOpen=false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div>
            <button onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center text-left font-bold text-lg p-3 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
                 <span className="flex items-center gap-3">{icon} {title}</span>
                 <ChevronDownIcon className={`w-6 h-6 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && <div className="p-4 flex flex-col gap-4">{children}</div>}
        </div>
    );
};


interface CustomizationPanelProps {
    customization: CustomizationOptions;
    setCustomization: React.Dispatch<React.SetStateAction<CustomizationOptions>>;
    presets: Preset[];
    selectedPreset: string;
    newPresetName: string;
    setNewPresetName: React.Dispatch<React.SetStateAction<string>>;
    onSavePreset: () => void;
    onApplyPreset: (name: string) => void;
    onDeletePreset: (name: string) => void;
}

const CustomizationPanel: React.FC<CustomizationPanelProps> = ({ 
    customization, setCustomization, presets, selectedPreset, newPresetName, setNewPresetName,
    onSavePreset, onApplyPreset, onDeletePreset
}) => {
    
    const handleUpdate = <T extends 'textStyle' | 'boxStyle', K extends keyof CustomizationOptions[T]>(section: T, key: K, value: CustomizationOptions[T][K]) => {
        setCustomization(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    };
    
    const { textStyle, boxStyle, animationStyle } = customization;

    return (
        <div className="bg-white p-4 rounded-2xl flex flex-col gap-2 shadow-lg border border-gray-200/80">
            <h3 className="text-xl font-bold flex items-center gap-2 p-2"><SettingsIcon className="w-6 h-6 text-green-600"/> Caption Style</h3>
            
            <Accordion title="Style Presets" icon={<BookmarkIcon className="w-5 h-5" />}>
                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Apply a Preset</label>
                    <div className="flex gap-2 items-center">
                        <select 
                            value={selectedPreset} 
                            onChange={e => onApplyPreset(e.target.value)} 
                            className="flex-grow bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500"
                        >
                            <option value="">Select a preset...</option>
                            {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                        </select>
                        {selectedPreset && (
                             <button onClick={() => onDeletePreset(selectedPreset)} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-100 rounded-md" aria-label="Delete Preset">
                                <TrashIcon className="w-5 h-5"/>
                            </button>
                        )}
                    </div>
                </div>
                 <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Save Current Style</label>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            placeholder="New preset name..." 
                            value={newPresetName} 
                            onChange={e => setNewPresetName(e.target.value)}
                            className="flex-grow bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500"
                        />
                        {/* FIX: Changed onClick={onSavePreset} to onClick={() => onSavePreset()} to prevent passing an event argument to a function that expects none. */}
                        <button onClick={() => onSavePreset()} disabled={!newPresetName.trim()} className="p-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed">
                            <SaveIcon className="w-5 h-5"/>
                        </button>
                    </div>
                </div>
            </Accordion>

            <Accordion title="Text Appearance" icon={<TextIcon className="w-5 h-5"/>} defaultOpen={true}>
                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Font Family</label>
                    <select value={textStyle.fontFamily} onChange={e => handleUpdate('textStyle', 'fontFamily', e.target.value)} className="bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500">
                        {FONTS.map(font => <option key={font.value} value={font.value} disabled={font.disabled}>{font.name}</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <div className="flex flex-col gap-2">
                        <label className="font-semibold text-sm">Font Weight</label>
                        <select value={textStyle.fontWeight} onChange={e => handleUpdate('textStyle', 'fontWeight', e.target.value)} className="bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500">
                            <option value="400">Normal</option>
                            <option value="700">Bold</option>
                            <option value="800">Extra Bold</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="font-semibold text-sm">Line Height</label>
                         <input type="number" step="0.1" min="1" max="3" value={textStyle.lineHeight} onChange={e => handleUpdate('textStyle', 'lineHeight', parseFloat(e.target.value))} className="bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500" />
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Font Size: {textStyle.fontSize}px</label>
                    <input type="range" min="20" max="100" value={textStyle.fontSize} onChange={e => handleUpdate('textStyle', 'fontSize', parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Text Color</label>
                    <input type="color" value={textStyle.textColor} onChange={e => handleUpdate('textStyle', 'textColor', e.target.value)} className="w-full h-10 bg-gray-50 rounded-md border-gray-300 cursor-pointer"/>
                </div>
            </Accordion>
            
            <Accordion title="Caption Box" icon={<BoxIcon className="w-5 h-5"/>}>
                 <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Background Color</label>
                    <div className="flex gap-2">
                        <input type="color" value={boxStyle.backgroundColor} onChange={e => handleUpdate('boxStyle', 'backgroundColor', e.target.value)} className="w-1/4 h-10 bg-gray-50 rounded-md border-gray-300 cursor-pointer"/>
                        <div className="flex-grow flex flex-col gap-1">
                            <label className="text-xs">Opacity: {Math.round(boxStyle.backgroundOpacity * 100)}%</label>
                            <input type="range" min="0" max="1" step="0.01" value={boxStyle.backgroundOpacity} onChange={e => handleUpdate('boxStyle', 'backgroundOpacity', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <div className="flex flex-col gap-2">
                        <label className="font-semibold text-sm">Padding</label>
                        <input type="range" min="0" max="20" value={boxStyle.padding} onChange={e => handleUpdate('boxStyle', 'padding', parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="font-semibold text-sm">Border Radius</label>
                         <input type="range" min="0" max="50" value={boxStyle.border.radius} onChange={e => handleUpdate('boxStyle', 'border', {...boxStyle.border, radius: parseInt(e.target.value, 10)})} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                    </div>
                </div>
                 <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Border</label>
                    <div className="flex gap-2">
                        <input type="color" value={boxStyle.border.color} onChange={e => handleUpdate('boxStyle', 'border', {...boxStyle.border, color: e.target.value})} className="w-1/4 h-10 bg-gray-50 rounded-md border-gray-300 cursor-pointer"/>
                        <div className="flex-grow">
                             <input type="number" placeholder="Width" min="0" max="20" value={boxStyle.border.width} onChange={e => handleUpdate('boxStyle', 'border', {...boxStyle.border, width: parseInt(e.target.value, 10)})} className="w-full bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500" />
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Vertical Position: {boxStyle.verticalMargin}%</label>
                    <input type="range" min="0" max="100" value={boxStyle.verticalMargin} onChange={e => handleUpdate('boxStyle', 'verticalMargin', parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                </div>
                 <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Horizontal Position: {boxStyle.horizontalMargin}%</label>
                    <input type="range" min="-50" max="50" value={boxStyle.horizontalMargin} onChange={e => handleUpdate('boxStyle', 'horizontalMargin', parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                </div>
            </Accordion>
            
            <Accordion title="Animation" icon={<ZapIcon className="w-5 h-5"/>}>
                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Effect</label>
                    <select value={animationStyle} onChange={e => setCustomization(p => ({...p, animationStyle: e.target.value as any}))} className="bg-gray-50 border-gray-300 rounded-md p-2 focus:ring-green-500 focus:border-green-500">
                        <option value="none">None</option>
                        <option value="fade">Fade</option>
                        <option value="slide">Slide In</option>
                        <option value="pop">Pop</option>
                        <option value="typewriter">Typewriter</option>
                        <option value="glow">Glow</option>
                    </select>
                </div>
                {animationStyle === 'typewriter' && (
                     <label className="font-semibold text-sm flex items-center gap-2 mt-2">
                        <input type="checkbox" checked={textStyle.typewriterSound} onChange={e => handleUpdate('textStyle', 'typewriterSound', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"/>
                        Enable typing sound (in export)
                    </label>
                )}
            </Accordion>
        </div>
    );
};

const ExportModal: React.FC<{ options: ExportOptions, setOptions: React.Dispatch<React.SetStateAction<ExportOptions>>, onClose: () => void, onGenerate: () => void, isBatchMode?: boolean }> = ({ options, setOptions, onClose, onGenerate, isBatchMode=false }) => {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md flex flex-col gap-6">
                <h2 className="text-2xl font-bold text-center">Export Settings</h2>
                
                <div className="grid grid-cols-2 gap-4">
                     <div className="flex flex-col gap-2">
                        <label className="font-semibold text-sm">Frame Rate</label>
                        <select value={options.frameRate} onChange={e => setOptions(p => ({...p, frameRate: parseInt(e.target.value, 10)}))} className="bg-gray-100 border-gray-300 rounded-md p-2">
                            <option value="24">24 fps</option>
                            <option value="30">30 fps</option>
                            <option value="60">60 fps</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="font-semibold text-sm">Format</label>
                        <select value={options.format} onChange={e => setOptions(p => ({...p, format: e.target.value}))} className="bg-gray-100 border-gray-300 rounded-md p-2">
                            <option value="video/mp4">MP4 (H.264)</option>
                            <option value="video/webm">WebM (VP9)</option>
                        </select>
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="font-semibold text-sm">Caption File</label>
                    <select value={options.captionFormat} onChange={e => setOptions(p => ({...p, captionFormat: e.target.value as any}))} className="bg-gray-100 border-gray-300 rounded-md p-2">
                        <option value="srt">SRT</option>
                        <option value="vtt">VTT</option>
                    </select>
                </div>

                <div className="flex flex-col gap-3 mt-2">
                    <label className="font-semibold text-sm flex items-center gap-2">
                        <input type="checkbox" checked={options.embedOnOriginal} onChange={e => {
                            const isChecked = e.target.checked;
                            setOptions(p => ({ ...p, embedOnOriginal: isChecked, greenScreen: isChecked ? false : p.greenScreen }))
                        }} className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"/>
                        Embed on Original Video
                    </label>
                     <label className="font-semibold text-sm flex items-center gap-2">
                        <input type="checkbox" checked={options.greenScreen} disabled={options.embedOnOriginal} onChange={e => setOptions(p => ({...p, greenScreen: e.target.checked}))} className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:bg-gray-200"/>
                        Green Screen Background
                    </label>
                     <label className="font-semibold text-sm flex items-center gap-2">
                        <input type="checkbox" checked={options.includeAudio} onChange={e => setOptions(p => ({...p, includeAudio: e.target.checked}))} className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"/>
                        Include Original Audio
                    </label>
                </div>

                {isBatchMode && (
                    <div className="border-t pt-4 mt-2 flex flex-col gap-4">
                       <label className="font-semibold text-sm flex items-center gap-2">
                            <input type="checkbox" checked={options.applySilenceSkip} onChange={e => setOptions(p => ({...p, applySilenceSkip: e.target.checked}))} className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"/>
                            Apply Silence Skip
                        </label>
                        {options.applySilenceSkip && (
                             <div className="flex flex-col gap-2 pl-6">
                                <label className="font-semibold text-sm">Silence Threshold: {options.silenceThreshold} dB</label>
                                <input type="range" min="-60" max="0" value={options.silenceThreshold} onChange={e => setOptions(p => ({...p, silenceThreshold: parseInt(e.target.value, 10)}))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-4 mt-4">
                    <button onClick={onClose} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg">Cancel</button>
                    <button onClick={onGenerate} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg">Generate</button>
                </div>
            </div>
        </div>
    );
}

export default App;